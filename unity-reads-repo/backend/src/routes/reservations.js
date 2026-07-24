const express = require('express');
const { validateBody, reserveSchema, cancelReservationSchema } = require('../validation');
const { requireAuth } = require('../auth');
const { sendReservationReady } = require('../notify');
const { asyncRoute } = require('../middleware/errorHandler');

const HOLD_HOURS = 48;

// When a copy of (titleId, branch) becomes free — either a fresh return,
// or an expired hold being reclaimed — this decides what happens to it:
// hand it to the oldest still-WAITING reservation (marking that copy
// RESERVED and starting their 48h claim window), or, if nobody's waiting,
// just leave/set it AVAILABLE. Shared between the reservation routes here
// and the return path in routes/transactions.js, so both places implement
// "who gets the next copy" exactly once.
function promoteNextReservation(db, titleId, branch, copyId) {
    const next = db.prepare(`
        SELECT * FROM reservations
        WHERE title_id = ? AND branch = ? AND status = 'WAITING'
        ORDER BY reserved_at ASC LIMIT 1
    `).get(titleId, branch);

    if (!next) {
        db.prepare(`UPDATE copies SET status = 'AVAILABLE' WHERE copy_id = ?`).run(copyId);
        return null;
    }

    const readyAt = new Date();
    const expiresAt = new Date(readyAt.getTime() + HOLD_HOURS * 60 * 60 * 1000);
    db.prepare(`UPDATE reservations SET status = 'READY', ready_at = ?, expires_at = ? WHERE id = ?`)
        .run(readyAt.toISOString(), expiresAt.toISOString(), next.id);
    db.prepare(`UPDATE copies SET status = 'RESERVED' WHERE copy_id = ?`).run(copyId);
    return next;
}

// Reservation expiry has no real cron job behind it (no background
// scheduler in this deployment) — it's checked lazily at the top of
// sync/reserve requests instead. Fine at this scale; worth a proper
// scheduled job if this ever needs to be exact-to-the-minute rather than
// "checked the next time someone opens the app."
function expireStaleReservations(db) {
    const nowIso = new Date().toISOString();
    const stale = db.prepare(`SELECT * FROM reservations WHERE status = 'READY' AND expires_at < ?`).all(nowIso);

    for (const reservation of stale) {
        db.prepare(`UPDATE reservations SET status = 'CANCELLED' WHERE id = ?`).run(reservation.id);
        const heldCopy = db.prepare(`
            SELECT copy_id FROM copies WHERE title_id = ? AND branch = ? AND status = 'RESERVED' LIMIT 1
        `).get(reservation.title_id, reservation.branch);
        if (heldCopy) promoteNextReservation(db, reservation.title_id, reservation.branch, heldCopy.copy_id);
    }
}

module.exports = function reservationRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-reserve', requireAuth, validateBody(reserveSchema), asyncRoute(async (req, res) => {
        expireStaleReservations(db);
        const userId = req.user.userId; // never req.body.userId — see routes/account.js for why
        const { titleId, branch } = req.body;

        const title = db.prepare(`SELECT * FROM titles WHERE id = ?`).get(titleId);
        if (!title) return res.status(404).json({ success: false, message: 'Title not found.' });

        const availableCopy = db.prepare(`
            SELECT copy_id FROM copies WHERE title_id = ? AND branch = ? AND status = 'AVAILABLE' LIMIT 1
        `).get(titleId, branch);
        if (availableCopy) {
            return res.status(409).json({ success: false, message: 'A copy is available at that branch right now — borrow it directly instead of reserving.' });
        }

        const alreadyQueued = db.prepare(`
            SELECT id FROM reservations WHERE title_id = ? AND branch = ? AND user_id = ? AND status IN ('WAITING', 'READY')
        `).get(titleId, branch, userId);
        if (alreadyQueued) {
            return res.status(409).json({ success: false, message: "You're already on the waitlist for this title at that branch." });
        }

        const id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        db.prepare(`
            INSERT INTO reservations (id, title_id, branch, user_id, reserved_at, status)
            VALUES (?, ?, ?, ?, ?, 'WAITING')
        `).run(id, titleId, branch, userId, new Date().toISOString());

        return res.json({ success: true, message: "You're on the waitlist — we'll notify you when a copy is ready." });
    }));

    router.post('/webhook/library-cancel-reservation', requireAuth, validateBody(cancelReservationSchema), asyncRoute(async (req, res) => {
        const userId = req.user.userId;
        const { reservationId } = req.body;

        const reservation = db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(reservationId);
        if (!reservation || reservation.user_id !== userId) {
            return res.status(404).json({ success: false, message: 'Reservation not found.' });
        }
        if (!['WAITING', 'READY'].includes(reservation.status)) {
            return res.status(400).json({ success: false, message: 'That reservation is no longer active.' });
        }

        db.prepare(`UPDATE reservations SET status = 'CANCELLED' WHERE id = ?`).run(reservationId);

        // If they'd already been offered a held copy, releasing it should
        // offer it on to whoever's next, exactly like an expiry would.
        if (reservation.status === 'READY') {
            const heldCopy = db.prepare(`
                SELECT copy_id FROM copies WHERE title_id = ? AND branch = ? AND status = 'RESERVED' LIMIT 1
            `).get(reservation.title_id, reservation.branch);
            if (heldCopy) promoteNextReservation(db, reservation.title_id, reservation.branch, heldCopy.copy_id);
        }

        return res.json({ success: true });
    }));

    return router;
};

module.exports.promoteNextReservation = promoteNextReservation;
module.exports.expireStaleReservations = expireStaleReservations;
module.exports.HOLD_HOURS = HOLD_HOURS;
