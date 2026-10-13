// Tests for the "run it as your own library" features: organisation settings,
// branch validation at sign-up, Library Assistant catalogue tools, CSV export,
// and reservation-ready notifications.
const request = require('supertest');
const { buildTestApp, passcodeHash } = require('./helpers');
const { signToken } = require('../src/auth');
const { evaluateLoanMetrics } = require('../src/fines');
const { toCsv } = require('../src/routes/admin');

const SETTINGS_ENV = ['ORG_NAME', 'LIBRARY_NAME', 'BRANCHES', 'LOAN_DAYS', 'FINE_PER_DAY', 'SUSPEND_AFTER_DAYS', 'CURRENCY', 'STAFF_EMAIL_DOMAIN'];
afterEach(() => SETTINGS_ENV.forEach(k => delete process.env[k]));

function addUser(db, userId, accountType = 'Resident', estate = 'Unity West') {
    db.prepare(`INSERT INTO users (user_id, name, estate_branch, account_type, passcode_hash, registered_at, verified)
                VALUES (?, ?, ?, ?, ?, ?, 1)`).run(userId, `${accountType} ${userId}`, estate, accountType, passcodeHash(userId, '9876'), new Date().toISOString());
    return signToken({ userId, accountType });
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('organisation settings', () => {
    it('serves Unity Homes defaults when nothing is configured', async () => {
        const { app } = buildTestApp();
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ orgName: 'Unity Homes', loanDays: 21, finePerDay: 50, currency: 'KSH' });
        expect(res.body.branches).toContain('Unity West');
    });

    it('lets another organisation rebrand and set its own rules through environment variables', async () => {
        Object.assign(process.env, { ORG_NAME: 'Riverside Academy', LIBRARY_NAME: 'Riverside Library', BRANCHES: 'Main Campus, Junior School', LOAN_DAYS: '14', FINE_PER_DAY: '20', CURRENCY: 'UGX' });
        const { app } = buildTestApp();
        const res = await request(app).get('/api/settings');
        expect(res.body).toMatchObject({ orgName: 'Riverside Academy', libraryName: 'Riverside Library', loanDays: 14, finePerDay: 20, currency: 'UGX' });
        expect(res.body.branches).toEqual(['Main Campus', 'Junior School']);
    });

    it('applies configured lending rules to fines and suspension on the server', () => {
        Object.assign(process.env, { LOAN_DAYS: '14', FINE_PER_DAY: '20', SUSPEND_AFTER_DAYS: '7' });
        const borrowed = new Date(Date.now() - 20 * 86400000).toISOString(); // 6 days overdue
        expect(evaluateLoanMetrics(borrowed)).toMatchObject({ status: 'OVERDUE', fine: 120, lockAccount: false });
        const longAgo = new Date(Date.now() - 22 * 86400000).toISOString(); // 8 days overdue
        expect(evaluateLoanMetrics(longAgo).lockAccount).toBe(true);
    });

    it('ignores invalid numbers instead of breaking the rules', async () => {
        Object.assign(process.env, { LOAN_DAYS: 'abc', FINE_PER_DAY: '-5' });
        const { app } = buildTestApp();
        const res = await request(app).get('/api/settings');
        expect(res.body).toMatchObject({ loanDays: 21, finePerDay: 50 });
    });
});

