const express = require('express');
const { validateBody, transactionSchema } = require('../validation');
const { requireAuth } = require('../auth');
const { isAccountLocked } = require('../fines');
const { promoteNextReservation } = require('./reservations');
const { asyncRoute } = require('../middleware/errorHandler');

module.exports = function transactionRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-update', requireAuth, validateBody(transactionSchema), asyncRoute(async (req, res) => {
        const userId = req.user.userId; // never req.body.user — see routes/account.js for why
        const { event, data } = req.body;

        if (event === 'BOOK_BORROWED') {
            return handleBorrow(db, req, res, userId, data);
        }
        return handleReturn(db, req, res, userId, data);
    }));

    return router;
};

function handleBorrow(db, req, res, userId, data) {
    // SECURITY / CORRECTNESS: this re-derives the fine lock and re-checks
    // the copy's live status server-side, rather than trusting the
    // client's own (already-correct, but bypassable) local check. Wrapped
    // in a single db.transaction — better-sqlite3 is synchronous, so
    // nothing else can interleave between the check and the write here.
    // That's what actually closes the double-borrow race a purely
    // client-side check never could.
    const runBorrow = db.transaction(() => {
        if (isAccountLocked(db, userId)) {
            const err = new Error('Account locked: clear overdue fines before borrowing again.');
            err.status = 403; err.expose = true;
            throw err;
        }

        const copy = db.prepare(`SELECT * FROM copies WHERE copy_id = ?`).get(data.copyId);
        if (!copy) {
            const err = new Error('That copy does not exist.');
            err.status = 404; err.expose = true;
            throw err;
        }

        let claimedReservation = null;
        const isEligible = copy.status === 'AVAILABLE' || (() => {
            if (copy.status !== 'RESERVED') return false;
            claimedReservation = db.prepare(`
                SELECT * FROM reservations
                WHERE title_id = ? AND branch = ? AND user_id = ? AND status = 'READY'
            `).get(copy.title_id, copy.branch, userId);
            return !!claimedReservation;
        })();

        if (!isEligible) {
            const err = new Error('That copy is no longer available.');
            err.status = 409; err.expose = true;
            throw err;
        }

        const title = db.prepare(`SELECT * FROM titles WHERE id = ?`).get(copy.title_id);
        const loanId = 'l_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const borrowedAt = new Date().toISOString();

        db.prepare(`UPDATE copies SET status = 'ON_LOAN' WHERE copy_id = ?`).run(copy.copy_id);
        db.prepare(`
            INSERT INTO loans (id, copy_id, title_id, book_title, branch, user_id, borrowed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(loanId, copy.copy_id, copy.title_id, title ? title.title : data.title || '', copy.branch, userId, borrowedAt);

        if (claimedReservation) {
            db.prepare(`UPDATE reservations SET status = 'FULFILLED' WHERE id = ?`).run(claimedReservation.id);
        }

        return { loanId, borrowedAt };
    });

    const result = runBorrow();
    return res.json({ success: true, loanId: result.loanId, borrowedAt: result.borrowedAt });
}

function handleReturn(db, req, res, userId, data) {
    const runReturn = db.transaction(() => {
        const loan = data.loanId
            ? db.prepare(`SELECT * FROM loans WHERE id = ?`).get(data.loanId)
            : db.prepare(`SELECT * FROM loans WHERE copy_id = ? AND returned_at IS NULL`).get(data.copyId);

        if (!loan || loan.returned_at) {
            const err = new Error('That loan is not currently active.');
            err.status = 404; err.expose = true;
            throw err;
        }

        // A resident can only return their own loan. A Library Assistant
        // can return anyone's, from the front desk — the one deliberate,
        // role-gated exception to per-user scoping in this route.
        if (req.user.accountType !== 'Library Assistant' && loan.user_id !== userId) {
            const err = new Error('You can only return your own loans.');
            err.status = 403; err.expose = true;
            throw err;
        }

        db.prepare(`UPDATE loans SET returned_at = ? WHERE id = ?`).run(new Date().toISOString(), loan.id);
        promoteNextReservation(db, loan.title_id, loan.branch, loan.copy_id);

        return true;
    });

    runReturn();
    return res.json({ success: true });
}
