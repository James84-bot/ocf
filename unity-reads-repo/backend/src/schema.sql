-- Unity Shelf — SQLite schema
-- Mirrors the six-tab Google Sheets model this backend replaces, with real
-- foreign keys and indexes instead of sheet lookups.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    user_id               TEXT PRIMARY KEY,   -- work email (Staff/Library Assistant) or phone (Resident)
    name                  TEXT NOT NULL,
    estate_branch         TEXT NOT NULL,      -- one of the real estates, or 'All Estates' for staff-like accounts
    account_type          TEXT NOT NULL CHECK (account_type IN ('Resident', 'Staff', 'Library Assistant')),
    unit_number           TEXT,
    phone                 TEXT,
    work_email            TEXT,
    passcode_hash         TEXT NOT NULL,      -- sha256(userId::pin), computed client-side and never re-derived here
    registered_at         TEXT NOT NULL,
    failed_attempts       INTEGER NOT NULL DEFAULT 0,
    locked_until          TEXT,
    verified              INTEGER NOT NULL DEFAULT 0, -- 0/1
    verification_code     TEXT,
    verification_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS resident_roster (
    unit_number   TEXT PRIMARY KEY,
    estate_branch TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    author           TEXT,
    publisher        TEXT,
    reference_no     TEXT,
    age_bracket      TEXT,        -- normalized to 'Adults' | 'Kids' at write time
    grade            TEXT,
    cover_image_url  TEXT,
    isbn             TEXT
);

CREATE TABLE IF NOT EXISTS copies (
    copy_id  TEXT PRIMARY KEY,
    title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    branch   TEXT NOT NULL,
    status   TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'ON_LOAN', 'RESERVED')) DEFAULT 'AVAILABLE'
);
CREATE INDEX IF NOT EXISTS idx_copies_title ON copies(title_id);
CREATE INDEX IF NOT EXISTS idx_copies_branch_status ON copies(branch, status);

CREATE TABLE IF NOT EXISTS loans (
    id          TEXT PRIMARY KEY,
    copy_id     TEXT NOT NULL REFERENCES copies(copy_id),
    title_id    TEXT NOT NULL REFERENCES titles(id),
    book_title  TEXT NOT NULL,   -- denormalized snapshot, matches the sheet-era model the frontend expects
    branch      TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(user_id),
    borrowed_at TEXT NOT NULL,
    returned_at TEXT             -- NULL while the loan is active
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_copy ON loans(copy_id);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(returned_at);

CREATE TABLE IF NOT EXISTS reservations (
    id          TEXT PRIMARY KEY,
    title_id    TEXT NOT NULL REFERENCES titles(id),
    branch      TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(user_id),
    reserved_at TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('WAITING', 'READY', 'FULFILLED', 'CANCELLED')) DEFAULT 'WAITING',
    ready_at    TEXT,
    expires_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservations_title_branch ON reservations(title_id, branch, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
