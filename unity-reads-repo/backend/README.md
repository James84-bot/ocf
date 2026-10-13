# Unity Shelf Backend (Node/Express + SQLite)

Self-contained library backend — no Google Sheets, no n8n, no external
database service. Everything (users, titles, copies, loans, reservations)
lives in one SQLite file. Serves the same `/webhook/*` routes the frontend
already calls, so no frontend changes are needed.

## Why SQLite over the previous Sheets-backed versions

The earlier versions of this project (n8n → Google Sheets, then a
duplicate-file mixup) had one structural problem no amount of validation
logic could fully close: a full-sheet read followed by a write is two
separate network round-trips, so two people clicking "Borrow" on the last
copy at nearly the same moment could both read "available" before either
write landed. `better-sqlite3` is synchronous and every borrow/return goes
through a single `db.transaction()` — in a single Node process, nothing
else can interleave between the availability check and the write. That's
not a mitigation, it's an actual close of that race condition.

## What's in this pass

- **Real session tokens (JWT).** Login issues one; every route that acts
  on a specific account requires `Authorization: Bearer <token>` and uses
  **the token's** identity — never whatever `userId` the request body
  claims. Verified with an actual test: see `tests/auth.route.test.js`,
  "rejects a borrow attempt with no Authorization header."
- **Input validation** on every route via `zod` (`src/validation.js`) — a
  malformed request gets a clear 400 before it touches the database.
- **Rate limiting** — a general ceiling across the whole API, plus a
  stricter one specifically on login and registration.
- **A real test suite** (`npm test`) — 20 tests against a genuine
  in-memory SQLite database (not a mocked Sheets layer): JWT correctness,
  validation schemas, and integration tests covering login success,
  lockout after repeated failures, the unverified-account block, the
  double-borrow 409 conflict, the server-side fine-lock 403, and — the
  one that matters most — that a resident cannot return someone else's
  loan while a Library Assistant legitimately can.
- **A Library Assistant role** with its own admin-overview endpoint (every
  active loan/reservation across all members — a deliberate, role-gated
  exception to the per-user privacy scoping everywhere else) and the
  ability to mark any loan returned from the front desk.
- **Book reservations** — see "How reservations work" below.
- **A seed script** that imports your actual inventory spreadsheet
  directly into SQLite (`npm run seed`) — see below.

**Also in this version:**
- **Your own branding and rules** from environment variables (`src/settings.js`, see
  `.env.example`): name, logo, accent colour, branches, labels, staff email domain, loan
  period, fine, currency, suspension threshold and hold window. Served to the frontend at
  `GET /api/settings`. Defaults reproduce the original Unity Homes setup.
- **Catalogue tools for Library Assistants:** add a title with copies, place unassigned (`TBD`)
  copies at a branch one title at a time or all at once, and export loans or the catalogue as
  CSV (formula-safe for Excel and Sheets).
- **Branch check at sign-up:** a member can only register at a branch the organisation has.
- **Reservation-ready notices** are actually sent now (email or SMS, or the console fallback),
  and hold expiry also runs on a five-minute timer, not only when someone opens the app.
- **One-server mode:** the backend serves the frontend too (`SERVE_FRONTEND`), so Docker or a
  single Node host runs the whole library at one URL.

**Remaining gaps:** no screen yet for editing or deleting an existing title (edit the database,
or re-seed from the spreadsheet); no member-management screen beyond the overview; the
frontend `app.js` is still one file; no error-tracking service wired in.

## How reservations work

1. A resident tries to borrow a title with 0 available copies at their
   branch → the frontend offers **Reserve** instead.
2. That creates a `WAITING` row in the `reservations` table.
3. When any copy of that title at that branch becomes free (a return, or
   an expired hold reclaimed), the *oldest* waiting reservation gets first
   claim: the copy's status becomes `RESERVED` and the reserver is
   notified by email/SMS.
4. They have **48 hours** to claim it — which happens automatically the
   next time they try to "borrow" that title, since the route recognizes
   the hold is theirs. If they don't claim it in time, the hold expires,
   and the next person in the queue (if any) gets offered the same hold.
5. Expiry runs every five minutes on a timer in `server.js`, and again at
   the top of the sync/reserve/admin-overview requests.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:
- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  The server refuses to start if this is missing or left as the
  placeholder — that's deliberate, not a bug.
