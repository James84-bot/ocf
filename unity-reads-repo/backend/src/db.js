// Opens (and, on first run, creates) the SQLite database. better-sqlite3 is
// synchronous — every call blocks until it's done, no callbacks/promises.
// That's a deliberate fit here, not a limitation: it means the borrow/
// reserve routes can wrap a check-then-write in a single db.transaction()
// and know nothing else touches the database in between, which is exactly
// the race condition the old Google Sheets backend could only narrow, not
// close. A single Node process is genuinely serialized against a single
// SQLite file this way.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDatabase(dbPath) {
    const resolvedPath = dbPath || ':memory:';
    if (resolvedPath !== ':memory:') {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }

    const db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL'); // safe to set even on :memory: — ignored there
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    return db;
}

module.exports = { openDatabase };
