require('dotenv').config();
const { createApp } = require('./src/app');
const { openDatabase } = require('./src/db');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace-this-with-a-long-random-string') {
    console.error(
        '\nJWT_SECRET is missing or still set to the placeholder value.\n' +
        'Locally: copy .env.example to .env and set a real one.\n' +
        'On Railway: set it under your service\'s Variables tab. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
    );
    process.exit(1);
}

const { expireStaleReservations } = require('./src/routes/reservations');

const db = openDatabase(process.env.DATABASE_PATH || './data/unity_shelf.db');
const app = createApp(db);

const port = process.env.PORT || 3000;
// Binding to 0.0.0.0 explicitly (rather than leaving the host unset) is
// required on Railway and most container platforms -- they route traffic
// to the container's external interface, not just localhost.
app.listen(port, '0.0.0.0', () => {
    console.log(`Unity Shelf backend running on port ${port}`);
});

// Hold expiry on a timer, so an uncollected book moves to the next person in
// the queue even when nobody opens the app. unref() lets the process exit cleanly.
const SWEEP_MS = 5 * 60 * 1000;
setInterval(() => {
    try { expireStaleReservations(db); } catch (err) { console.error('Reservation sweep failed:', err.message); }
}, SWEEP_MS).unref();