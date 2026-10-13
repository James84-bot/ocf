const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { evaluateLoanMetrics } = require('../fines');
const { expireStaleReservations } = require('./reservations');
const { asyncRoute } = require('../middleware/errorHandler');
const { validateBody, addTitleSchema, assignBranchSchema } = require('../validation');
const { getSettings } = require('../settings');

const UNASSIGNED = 'TBD';

// Next id in a "T0001" / "C00001" style sequence. Only ids that match the
// pattern count, so hand-made ids in the spreadsheet can't break numbering.
function nextId(db, table, column, prefix, width) {
    const rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE ?`).all(`${prefix}%`);
    const max = rows.reduce((m, r) => {
        const match = new RegExp(`^${prefix}(\\d+)$`).exec(r.id);
        return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return (offset = 1) => `${prefix}${String(max + offset).padStart(width, '0')}`;
}

// CSV for spreadsheet apps. Cells starting with = + - @ are prefixed with an
// apostrophe so a member name can't run as a formula when staff open the file.
function toCsv(rows, columns) {
    const cell = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns.map(c => cell(c.label)).join(','),
        ...rows.map(r => columns.map(c => cell(r[c.key])).join(','))].join('\r\n') + '\r\n';
}

module.exports = function adminRoutes(db) {
    const router = express.Router();
    const assistantOnly = [requireAuth, requireRole('Library Assistant')];

    router.post('/webhook/library-admin-overview', ...assistantOnly, asyncRoute(async (req, res) => {
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
                daysElapsed: metrics.daysElapsed, overdue: metrics.status !== 'NORMAL', fine: metrics.fine
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
        const unassignedCopies = db.prepare(`SELECT COUNT(*) AS n FROM copies WHERE branch = ?`).get(UNASSIGNED).n;

        return res.json({ activeLoans, activeReservations, totalMembers, pendingVerifications, unassignedCopies });
    }));

    // Titles that still have copies with no branch, so staff can place them.
    router.post('/webhook/library-admin-unassigned', ...assistantOnly, asyncRoute(async (req, res) => {
        const rows = db.prepare(`
            SELECT t.id AS titleId, t.title, t.author, COUNT(c.copy_id) AS copies
            FROM copies c JOIN titles t ON t.id = c.title_id
            WHERE c.branch = ?
            GROUP BY t.id ORDER BY t.title COLLATE NOCASE
        `).all(UNASSIGNED);
        return res.json({ titles: rows, totalCopies: rows.reduce((n, r) => n + r.copies, 0), branches: getSettings().branches });
    }));

    // Place unassigned copies at a branch: one title's copies, or all of them.
    router.post('/webhook/library-admin-assign-branch', ...assistantOnly, validateBody(assignBranchSchema), asyncRoute(async (req, res) => {
        const { branch, titleId } = req.body;
        if (!getSettings().branches.includes(branch)) {
            return res.status(400).json({ success: false, message: 'Unknown branch: choose one from the list.' });
        }
        const result = titleId
            ? db.prepare(`UPDATE copies SET branch = ? WHERE branch = ? AND title_id = ?`).run(branch, UNASSIGNED, titleId)
            : db.prepare(`UPDATE copies SET branch = ? WHERE branch = ?`).run(branch, UNASSIGNED);
        return res.json({ success: true, updated: result.changes, message: `${result.changes} cop${result.changes === 1 ? 'y' : 'ies'} placed at ${branch}.` });
    }));

    // Add a new title with one or more physical copies at a branch.
    router.post('/webhook/library-admin-add-title', ...assistantOnly, validateBody(addTitleSchema), asyncRoute(async (req, res) => {
        const { title, author, ageBracket, grade, isbn, branch, copies } = req.body;
        if (!getSettings().branches.includes(branch)) {
            return res.status(400).json({ success: false, message: 'Unknown branch: choose one from the list.' });
        }

        const created = db.transaction(() => {
            const titleId = nextId(db, 'titles', 'id', 'T', 4)();
            const copyId = nextId(db, 'copies', 'copy_id', 'C', 5);
            const isbnDigits = (isbn || '').replace(/[^0-9Xx]/g, '');
            const cover = isbnDigits.length >= 10 ? `https://covers.openlibrary.org/b/isbn/${isbnDigits}-L.jpg?default=false` : null;
            db.prepare(`
                INSERT INTO titles (id, title, author, reference_no, age_bracket, grade, cover_image_url, isbn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(titleId, title, author, isbn || null, ageBracket, grade || null, cover, isbnDigits || null);
            const insertCopy = db.prepare(`INSERT INTO copies (copy_id, title_id, branch, status) VALUES (?, ?, ?, 'AVAILABLE')`);
            const copyIds = [];
            for (let i = 1; i <= copies; i++) { const id = copyId(i); insertCopy.run(id, titleId, branch); copyIds.push(id); }
            return { titleId, copyIds };
        })();

        return res.json({ success: true, ...created, message: `Added "${title}" with ${copies} cop${copies === 1 ? 'y' : 'ies'} at ${branch}.` });
    }));

    // CSV exports for records and reporting.
    router.get('/webhook/library-admin-export/:kind', ...assistantOnly, asyncRoute(async (req, res) => {
        const { currency } = getSettings();
        let rows, columns, name;
        if (req.params.kind === 'loans') {
            rows = db.prepare(`
                SELECT l.id, l.book_title, l.copy_id, l.branch, u.name AS borrower, l.user_id, l.borrowed_at, l.returned_at
                FROM loans l LEFT JOIN users u ON u.user_id = l.user_id ORDER BY l.borrowed_at DESC
            `).all().map(r => ({ ...r, fine: r.returned_at ? '' : evaluateLoanMetrics(r.borrowed_at).fine }));
            columns = [
                { key: 'id', label: 'Loan ID' }, { key: 'book_title', label: 'Title' }, { key: 'copy_id', label: 'Copy' },
                { key: 'branch', label: 'Branch' }, { key: 'borrower', label: 'Borrower' }, { key: 'user_id', label: 'Member ID' },
                { key: 'borrowed_at', label: 'Borrowed' }, { key: 'returned_at', label: 'Returned' }, { key: 'fine', label: `Current fine (${currency})` }
            ];
            name = 'loans';
        } else if (req.params.kind === 'catalogue') {
            rows = db.prepare(`
                SELECT t.id, t.title, t.author, t.age_bracket, t.isbn, c.copy_id, c.branch, c.status
                FROM copies c JOIN titles t ON t.id = c.title_id ORDER BY t.title COLLATE NOCASE, c.copy_id
            `).all();
            columns = [
                { key: 'id', label: 'Title ID' }, { key: 'title', label: 'Title' }, { key: 'author', label: 'Author' },
                { key: 'age_bracket', label: 'Age group' }, { key: 'isbn', label: 'ISBN' }, { key: 'copy_id', label: 'Copy' },
                { key: 'branch', label: 'Branch' }, { key: 'status', label: 'Status' }
            ];
            name = 'catalogue';
        } else {
            return res.status(404).json({ message: 'Unknown export. Use loans or catalogue.' });
        }
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
        return res.send('﻿' + toCsv(rows, columns));
    }));

    return router;
};

module.exports.toCsv = toCsv;