- `DATABASE_PATH` — where the SQLite file lives. Default (`./data/unity_shelf.db`)
  is fine locally. **In production, make sure this path is on persistent
  storage** — some hosts (e.g. most free-tier PaaS dynos) wipe the local
  filesystem on every deploy/restart, which would silently reset your
  entire library.
- `CORS_ORIGIN` — the address your frontend runs at. The pre-filled value
  (`http://127.0.0.1:5500,http://localhost:5500`) matches VS Code's Live
  Server extension default. Add your deployed frontend's real URL here
  once you host it somewhere.
- SMTP / Africa's Talking fields — optional to start. Leave blank and
  registration still works; verification codes and reservation-ready
  notices just print to this server's terminal instead of actually being
  sent, so you can test the whole flow immediately and wire up real
  providers later.

## 3. Import your book inventory

```bash
npm run seed -- path/to/your/inventory.xlsx
```

The workbook needs `Titles` and `Copies` sheets matching the schema this
project has used throughout (`id, title, author, publisher, referenceNo,
ageBracket, grade, coverImageUrl, isbn` / `copyId, titleId, branch,
status`). Re-running this replaces the titles/copies tables wholesale, so
re-seeding after editing the spreadsheet always leaves the database
matching the file exactly — it does **not** touch users, loans, or
reservations.

The seed script will tell you about anything worth knowing after import —
e.g. how many copies still have an unassigned branch (`'TBD'`) and need a
real one set before residents can borrow them at a specific location.

## 4. Run it

```bash
npm run dev     # nodemon — restarts on file changes
npm start       # plain node — closer to how it'll actually run in production
```

You should see:
```
Unity Shelf backend running at http://localhost:3000
```

Visit `http://localhost:3000/health` — you should get
`{"ok":true,"service":"unity-shelf-backend"}`.

## 5. Point the frontend at this backend

With `SERVE_FRONTEND=true` (the default) there's nothing to do: open
`http://localhost:3000` and the backend serves the site itself.

If the frontend is hosted somewhere else, set the backend's URL in
`frontend/config.js`. It already handles the two original cases: GitHub
Pages talks to the Railway backend, and VS Code Live Server (port 5500)
talks to `http://localhost:3000`.

## Running the tests

```bash
npm test
```

Runs against a real in-memory SQLite database created fresh for each test
file — never touches your actual `data/unity_shelf.db`, so it's always
safe to run.

## Database schema

Five tables (`src/schema.sql` is the source of truth):

- **users** — `user_id` (work email for Staff/Library Assistant, phone for
  Resident), name, estate_branch (`'All Estates'` for staff-like
  accounts), account_type, passcode_hash, verification/lockout fields.
- **resident_roster** — `unit_number`, `estate_branch` (created but not
  seeded by default — populate it yourself if you want registration to
  cross-check unit numbers against a real roster).
- **titles** — id, title, author, publisher, reference_no, age_bracket,
  grade, cover_image_url, isbn.
- **copies** — copy_id, title_id, branch, status
  (`AVAILABLE` / `ON_LOAN` / `RESERVED`).
- **loans** — id, copy_id, title_id, book_title, branch, user_id,
  borrowed_at, returned_at (`NULL` while active — history is kept, not
  deleted on return, which is also what makes the "trending books" stat
  and the admin overview's overdue tracking possible).
- **reservations** — id, title_id, branch, user_id, reserved_at, status
  (`WAITING` / `READY` / `FULFILLED` / `CANCELLED`), ready_at, expires_at.

## Deploying

This is a plain Node/Express app — any Node host works (Railway, Render,
Fly.io, a VPS, etc.). Three things every option needs:
1. Set the environment variables from `.env.example` in the host's
   dashboard/config (never commit a real `.env`).
2. Make sure `DATABASE_PATH` points at a **persistent** disk/volume, not
   ephemeral container storage — see the note under step 2 above.
3. Run `npm run seed -- path/to/inventory.xlsx` once, after first deploy,
   to populate the catalog (or commit a pre-seeded `.db` file to a private
   location and point `DATABASE_PATH` at it — just keep it out of a public
   GitHub repo, since it contains member PINs' hashes and personal data
   once real people register).

**Do not commit `data/*.db` or `.env` to GitHub** — both are already
listed in `.gitignore`.
