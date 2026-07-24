const express = require('express');
const { validateBody, syncSchema } = require('../validation');
const { optionalAuth } = require('../auth');
const { expireStaleReservations } = require('./reservations');
const { asyncRoute } = require('../middleware/errorHandler');

module.exports = function syncRoutes(db) {
    const router = express.Router();

    // optionalAuth, not requireAuth: this route serves both the logged-out
    // hero-preview call (titles only, no Authorization header at all) and
    // the authenticated call (titles + this user's own loans/reservations)
    // at the same endpoint — see src/auth.js for why.
    router.post('/webhook/library-sync', optionalAuth, validateBody(syncSchema), asyncRoute(async (req, res) => {
        expireStaleReservations(db);

        const titleRows = db.prepare(`SELECT * FROM titles`).all();
        const copyRows = db.prepare(`SELECT * FROM copies`).all();

        const titles = titleRows.map(t => ({
            id: t.id, title: t.title, author: t.author, referenceNo: t.reference_no,
            ageBracket: t.age_bracket, grade: t.grade, coverImageUrl: t.cover_image_url,
            copies: copyRows.filter(c => c.title_id === t.id).map(c => ({ copyId: c.copy_id, branch: c.branch, status: c.status }))
        }));

        let loans = [];
        let reservations = [];
        if (req.user) {
            loans = db.prepare(`SELECT * FROM loans WHERE user_id = ? AND returned_at IS NULL`).all(req.user.userId)
                .map(l => ({ id: l.id, copy_id: l.copy_id, title_id: l.title_id, book_title: l.book_title, branch: l.branch, user_id: l.user_id, borrowed_at: l.borrowed_at }));
            reservations = db.prepare(`SELECT * FROM reservations WHERE user_id = ? AND status IN ('WAITING', 'READY')`).all(req.user.userId)
                .map(r => {
                    const title = titleRows.find(t => t.id === r.title_id);
                    return { id: r.id, title_id: r.title_id, book_title: title ? title.title : '', branch: r.branch, status: r.status, reserved_at: r.reserved_at, ready_at: r.ready_at, expires_at: r.expires_at };
                });
        }

        const activeLoansCount = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL`).get().n;
        const estatesCount = db.prepare(`SELECT COUNT(DISTINCT branch) AS n FROM copies WHERE branch NOT IN ('TBD', 'All Estates')`).get().n;
        const topBooks = db.prepare(`
            SELECT t.title AS title, t.author AS author, COUNT(*) AS timesBorrowed
            FROM loans l JOIN titles t ON t.id = l.title_id
            GROUP BY l.title_id
            ORDER BY timesBorrowed DESC
            LIMIT 6
        `).all();

        const stats = {
            totalTitles: titleRows.length,
            totalCopies: copyRows.length,
            activeLoans: activeLoansCount,
            estatesCount,
            topBooks
        };

        return res.json({ titles, loans, reservations, stats });
    }));

    return router;
};
