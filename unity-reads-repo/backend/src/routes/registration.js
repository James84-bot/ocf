const express = require('express');
const { validateBody, registrationSchema, verifySchema } = require('../validation');
const { sendVerificationCode } = require('../notify');
const { authLimiter } = require('../middleware/rateLimiters');
const { asyncRoute } = require('../middleware/errorHandler');
const { getSettings } = require('../settings');

function randomOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = function registrationRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-registration', authLimiter, validateBody(registrationSchema), asyncRoute(async (req, res) => {
        const { name, accountType, passcodeHash, workEmail, unitNumber, phone } = req.body;
        const isStaffLike = accountType === 'Staff' || accountType === 'Library Assistant';
        const settings = getSettings();

        // SECURITY: identity and estate assignment are derived here, not
        // trusted from whatever the client sent for them — the estate
        // field is hidden client-side for staff-like accounts, but a
        // request built by hand could still try to set an arbitrary one.
        let userId, estateBranch;
        if (isStaffLike) {
            const email = (workEmail || '').trim().toLowerCase();
            const domain = settings.staffEmailDomain;
            if (!email.endsWith(`@${domain}`)) {
                return res.status(400).json({ success: false, message: `Staff accounts require a work email ending in @${domain}.` });
            }
            userId = email;
            estateBranch = 'All Estates';
        } else {
            const cleanedPhone = (phone || '').trim();
            if (!cleanedPhone) {
                return res.status(400).json({ success: false, message: 'A phone number is required to register.' });
            }
            userId = cleanedPhone;
            estateBranch = (req.body.estateBranch || '').trim();
            if (!estateBranch) {
                return res.status(400).json({ success: false, message: `Please select your ${settings.branchLabel.toLowerCase()}.` });
            }
            // Only branches this organisation actually has. Without this check a
            // hand-built request could register a member at a branch that doesn't exist.
            if (!settings.branches.includes(estateBranch)) {
                return res.status(400).json({ success: false, message: `Unknown ${settings.branchLabel.toLowerCase()}: choose one from the list.` });
            }
        }

        const existing = db.prepare(`SELECT user_id FROM users WHERE user_id = ?`).get(userId);
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account already exists for that email/phone.' });
        }

        const otpCode = randomOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.prepare(`
            INSERT INTO users (user_id, name, estate_branch, account_type, unit_number, phone, work_email,
                                passcode_hash, registered_at, verified, verification_code, verification_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(userId, name, estateBranch, accountType, unitNumber || null, phone || null, workEmail || null,
               passcodeHash, new Date().toISOString(), otpCode, otpExpiresAt);

        await sendVerificationCode({ userId, accountType, phone }, otpCode);

        return res.json({ success: true, userId, message: 'Account created — check your email/phone for a verification code.' });
    }));

    router.post('/webhook/library-verify-account', validateBody(verifySchema), asyncRoute(async (req, res) => {
        const { userId, code } = req.body;
        const user = db.prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);

        if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
        if (user.verified) return res.json({ success: false, message: 'Account is already verified.' });
        if (!user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
            return res.status(400).json({ success: false, message: 'That code has expired. Please register again or request a new code.' });
        }
        if (String(user.verification_code) !== String(code)) {
            return res.status(400).json({ success: false, message: 'Incorrect code. Please try again.' });
        }

        db.prepare(`UPDATE users SET verified = 1, verification_code = NULL, verification_expires_at = NULL WHERE user_id = ?`).run(userId);
        return res.json({ success: true, message: 'Account verified — you can now log in.' });
    }));

    return router;
};
