const express = require('express');
const { validateBody, loginSchema } = require('../validation');
const { signToken } = require('../auth');
const { authLimiter } = require('../middleware/rateLimiters');
const { asyncRoute } = require('../middleware/errorHandler');

module.exports = function authRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-auth', authLimiter, validateBody(loginSchema), asyncRoute(async (req, res) => {
        const { userId, passcodeHash } = req.body;
        const user = db.prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);

        if (!user) {
            return res.json({ authenticated: false, message: 'Check your entries.' });
        }
        if (!user.verified) {
            return res.json({
                authenticated: false, unverified: true, userId: user.user_id,
                message: 'Please verify your account first — check your email/phone for the code.'
            });
        }

        const now = Date.now();
        if (user.locked_until && new Date(user.locked_until).getTime() > now) {
            return res.json({
                authenticated: false,
                message: `Too many failed attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString()}.`
            });
        }

        if (passcodeHash !== user.passcode_hash) {
            const attempts = (user.failed_attempts || 0) + 1;
            const lockedUntil = attempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
            db.prepare(`UPDATE users SET failed_attempts = ?, locked_until = ? WHERE user_id = ?`)
                .run(attempts, lockedUntil, userId);
            return res.json({ authenticated: false, message: 'Check your entries.' });
        }

        db.prepare(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?`).run(userId);

        const publicUser = { name: user.name, userId: user.user_id, estateBranch: user.estate_branch, accountType: user.account_type };
        const token = signToken(publicUser);
        return res.json({ authenticated: true, user: publicUser, token });
    }));

    return router;
};