describe('sign-up branch check', () => {
    it('rejects a branch the organisation does not have', async () => {
        const { app } = buildTestApp();
        const res = await request(app).post('/webhook/library-registration').send({
            name: 'Mallory', estateBranch: 'Made Up Estate', accountType: 'Resident',
            passcodeHash: passcodeHash('0799999999', '2468'), phone: '0799999999', unitNumber: 'X1'
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown estate/i);
    });

    it('accepts a configured branch', async () => {
        process.env.BRANCHES = 'Main Campus,Junior School';
        const { app } = buildTestApp();
        const res = await request(app).post('/webhook/library-registration').send({
            name: 'Amina', estateBranch: 'Junior School', accountType: 'Resident',
            passcodeHash: passcodeHash('0788888888', '2468'), phone: '0788888888', unitNumber: 'J-12'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('Library Assistant catalogue tools', () => {
    let app, db, assistant, resident;
    beforeEach(() => {
        ({ app, db } = buildTestApp());
        assistant = addUser(db, 'desk@unityhomes.co.ke', 'Library Assistant', 'All Estates');
        resident = addUser(db, '0711000000');
        db.prepare(`INSERT INTO titles (id, title, author, age_bracket) VALUES ('T0007', 'Ant Attack', 'A. Mcgowan', 'Kids')`).run();
        db.prepare(`INSERT INTO copies (copy_id, title_id, branch, status) VALUES ('C00009', 'T0007', 'TBD', 'AVAILABLE'), ('C00010', 'T0007', 'TBD', 'AVAILABLE')`).run();
    });

    it('refuses residents (403) and anonymous callers (401)', async () => {
        const body = { title: 'X', author: 'Y', ageBracket: 'Adults', branch: 'Unity West', copies: 1 };
        expect((await request(app).post('/webhook/library-admin-add-title').set(bearer(resident)).send(body)).status).toBe(403);
        expect((await request(app).post('/webhook/library-admin-add-title').send(body)).status).toBe(401);
        expect((await request(app).get('/webhook/library-admin-export/loans').set(bearer(resident))).status).toBe(403);
    });

    it('adds a title with copies, numbered after the existing ones, and it appears in the catalogue', async () => {
        const res = await request(app).post('/webhook/library-admin-add-title').set(bearer(assistant))
            .send({ title: 'The River and the Source', author: 'Margaret Ogola', ageBracket: 'Adults', isbn: '978-9966-882-05-9', branch: 'Unity East', copies: 3 });
        expect(res.status).toBe(200);
        expect(res.body.titleId).toBe('T0008');
        expect(res.body.copyIds).toEqual(['C00011', 'C00012', 'C00013']);

        const sync = await request(app).post('/webhook/library-sync').send({});
        const added = sync.body.titles.find(t => t.id === 'T0008');
        expect(added.copies).toHaveLength(3);
        expect(added.copies.every(c => c.branch === 'Unity East' && c.status === 'AVAILABLE')).toBe(true);
        expect(added.coverImageUrl).toContain('9789966882059');
    });

    it('rejects an unknown branch and a malformed body', async () => {
        const bad = await request(app).post('/webhook/library-admin-add-title').set(bearer(assistant))
            .send({ title: 'X', author: 'Y', ageBracket: 'Adults', branch: 'Nowhere', copies: 1 });
        expect(bad.status).toBe(400);
        const malformed = await request(app).post('/webhook/library-admin-add-title').set(bearer(assistant))
            .send({ title: '', author: 'Y', ageBracket: 'Adults', branch: 'Unity West', copies: 0 });
        expect(malformed.status).toBe(400);
    });

    it('lists unassigned copies and places them at a branch', async () => {
        const list = await request(app).post('/webhook/library-admin-unassigned').set(bearer(assistant));
        expect(list.body.totalCopies).toBe(2);
        expect(list.body.titles[0]).toMatchObject({ titleId: 'T0007', copies: 2 });

        const assign = await request(app).post('/webhook/library-admin-assign-branch').set(bearer(assistant))
            .send({ titleId: 'T0007', branch: 'Unity Gardens' });
        expect(assign.body.updated).toBe(2);
        const left = db.prepare(`SELECT COUNT(*) AS n FROM copies WHERE branch = 'TBD'`).get().n;
        expect(left).toBe(0);
    });

    it('exports loans as CSV that spreadsheet apps cannot execute', async () => {
        db.prepare(`UPDATE users SET name = '=HYPERLINK("http://evil")' WHERE user_id = '0711000000'`).run();
        db.prepare(`INSERT INTO loans (id, copy_id, title_id, book_title, branch, user_id, borrowed_at) VALUES ('L1', 'C00009', 'T0007', 'Ant Attack', 'Unity West', '0711000000', ?)`)
            .run(new Date().toISOString());
        const res = await request(app).get('/webhook/library-admin-export/loans').set(bearer(assistant));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
        expect(res.text).not.toMatch(/,=HYPERLINK/);
    });
});

describe('CSV helper', () => {
    it('quotes commas and quotes and neutralises formulas', () => {
        const csv = toCsv([{ a: 'x, y', b: 'say "hi"', c: '+1' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
        expect(csv).toBe('A,B,C\r\n"x, y","say ""hi""",\'+1\r\n');
    });
});

describe('reservation-ready notice', () => {
    it('tells the next person in the queue when a returned copy is held for them', async () => {
        const { app, db } = buildTestApp();
        const borrower = addUser(db, '0722000000');
        addUser(db, '0733000000');
        const waiter = signToken({ userId: '0733000000', accountType: 'Resident' });
        db.prepare(`INSERT INTO titles (id, title, author, age_bracket) VALUES ('T0001', 'Ant Attack', 'A. Mcgowan', 'Kids')`).run();
        db.prepare(`INSERT INTO copies (copy_id, title_id, branch, status) VALUES ('C00001', 'T0001', 'Unity West', 'AVAILABLE')`).run();

        const logs = [];
        const spy = jest.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
        try {
            await request(app).post('/webhook/library-update').set(bearer(borrower))
                .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001', titleId: 'T0001', branch: 'Unity West' } });
            const reserve = await request(app).post('/webhook/library-reserve').set(bearer(waiter)).send({ titleId: 'T0001', branch: 'Unity West' });
            expect(reserve.body.success).toBe(true);
            const loan = db.prepare(`SELECT id FROM loans WHERE returned_at IS NULL`).get();
            await request(app).post('/webhook/library-update').set(bearer(borrower))
                .send({ event: 'BOOK_RETURNED', data: { copyId: 'C00001', loanId: loan.id } });
            await new Promise(r => setImmediate(r));
            await new Promise(r => setImmediate(r));
        } finally {
            spy.mockRestore();
        }
        expect(db.prepare(`SELECT status FROM reservations`).get().status).toBe('READY');
        expect(logs.some(l => l.includes('0733000000') && l.includes('Ant Attack') && l.includes('ready for pickup'))).toBe(true);
    });
});
