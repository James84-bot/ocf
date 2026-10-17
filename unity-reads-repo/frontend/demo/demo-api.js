/* Unity Shelf demo mode.
 *
 * Open the site with ?demo (e.g. https://james84-bot.github.io/ocf/?demo) and every API call is
 * answered here, in the browser, instead of by the real server. It follows the server's rules
 * (backend/src): one borrow per copy, fines and suspension from the settings, waitlists that
 * hold a returned copy for the next person, library assistant tools and CSV exports.
 *
 * Nothing leaves the browser. Data lives in localStorage until "Reset demo".
 * The catalogue is the real one (812 titles, 1,313 copies), built by
 * backend/scripts/build-demo-catalogue.js. Members, loans and reservations are demo data.
 */
(function () {
    'use strict';
    if (!window.UNITY_SHELF_DEMO) return;   // normal mode: this file does nothing

    var STORE_KEY = 'unity_shelf_demo_v1';
    var PIN = '2580';
    var RESIDENT = { userId: '0700000001', name: 'Demo Resident', estateBranch: 'Unity West', accountType: 'Resident' };
    var ASSISTANT = { userId: 'desk@unityhomes.co.ke', name: 'Demo Library Assistant', estateBranch: 'All Estates', accountType: 'Library Assistant' };
    var DAY = 86400000;

    // Same defaults as backend/src/settings.js (the Unity Homes setup).
    var SETTINGS = {
        orgName: 'Unity Homes', libraryName: 'Knowledge Hub',
        tagline: 'A shared shelf for every Unity Homes estate.',
        intro: 'Borrow a book, pass it on, and meet your neighbours in between.',
        logoUrl: 'logo-mark.png', accentColor: '',
        branches: ['Unity One', 'Unity West', 'Unity East', 'Unity Gardens', 'Silver Hill', 'Unity Parkside'],
        branchLabel: 'Estate', memberLabel: 'Resident', unitLabel: 'Unit Number',
        staffEmailDomain: 'unityhomes.co.ke',
        loanDays: 21, finePerDay: 50, currency: 'KSH', suspendAfterDays: 14, holdHours: 48
    };

    var realFetch = window.fetch.bind(window);
    var db = null;
    var ready = null;

    /* ---------- storage ---------- */
    function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* private mode: keep in memory */ } }
    function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }

    async function sha256Hex(text) {
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function seed() {
        var res = await realFetch(new URL('demo/catalogue.json', document.baseURI).href);
        var cat = await res.json();
        var titles = [], copies = [];
        cat.titles.forEach(function (t) {
            titles.push({ id: t[0], title: t[1], author: t[2], age_bracket: t[3], grade: t[4], cover_image_url: t[5] });
            t[6].forEach(function (c) { copies.push({ copy_id: c[0], title_id: t[0], branch: c[1], status: 'AVAILABLE' }); });
        });
        var now = Date.now();
        var users = {};
        for (var u of [RESIDENT, ASSISTANT]) {
            users[u.userId] = Object.assign({}, u, { passcodeHash: await sha256Hex(u.userId + '::' + PIN), verified: true, failed: 0, lockedUntil: null });
        }
        users['0700000002'] = { userId: '0700000002', name: 'Another Resident', estateBranch: 'Unity East', accountType: 'Resident', passcodeHash: await sha256Hex('0700000002::9999'), verified: true, failed: 0, lockedUntil: null };
        db = { titles: titles, copies: copies, users: users, loans: [], reservations: [], seq: 1 };

        // A little history so every screen has something real to show.
        // One placed copy from each of several different titles, so the sample loans are different books.
        var seen = {}, placed = [];
        copies.forEach(function (c) { if (c.branch !== 'TBD' && !seen[c.title_id]) { seen[c.title_id] = 1; placed.push(c); } });
        borrowAs(RESIDENT.userId, placed[3].copy_id, now - 26 * DAY);           // 5 days overdue: shows a fine
        borrowAs(RESIDENT.userId, placed[40].copy_id, now - 3 * DAY);
        borrowAs('0700000002', placed[12].copy_id, now - 10 * DAY);
        borrowAs('0700000002', placed[7].copy_id, now - 2 * DAY);
        // The resident is waiting for the copy the other member has.
        var held = db.copies.find(function (c) { return c.copy_id === placed[7].copy_id; });
        db.reservations.push({ id: 'r_' + (db.seq++), title_id: held.title_id, branch: held.branch, user_id: RESIDENT.userId,
            reserved_at: new Date(now - DAY).toISOString(), status: 'WAITING', ready_at: null, expires_at: null });
        save();
    }

    function borrowAs(userId, copyId, at) {
        var copy = db.copies.find(function (c) { return c.copy_id === copyId; });
        var title = db.titles.find(function (t) { return t.id === copy.title_id; });
        copy.status = 'ON_LOAN';
        var loan = { id: 'l_' + (db.seq++) + '_' + Math.random().toString(36).slice(2, 6), copy_id: copyId, title_id: copy.title_id,
            book_title: title.title, branch: copy.branch, user_id: userId, borrowed_at: new Date(at).toISOString(), returned_at: null };
        db.loans.push(loan);
        return loan;
    }

    function init() {
        if (!ready) {
            ready = (async function () { db = load(); if (!db || !db.titles) await seed(); })();
        }
        return ready;
    }

    /* ---------- rules (mirrors backend/src/fines.js and routes/reservations.js) ---------- */
    function metrics(borrowedAt) {
        var days = Math.floor((Date.now() - new Date(borrowedAt).getTime()) / DAY);
        var over = days - SETTINGS.loanDays;
        if (over <= 0) return { daysElapsed: days, status: 'NORMAL', fine: 0, lockAccount: false };
        var lock = over >= SETTINGS.suspendAfterDays;
        return { daysElapsed: days, status: lock ? 'SUSPENDED' : 'OVERDUE', fine: over * SETTINGS.finePerDay, lockAccount: lock };
    }
    function isLocked(userId) {
        return db.loans.some(function (l) { return l.user_id === userId && !l.returned_at && metrics(l.borrowed_at).lockAccount; });
    }
    function promoteNext(titleId, branch, copyId) {
        var copy = db.copies.find(function (c) { return c.copy_id === copyId; });
        var next = db.reservations.filter(function (r) { return r.title_id === titleId && r.branch === branch && r.status === 'WAITING'; })
            .sort(function (a, b) { return a.reserved_at < b.reserved_at ? -1 : 1; })[0];
        if (!next) { copy.status = 'AVAILABLE'; return; }
        var now = new Date();
        next.status = 'READY'; next.ready_at = now.toISOString();
        next.expires_at = new Date(now.getTime() + SETTINGS.holdHours * 3600000).toISOString();
        copy.status = 'RESERVED';
    }
    function expireStale() {
        var nowIso = new Date().toISOString();
        db.reservations.filter(function (r) { return r.status === 'READY' && r.expires_at < nowIso; }).forEach(function (r) {
            r.status = 'CANCELLED';
            var held = db.copies.find(function (c) { return c.title_id === r.title_id && c.branch === r.branch && c.status === 'RESERVED'; });
            if (held) promoteNext(r.title_id, r.branch, held.copy_id);
        });
    }

    /* ---------- tiny HTTP helpers ---------- */
    function json(status, body) {
        return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
    }
    function tokenFor(u) { return 'demo.' + btoa(JSON.stringify({ userId: u.userId, accountType: u.accountType })); }
    function caller(headers) {
        var h = headers instanceof Headers ? headers.get('Authorization') : (headers && (headers.Authorization || headers.authorization));
        if (!h || h.indexOf('Bearer demo.') !== 0) return null;
        try {
            var p = JSON.parse(atob(h.slice('Bearer demo.'.length)));
            return db.users[p.userId] ? { userId: p.userId, accountType: db.users[p.userId].accountType } : null;
        } catch (e) { return null; }
    }
    function titleRow(t) {
        return { id: t.id, title: t.title, author: t.author, referenceNo: '', ageBracket: t.age_bracket, grade: t.grade, coverImageUrl: t.cover_image_url,
            copies: db.copies.filter(function (c) { return c.title_id === t.id; }).map(function (c) { return { copyId: c.copy_id, branch: c.branch, status: c.status }; }) };
    }
    function csvCell(v) {
        var s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /* ---------- routes ---------- */
    async function route(path, method, body, headers) {
        await init();
        var me = caller(headers);
        var need = function (role) {
            if (!me) return json(401, { message: 'Missing or malformed Authorization header.' });
            if (role && me.accountType !== role) return json(403, { message: 'Not authorized for this action.' });
            return null;
        };
        var denied;

        if (path === '/api/settings') return json(200, SETTINGS);
        if (path === '/health') return json(200, { ok: true, service: 'unity-shelf-demo' });

        if (path === '/webhook/library-auth') {
            var u = db.users[body.userId];
            if (!u) return json(200, { authenticated: false, message: 'Check your entries.' });
            if (!u.verified) return json(200, { authenticated: false, unverified: true, userId: u.userId, message: 'Please verify your account first.' });
            if (u.lockedUntil && u.lockedUntil > Date.now()) return json(200, { authenticated: false, message: 'Too many failed attempts. Try again after ' + new Date(u.lockedUntil).toLocaleTimeString() + '.' });
            if (body.passcodeHash !== u.passcodeHash) {
                u.failed = (u.failed || 0) + 1;
                if (u.failed >= 5) u.lockedUntil = Date.now() + 15 * 60000;
                save();
                return json(200, { authenticated: false, message: 'Check your entries.' });
            }
            u.failed = 0; u.lockedUntil = null; save();
            var pub = { name: u.name, userId: u.userId, estateBranch: u.estateBranch, accountType: u.accountType };
            return json(200, { authenticated: true, user: pub, token: tokenFor(pub) });
        }

        if (path === '/webhook/library-registration') {
            var staff = body.accountType === 'Staff' || body.accountType === 'Library Assistant';
            var id, branch;
            if (staff) {
                id = String(body.workEmail || '').trim().toLowerCase();
                if (!id.endsWith('@' + SETTINGS.staffEmailDomain)) return json(400, { success: false, message: 'Staff accounts require a work email ending in @' + SETTINGS.staffEmailDomain + '.' });
                branch = 'All Estates';
            } else {
                id = String(body.phone || '').trim();
                branch = String(body.estateBranch || '').trim();
                if (!id) return json(400, { success: false, message: 'A phone number is required to register.' });
                if (SETTINGS.branches.indexOf(branch) === -1) return json(400, { success: false, message: 'Unknown estate: choose one from the list.' });
            }
            if (!body.name || !/^[a-f0-9]{64}$/i.test(body.passcodeHash || '')) return json(400, { message: 'Malformed request.' });
            if (db.users[id]) return json(409, { success: false, message: 'An account already exists for that email/phone.' });
            var code = String(Math.floor(100000 + Math.random() * 900000));
            db.users[id] = { userId: id, name: body.name, estateBranch: branch, accountType: body.accountType, passcodeHash: body.passcodeHash,
                verified: false, code: code, failed: 0, lockedUntil: null };
            save();
            // There is no SMS or email in the demo, so the code is shown instead.
            return json(200, { success: true, userId: id, message: 'Demo: your verification code is ' + code + '. (A real install sends it by SMS or email.)' });
        }

        if (path === '/webhook/library-verify-account') {
            var v = db.users[body.userId];
            if (!v) return json(404, { success: false, message: 'Account not found.' });
            if (v.verified) return json(200, { success: false, message: 'Account is already verified.' });
            if (String(v.code) !== String(body.code)) return json(400, { success: false, message: 'Incorrect code. Please try again.' });
            v.verified = true; delete v.code; save();
            return json(200, { success: true, message: 'Account verified. You can now log in.' });
        }

        if (path === '/webhook/library-change-pin') {
            if ((denied = need())) return denied;
            var cu = db.users[me.userId];
            if (cu.passcodeHash !== body.currentPasscodeHash) return json(400, { success: false, message: 'Current PIN is incorrect.' });
            cu.passcodeHash = body.newPasscodeHash; save();
            return json(200, { success: true, message: 'PIN updated successfully.' });
        }

        if (path === '/webhook/library-sync') {
            expireStale(); save();
            var loans = [], reservations = [];
            if (me) {
                loans = db.loans.filter(function (l) { return l.user_id === me.userId && !l.returned_at; });
                reservations = db.reservations.filter(function (r) { return r.user_id === me.userId && (r.status === 'WAITING' || r.status === 'READY'); })
                    .map(function (r) { var t = db.titles.find(function (x) { return x.id === r.title_id; }); return Object.assign({ book_title: t ? t.title : '' }, r); });
            }
            var counts = {};
            db.loans.forEach(function (l) { counts[l.title_id] = (counts[l.title_id] || 0) + 1; });
            var topBooks = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6).map(function (id) {
                var t = db.titles.find(function (x) { return x.id === id; }); return { title: t.title, author: t.author, timesBorrowed: counts[id] };
            });
            var branches = {};
            db.copies.forEach(function (c) { if (c.branch !== 'TBD' && c.branch !== 'All Estates') branches[c.branch] = 1; });
            return json(200, { titles: db.titles.map(titleRow), loans: loans, reservations: reservations, stats: {
                totalTitles: db.titles.length, totalCopies: db.copies.length,
                activeLoans: db.loans.filter(function (l) { return !l.returned_at; }).length,
                estatesCount: Object.keys(branches).length, topBooks: topBooks } });
        }

        if (path === '/webhook/library-update') {
            if ((denied = need())) return denied;
            var data = body.data || {};
            if (body.event === 'BOOK_BORROWED') {
                if (isLocked(me.userId)) return json(403, { message: 'Account locked: clear overdue fines before borrowing again.' });
                var copy = db.copies.find(function (c) { return c.copy_id === data.copyId; });
                if (!copy) return json(404, { message: 'That copy does not exist.' });
                var claim = null;
                var ok = copy.status === 'AVAILABLE' || (copy.status === 'RESERVED' && (claim = db.reservations.find(function (r) {
                    return r.title_id === copy.title_id && r.branch === copy.branch && r.user_id === me.userId && r.status === 'READY'; })));
                if (!ok) return json(409, { message: 'That copy is no longer available.' });
                var loan = borrowAs(me.userId, copy.copy_id, Date.now());
                if (claim) claim.status = 'FULFILLED';
                save();
                return json(200, { success: true, loanId: loan.id, borrowedAt: loan.borrowed_at });
            }
            var found = data.loanId ? db.loans.find(function (l) { return l.id === data.loanId; }) : null;
            if (!found || found.returned_at) found = db.loans.find(function (l) { return l.copy_id === data.copyId && !l.returned_at; }) || found;
            if (!found || found.returned_at) return json(404, { message: 'That loan is not currently active.' });
            if (me.accountType !== 'Library Assistant' && found.user_id !== me.userId) return json(403, { message: 'You can only return your own loans.' });
            found.returned_at = new Date().toISOString();
            promoteNext(found.title_id, found.branch, found.copy_id);
            save();
            return json(200, { success: true });
        }

        if (path === '/webhook/library-reserve') {
            if ((denied = need())) return denied;
            expireStale();
            if (!db.titles.some(function (t) { return t.id === body.titleId; })) return json(404, { success: false, message: 'Title not found.' });
            if (db.copies.some(function (c) { return c.title_id === body.titleId && c.branch === body.branch && c.status === 'AVAILABLE'; }))
                return json(409, { success: false, message: 'A copy is available at that branch right now. Borrow it directly instead of reserving.' });
            if (db.reservations.some(function (r) { return r.title_id === body.titleId && r.branch === body.branch && r.user_id === me.userId && (r.status === 'WAITING' || r.status === 'READY'); }))
                return json(409, { success: false, message: "You're already on the waitlist for this title at that branch." });
            db.reservations.push({ id: 'r_' + (db.seq++), title_id: body.titleId, branch: body.branch, user_id: me.userId,
                reserved_at: new Date().toISOString(), status: 'WAITING', ready_at: null, expires_at: null });
            save();
            return json(200, { success: true, message: "You're on the waitlist. In a real install you'd get an SMS or email when a copy is ready." });
        }

        if (path === '/webhook/library-cancel-reservation') {
            if ((denied = need())) return denied;
            var res = db.reservations.find(function (r) { return r.id === body.reservationId; });
            if (!res || res.user_id !== me.userId) return json(404, { success: false, message: 'Reservation not found.' });
            if (res.status !== 'WAITING' && res.status !== 'READY') return json(400, { success: false, message: 'That reservation is no longer active.' });
            var wasReady = res.status === 'READY';
            res.status = 'CANCELLED';
            if (wasReady) {
                var heldCopy = db.copies.find(function (c) { return c.title_id === res.title_id && c.branch === res.branch && c.status === 'RESERVED'; });
                if (heldCopy) promoteNext(res.title_id, res.branch, heldCopy.copy_id);
            }
            save();
            return json(200, { success: true });
        }

        if (path === '/webhook/library-admin-overview') {
            if ((denied = need('Library Assistant'))) return denied;
            expireStale(); save();
            var activeLoans = db.loans.filter(function (l) { return !l.returned_at; }).map(function (l) {
                var m = metrics(l.borrowed_at), who = db.users[l.user_id] || {};
                return { id: l.id, copy_id: l.copy_id, book_title: l.book_title, branch: l.branch, borrowerName: who.name, borrowerEstate: who.estateBranch,
                    daysElapsed: m.daysElapsed, overdue: m.status !== 'NORMAL', fine: m.fine };
            });
            var activeRes = db.reservations.filter(function (r) { return r.status === 'WAITING' || r.status === 'READY'; }).map(function (r) {
                var t = db.titles.find(function (x) { return x.id === r.title_id; });
                return { book_title: t ? t.title : '', requesterName: (db.users[r.user_id] || {}).name, branch: r.branch, status: r.status };
            });
            var all = Object.keys(db.users).map(function (k) { return db.users[k]; });
            return json(200, { activeLoans: activeLoans, activeReservations: activeRes, totalMembers: all.length,
                pendingVerifications: all.filter(function (x) { return !x.verified; }).length,
                unassignedCopies: db.copies.filter(function (c) { return c.branch === 'TBD'; }).length });
        }

        if (path === '/webhook/library-admin-unassigned') {
            if ((denied = need('Library Assistant'))) return denied;
            var group = {};
            db.copies.forEach(function (c) { if (c.branch === 'TBD') group[c.title_id] = (group[c.title_id] || 0) + 1; });
            var list = Object.keys(group).map(function (id) { var t = db.titles.find(function (x) { return x.id === id; });
                return { titleId: id, title: t.title, author: t.author, copies: group[id] }; })
                .sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
            return json(200, { titles: list, totalCopies: list.reduce(function (n, r) { return n + r.copies; }, 0), branches: SETTINGS.branches });
        }

        if (path === '/webhook/library-admin-assign-branch') {
            if ((denied = need('Library Assistant'))) return denied;
            if (SETTINGS.branches.indexOf(body.branch) === -1) return json(400, { success: false, message: 'Unknown branch: choose one from the list.' });
            var n = 0;
            db.copies.forEach(function (c) { if (c.branch === 'TBD' && (!body.titleId || c.title_id === body.titleId)) { c.branch = body.branch; n++; } });
            save();
            return json(200, { success: true, updated: n, message: n + ' cop' + (n === 1 ? 'y' : 'ies') + ' placed at ' + body.branch + '.' });
        }

        if (path === '/webhook/library-admin-add-title') {
            if ((denied = need('Library Assistant'))) return denied;
            var count = Number(body.copies);
            if (!body.title || !body.author || ['Adults', 'Kids'].indexOf(body.ageBracket) === -1 || !(count >= 1 && count <= 50))
                return json(400, { message: 'Malformed request.', issues: [{ path: 'title, author, ageBracket or copies' }] });
            if (SETTINGS.branches.indexOf(body.branch) === -1) return json(400, { success: false, message: 'Unknown branch: choose one from the list.' });
            var maxT = db.titles.reduce(function (m, t) { var x = /^T(\d+)$/.exec(t.id); return x ? Math.max(m, +x[1]) : m; }, 0);
            var maxC = db.copies.reduce(function (m, c) { var x = /^C(\d+)$/.exec(c.copy_id); return x ? Math.max(m, +x[1]) : m; }, 0);
            var tid = 'T' + String(maxT + 1).padStart(4, '0');
            var isbn = String(body.isbn || '').replace(/[^0-9Xx]/g, '');
            db.titles.push({ id: tid, title: body.title.trim(), author: body.author.trim(), age_bracket: body.ageBracket, grade: '',
                cover_image_url: isbn.length >= 10 ? 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false' : '' });
            var ids = [];
            for (var i = 1; i <= count; i++) { var cid = 'C' + String(maxC + i).padStart(5, '0'); db.copies.push({ copy_id: cid, title_id: tid, branch: body.branch, status: 'AVAILABLE' }); ids.push(cid); }
            save();
            return json(200, { success: true, titleId: tid, copyIds: ids, message: 'Added "' + body.title.trim() + '" with ' + count + ' cop' + (count === 1 ? 'y' : 'ies') + ' at ' + body.branch + '.' });
        }

        var exp = /^\/webhook\/library-admin-export\/(loans|catalogue)$/.exec(path);
        if (exp) {
            if ((denied = need('Library Assistant'))) return denied;
            var rows, cols;
            if (exp[1] === 'loans') {
                cols = [['id', 'Loan ID'], ['book_title', 'Title'], ['copy_id', 'Copy'], ['branch', 'Branch'], ['borrower', 'Borrower'], ['user_id', 'Member ID'], ['borrowed_at', 'Borrowed'], ['returned_at', 'Returned'], ['fine', 'Current fine (' + SETTINGS.currency + ')']];
                rows = db.loans.slice().reverse().map(function (l) { return Object.assign({ borrower: (db.users[l.user_id] || {}).name, fine: l.returned_at ? '' : metrics(l.borrowed_at).fine }, l); });
            } else {
                cols = [['id', 'Title ID'], ['title', 'Title'], ['author', 'Author'], ['age_bracket', 'Age group'], ['copy_id', 'Copy'], ['branch', 'Branch'], ['status', 'Status']];
                rows = [];
                db.titles.forEach(function (t) { db.copies.filter(function (c) { return c.title_id === t.id; }).forEach(function (c) { rows.push(Object.assign({}, t, c)); }); });
            }
            var csv = [cols.map(function (c) { return csvCell(c[1]); }).join(',')].concat(rows.map(function (r) {
                return cols.map(function (c) { return csvCell(r[c[0]]); }).join(','); })).join('\r\n') + '\r\n';
            return new Response('﻿' + csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'attachment; filename="' + exp[1] + '-demo-' + new Date().toISOString().slice(0, 10) + '.csv"' } });
        }

        return json(404, { message: 'Not found.' });
    }

    /* ---------- fetch interception: only this app's own API paths ---------- */
    window.fetch = async function (input, opts) {
        var url = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
        var path = url.pathname.replace(/^.*?(\/webhook\/|\/api\/settings$|\/health$)/, '$1');
        var ours = /^\/webhook\//.test(path) || path === '/api/settings' || path === '/health';
        if (!ours || /catalogue\.json$/.test(url.pathname)) return realFetch(input, opts);
        var body = {};
        if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = {}; } }
        // A short, realistic delay so loading states are visible.
        await new Promise(function (r) { setTimeout(r, 120); });
        return route(path, (opts && opts.method) || 'GET', body, opts && opts.headers);
    };

    /* ---------- demo banner ---------- */
    function banner() {
        var bar = document.createElement('div');
        bar.className = 'demo-bar';
        bar.setAttribute('role', 'note');
        bar.innerHTML = '<strong>Demo</strong> <span>Runs in your browser with the real catalogue; nothing is sent anywhere.</span>' +
            '<span class="demo-logins">Resident <code>0700000001</code> · Library assistant <code>desk@unityhomes.co.ke</code> · PIN <code>' + PIN + '</code></span>' +
            '<button type="button" class="demo-reset">Reset demo</button><button type="button" class="demo-exit">Exit demo</button>';
        bar.querySelector('.demo-reset').addEventListener('click', function () {
            if (!confirm('Reset the demo? Your demo loans, members and changes will be cleared.')) return;
            try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(window.UNITY_SHELF_STORAGE_KEY); } catch (e) { /* ignore */ }
            location.reload();
        });
        bar.querySelector('.demo-exit').addEventListener('click', function () {
            try { sessionStorage.removeItem('unity_shelf_demo'); } catch (e) { /* ignore */ }
            location.href = location.pathname + '?live';
        });
        document.body.insertBefore(bar, document.body.firstChild);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();

    init();
})();
