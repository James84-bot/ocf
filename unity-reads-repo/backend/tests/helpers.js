// Real in-memory SQLite per test file (better-sqlite3 supports ':memory:'
// natively), not a mocked Sheets layer — so these tests exercise the
// actual SQL, actual transactions, actual constraints, not a stand-in for
// them.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-real-deployments';
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function buildTestApp() {
    const db = openDatabase(':memory:');
    const app = createApp(db);
    return { app, db };
}

function passcodeHash(userId, pin) {
    return crypto.createHash('sha256').update(`${userId}::${pin}`).digest('hex');
}

module.exports = { buildTestApp, passcodeHash };
