# Unity Shelf — Community Library System

A resident/staff library circulation system: browse a catalog, borrow and
return books, join a waitlist when nothing's available, and — for Library
Assistants — a front-desk overview of every active loan and reservation.

```
unity-reads/
├── frontend/               ← static site: index.html, app.js, styles.css
└── backend/                ← Node/Express + SQLite API
    ├── README.md            ← full setup instructions — start here
    ├── seed-data/inventory.xlsx   ← the book catalog, ready to import
    └── ...
```

## Quick start

```bash
cd backend
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into .env as JWT_SECRET
npm run seed -- seed-data/inventory.xlsx
npm run dev
```

Then serve `frontend/` with any static file server (VS Code's Live Server
extension is what the default `.env` CORS setting assumes) and open it in
a browser — it already points at `http://localhost:3000`, so no frontend
configuration is needed.

Full details — environment variables, deployment, database schema, how
reservations work, running the test suite — are in `backend/README.md`.

## Test accounts

Nothing is pre-seeded except the book catalog — register a real account
through the frontend's sign-up form to try it out. Verification codes
print to the backend's terminal when SMTP/SMS aren't configured (the
default), so you can complete the whole flow without setting up email or
SMS providers first.
