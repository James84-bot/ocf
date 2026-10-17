# Unity Shelf

A library system any organisation can run as its own: residential estates, schools,
companies, churches and community libraries. Members browse the catalogue, borrow, return
and join a waitlist; library staff get a front desk view, catalogue tools and CSV exports.

It started as the library for the Unity Homes estates in Tatu City, which is what it shows
by default. Change a few settings and it becomes your library: your name, logo, colour,
branches, wording and lending rules. No code changes.

```
unity-reads-repo/
├── frontend/          static site: index.html, app.js, styles.css, config.js
├── backend/           Node/Express + SQLite API (also serves the frontend)
│   ├── README.md      full reference: environment, schema, reservations, tests
│   └── seed-data/inventory.xlsx   example catalogue (812 titles, 1,313 copies)
├── Dockerfile
└── docker-compose.yml
```

## Try it

**Live demo:** <https://james84-bot.github.io/ocf/?demo>. It runs entirely in your browser with the real
catalogue (812 titles, 1,313 copies) and demo accounts shown at the top of the page; nothing is sent
anywhere and **Reset demo** starts over. Log in as the resident to borrow, return and join a waitlist, or as
the library assistant for the front desk, adding books, placing copies and CSV exports.

## What it does

- **Catalogue:** search by title or author, filter by availability, adults' and children's
  sections, live counts of titles, copies, loans and branches.
- **Borrowing:** one tap per branch. Two people can never borrow the same last copy: the check
  and the write happen in one SQLite transaction, and the second request gets a 409.
- **Waitlists:** reserve a title when every copy is out. When a copy comes back, the first person
  in the queue is notified by SMS or email and has a set number of hours to collect it.
- **Fines and suspension:** worked out on the server from your own rules.
- **Accounts:** members sign up with their phone number and their own PIN, verified by a code.
  Staff and library assistants sign up with a work email on your domain.
- **Library assistant tools:** every active loan and reservation, mark a book returned, add new
  books with copies, place unassigned copies at a branch, export loans and the catalogue to CSV.
- **Security:** session tokens (JWT), identity always taken from the token, input validation on
  every route, rate limiting, account lockout after repeated wrong PINs, escaped output, and
  formula-safe CSV exports.

## Run your own library

### With Docker (one command)

```bash
cp backend/.env.example backend/.env
# edit backend/.env: JWT_SECRET, and your name, branches and rules (see below)
docker compose up -d
docker compose exec library node backend/scripts/seed.js backend/seed-data/inventory.xlsx   # optional: import books
```

Open http://localhost:3000. Members, loans and books live in a Docker volume, so they survive
restarts and upgrades.

### With Node

```bash
cd backend
npm install
cp .env.example .env        # set JWT_SECRET (and your settings)
npm run seed -- seed-data/inventory.xlsx    # or your own spreadsheet
npm start
```

Open http://localhost:3000.

## Make it yours

Set these in `backend/.env` (or your host's environment variables). All are optional; the
defaults are the Unity Homes setup.

| Setting | Example | What it changes |
|---|---|---|
| `ORG_NAME` | `Riverside Academy` | Organisation name throughout |
| `LIBRARY_NAME` | `Riverside Library` | Header, page title, emails and SMS |
| `LIBRARY_TAGLINE`, `LIBRARY_INTRO` | | Headline and intro on the sign-in page |
| `LOGO_URL` | `my-logo.png` or `none` | Square logo in the header |
| `ACCENT_COLOR` | `#1F7A5A` | Buttons, highlights and tints |
| `BRANCHES` | `Main Campus,Junior School` | Where books live and members belong |
| `BRANCH_LABEL`, `MEMBER_LABEL`, `UNIT_LABEL` | `Campus`, `Student`, `Admission Number` | Wording on the sign-up form |
| `STAFF_EMAIL_DOMAIN` | `riverside.ac.ke` | Who can register as staff or library assistant |
| `LOAN_DAYS`, `FINE_PER_DAY`, `CURRENCY` | `14`, `20`, `KES` | Lending rules (enforced on the server) |
| `SUSPEND_AFTER_DAYS`, `HOLD_HOURS` | `14`, `48` | When overdue accounts are suspended; how long a held book waits |

Your catalogue comes from a spreadsheet with `Titles` and `Copies` sheets (see
`backend/README.md`), or add books one by one from the Admin Dashboard. Copies imported without
a branch show up there under **Copies Without a Branch** so staff can place them.

### Demo mode

`frontend/demo/demo-api.js` answers the app's API calls in the browser when the page is opened with `?demo`,
following the same rules as the server. Rebuild its catalogue after changing your books:
`npm run seed -- seed-data/inventory.xlsx && npm run demo-catalogue` (in `backend/`). Open with `?live` to
leave demo mode.

SMS (Africa's Talking) and email (any SMTP server) are optional. Without them, verification codes
and notices print to the server log, so you can try the whole flow first.

## Deploying

Any Node host or Docker host works (Railway, Render, Fly.io, a VPS). Keep the database on
persistent storage: see `backend/RAILWAY_DEPLOY.md` for the Railway volume setup. To host the
frontend separately (for example GitHub Pages), set `SERVE_FRONTEND=false` on the backend, put
the backend's URL in `frontend/config.js`, and add the frontend's address to `CORS_ORIGIN`.

## Tests

```bash
cd backend && npm test
```

35 tests against a real in-memory SQLite database: sign-in and lockout, the double-borrow 409, returns,
fines and suspension, branch checks, settings, catalogue tools, CSV safety and waitlist notices.
They run on every push and pull request (`.github/workflows/test.yml`).
