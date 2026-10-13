// Organisation settings: everything that makes this deployment "yours".
//
// Unity Shelf started as the Unity Homes library. To run it for another
// estate, school, company or community library, set these environment
// variables (see .env.example) — no code changes needed. The defaults
// reproduce the original Unity Homes deployment exactly, so an existing
// install keeps working unchanged.
//
// Read on every call (cheap) rather than cached at require-time, so tests
// and the admin can change process.env without restarting the module.

const DEFAULT_BRANCHES = ['Unity One', 'Unity West', 'Unity East', 'Unity Gardens', 'Silver Hill', 'Unity Parkside'];

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function list(value, fallback) {
    if (!value) return fallback;
    const items = value.split(',').map(s => s.trim()).filter(Boolean);
    return items.length ? [...new Set(items)] : fallback;
}

function getSettings(env = process.env) {
    const orgName = env.ORG_NAME || 'Unity Homes';
    return {
        orgName,
        libraryName: env.LIBRARY_NAME || 'Knowledge Hub',
        tagline: env.LIBRARY_TAGLINE || `A shared shelf for every ${orgName} estate.`,
        intro: env.LIBRARY_INTRO || 'Borrow a book, pass it on, and meet your neighbours in between.',
        // Path or URL of a square logo. LOGO_URL=none shows the library name without a logo.
        logoUrl: env.LOGO_URL === 'none' ? '' : (env.LOGO_URL || 'logo-mark.png'),
        accentColor: /^#[0-9a-f]{6}$/i.test(env.ACCENT_COLOR || '') ? env.ACCENT_COLOR : '',

        // Where books live and members belong. Staff-like accounts cover all of them.
        branches: list(env.BRANCHES, DEFAULT_BRANCHES),
        branchLabel: env.BRANCH_LABEL || 'Estate',          // e.g. "Campus", "Office", "Branch"
        memberLabel: env.MEMBER_LABEL || 'Resident',        // e.g. "Student", "Employee", "Member"
        unitLabel: env.UNIT_LABEL || 'Unit Number',         // e.g. "Admission Number", "Staff ID"
        staffEmailDomain: (env.STAFF_EMAIL_DOMAIN || 'unityhomes.co.ke').toLowerCase(),

        // Lending rules. The server enforces these; the frontend only displays them.
        loanDays: int(env.LOAN_DAYS, 21, { min: 1, max: 365 }),
        finePerDay: int(env.FINE_PER_DAY, 50, { min: 0, max: 100000 }),
        currency: env.CURRENCY || 'KSH',
        suspendAfterDays: int(env.SUSPEND_AFTER_DAYS, 14, { min: 1, max: 365 }),
        holdHours: int(env.HOLD_HOURS, 48, { min: 1, max: 24 * 30 }),
    };
}

// What the frontend is allowed to see (nothing secret lives in settings,
// but keep the public shape explicit so it can't grow by accident).
function publicSettings(env = process.env) {
    const s = getSettings(env);
    return {
        orgName: s.orgName, libraryName: s.libraryName, tagline: s.tagline, intro: s.intro,
        logoUrl: s.logoUrl, accentColor: s.accentColor,
        branches: s.branches, branchLabel: s.branchLabel, memberLabel: s.memberLabel, unitLabel: s.unitLabel,
        staffEmailDomain: s.staffEmailDomain,
        loanDays: s.loanDays, finePerDay: s.finePerDay, currency: s.currency,
        suspendAfterDays: s.suspendAfterDays, holdHours: s.holdHours,
    };
}

module.exports = { getSettings, publicSettings, DEFAULT_BRANCHES };
