// Mirrors evaluateLoanMetrics() in the frontend's app.js. The rules (loan
// period, fine per day, suspension threshold) come from src/settings.js, so
// each organisation sets its own; defaults are 21 days, KSH 50/day, lock
// at 14 days overdue. The frontend
// computes this for its own optimistic UI, but a user could bypass that by
// calling the API directly — so the borrow route re-derives this itself
// from the database rather than trusting anything the client says about
// its own fine status.
const { getSettings } = require('./settings');

function evaluateLoanMetrics(borrowedAtIso, now = new Date()) {
    const { loanDays, finePerDay, suspendAfterDays } = getSettings();
    const borrowDate = new Date(borrowedAtIso);
    const daysElapsed = Math.floor((now - borrowDate) / (1000 * 60 * 60 * 24));

    let status = 'NORMAL';
    let fine = 0;
    let lockAccount = false;

    if (daysElapsed > loanDays) {
        status = 'OVERDUE';
        fine = (daysElapsed - loanDays) * finePerDay;
        if ((daysElapsed - loanDays) >= suspendAfterDays) {
            lockAccount = true;
            status = 'SUSPENDED';
        }
    }
    return { daysElapsed, status, fine, lockAccount };
}

// True if this user has any active (unreturned) loan that's overdue enough
// to trigger a suspension. Used by the borrow route to enforce the lock
// server-side, independent of whatever the client's own UI already did.
function isAccountLocked(db, userId) {
    const activeLoans = db.prepare(
        `SELECT borrowed_at FROM loans WHERE user_id = ? AND returned_at IS NULL`
    ).all(userId);
    return activeLoans.some(l => evaluateLoanMetrics(l.borrowed_at).lockAccount);
}

module.exports = { evaluateLoanMetrics, isAccountLocked };
