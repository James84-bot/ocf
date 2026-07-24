const express = require('express');
const { validateBody, changePinSchema } = require('../validation');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../middleware/errorHandler');

module.exports = function accountRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-change-pin', requireAuth, validateBody(changePinSchema), asyncRoute(async (req, res) => {
        // SECURITY: identity comes from the verified JWT (req.user), never
        // req.body.userId — that field is accepted for backward
        // compatibility with the frontend's payload shape but never used.
        const userId = req.user.userId;
        const { currentPasscodeHash, newPasscodeHash } = req.body;

        const user = db.prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);
        if (!user || user.passcode_hash !== currentPasscodeHash) {
            return res.status(400).json({ success: false, message: 'Current PIN is incorrect.' });
        }

        db.prepare(`UPDATE users SET passcode_hash = ? WHERE user_id = ?`).run(newPasscodeHash, userId);
        return res.json({ success: true, message: 'PIN updated successfully.' });
    }));

    return router;
};
