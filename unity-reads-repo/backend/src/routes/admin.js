const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { evaluateLoanMetrics } = require('../fines');
const { expireStaleReservations } = require('./reservations');
const { asyncRoute } = require('../middleware/errorHandler');

module.exports = function adminRoutes(db) {
    const router = express.Router();

    router.post('/webhook/library-admin-overview', requireAuth, requireRole('Library Assistant'), asyncRoute(async (req, res) => {
        expireStaleReservations(db);

        const loanRows = db.prepare(`
            SELECT l.*, u.name AS borrower_name, u.estate_branch AS borrower_estate
            FROM loans l JOIN users u ON u.user_id = l.user_id
            WHERE l.returned_at IS NULL
            ORDER BY l.borrowed_at ASC
        `).all();

        const activeLoans = loanRows.map(l => {
            const metrics = evaluateLoanMetrics(l.borrowed_at);
            return {
                id: l.id, copy_id: l.copy_id, book_title: l.book_title, branch: l.branch,
                borrowerName: l.borrower_name, borrowerEstate: l.borrower_estate,
                daysElapsed: metrics.daysElapsed, overdue: metrics.status !== 'NORMAL'
            };
        });

        const reservationRows = db.prepare(`
            SELECT r.*, t.title AS book_title, u.name AS requester_name
            FROM reservations r
            JOIN titles t ON t.id = r.title_id
            JOIN users u ON u.user_id = r.user_id
            WHERE r.status IN ('WAITING', 'READY')
            ORDER BY r.reserved_at ASC
        `).all();

        const activeReservations = reservationRows.map(r => ({
            book_title: r.book_title, requesterName: r.requester_name, branch: r.branch, status: r.status
        }));

        const totalMembers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
        const pendingVerifications = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE verified = 0`).get().n;

        return res.json({ activeLoans, activeReservations, totalMembers, pendingVerifications });
    }));

    return router;
};
