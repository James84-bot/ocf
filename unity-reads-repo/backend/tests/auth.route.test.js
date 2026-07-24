const request = require('supertest');
const { buildTestApp, passcodeHash } = require('./helpers');

function insertVerifiedUser(db, { userId, name = 'Test User', estateBranch = 'Unity West', accountType = 'Resident', pin = '4321' }) {
    db.prepare(`
        INSERT INTO users (user_id, name, estate_branch, account_type, passcode_hash, registered_at, verified)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(userId, name, estateBranch, accountType, passcodeHash(userId, pin), new Date().toISOString());
}

function insertTitleWithCopy(db, { titleId = 'T0001', copyId = 'C00001', branch = 'Unity West' } = {}) {
    db.prepare(`INSERT INTO titles (id, title, author, age_bracket) VALUES (?, 'Ant Attack', 'Anthony Mcgowan', 'Kids')`).run(titleId);
    db.prepare(`INSERT INTO copies (copy_id, title_id, branch, status) VALUES (?, ?, ?, 'AVAILABLE')`).run(copyId, titleId, branch);
}

describe('POST /webhook/library-auth', () => {
    let app, db;
    beforeEach(() => { ({ app, db } = buildTestApp()); });

    it('logs in with the correct passcode hash and returns a token', async () => {
        insertVerifiedUser(db, { userId: '0712345678' });
        const res = await request(app).post('/webhook/library-auth')
            .send({ userId: '0712345678', passcodeHash: passcodeHash('0712345678', '4321') });
        expect(res.status).toBe(200);
        expect(res.body.authenticated).toBe(true);
        expect(typeof res.body.token).toBe('string');
    });

    it('blocks login for an unverified account', async () => {
        db.prepare(`
            INSERT INTO users (user_id, name, estate_branch, account_type, passcode_hash, registered_at, verified)
            VALUES ('0700000000', 'Unverified', 'Unity West', 'Resident', ?, ?, 0)
        `).run(passcodeHash('0700000000', '4321'), new Date().toISOString());

        const res = await request(app).post('/webhook/library-auth')
            .send({ userId: '0700000000', passcodeHash: passcodeHash('0700000000', '4321') });
        expect(res.body.authenticated).toBe(false);
        expect(res.body.unverified).toBe(true);
    });

    it('locks the account after 5 wrong-PIN attempts', async () => {
        insertVerifiedUser(db, { userId: '0711111111' });
        for (let i = 0; i < 5; i++) {
            await request(app).post('/webhook/library-auth').send({ userId: '0711111111', passcodeHash: 'a'.repeat(64) });
        }
        const res = await request(app).post('/webhook/library-auth')
            .send({ userId: '0711111111', passcodeHash: passcodeHash('0711111111', '4321') });
        expect(res.body.authenticated).toBe(false);
        expect(res.body.message).toMatch(/too many failed attempts/i);
    });

    it('rejects a malformed body with 400 instead of touching the database', async () => {
        const res = await request(app).post('/webhook/library-auth').send({ userId: '0712345678' }); // missing passcodeHash
        expect(res.status).toBe(400);
    });
});

describe('POST /webhook/library-update (borrow/return)', () => {
    let app, db, token;
    beforeEach(async () => {
        ({ app, db } = buildTestApp());
        insertVerifiedUser(db, { userId: '0712345678' });
        insertTitleWithCopy(db);
        const login = await request(app).post('/webhook/library-auth')
            .send({ userId: '0712345678', passcodeHash: passcodeHash('0712345678', '4321') });
        token = login.body.token;
    });

    it('rejects a borrow attempt with no Authorization header (the impersonation-hole fix)', async () => {
        const res = await request(app).post('/webhook/library-update')
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(401);
    });

    it('borrows successfully with a valid token', async () => {
        const res = await request(app).post('/webhook/library-update')
            .set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 409 when the same copy is borrowed twice', async () => {
        await request(app).post('/webhook/library-update').set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });
        const res = await request(app).post('/webhook/library-update').set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(409);
    });

    it('blocks a new borrow when the caller has an overdue-enough active loan (server-side fine lock)', async () => {
        // Insert a loan that's 40 days old — past the 21-day grace period
        // plus the 14-day-overdue lock threshold — for a *different* copy.
        db.prepare(`INSERT INTO copies (copy_id, title_id, branch, status) VALUES ('C00002', 'T0001', 'Unity West', 'ON_LOAN')`).run();
        const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare(`INSERT INTO loans (id, copy_id, title_id, book_title, branch, user_id, borrowed_at) VALUES ('l_old', 'C00002', 'T0001', 'Ant Attack', 'Unity West', '0712345678', ?)`).run(oldDate);

        const res = await request(app).post('/webhook/library-update').set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(403);
    });

    it("prevents one resident from returning another resident's loan", async () => {
        insertVerifiedUser(db, { userId: '0799999999', name: 'Other Resident' });
        const otherLogin = await request(app).post('/webhook/library-auth')
            .send({ userId: '0799999999', passcodeHash: passcodeHash('0799999999', '4321') });

        await request(app).post('/webhook/library-update').set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });

        const res = await request(app).post('/webhook/library-update')
            .set('Authorization', `Bearer ${otherLogin.body.token}`)
            .send({ event: 'BOOK_RETURNED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(403);
    });

    it('lets a Library Assistant return a loan on behalf of a resident', async () => {
        insertVerifiedUser(db, { userId: 'assistant@unityhomes.co.ke', accountType: 'Library Assistant' });
        const assistantLogin = await request(app).post('/webhook/library-auth')
            .send({ userId: 'assistant@unityhomes.co.ke', passcodeHash: passcodeHash('assistant@unityhomes.co.ke', '4321') });

        await request(app).post('/webhook/library-update').set('Authorization', `Bearer ${token}`)
            .send({ event: 'BOOK_BORROWED', data: { copyId: 'C00001' } });

        const res = await request(app).post('/webhook/library-update')
            .set('Authorization', `Bearer ${assistantLogin.body.token}`)
            .send({ event: 'BOOK_RETURNED', data: { copyId: 'C00001' } });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
