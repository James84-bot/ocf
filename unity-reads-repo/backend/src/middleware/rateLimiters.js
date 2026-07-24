const rateLimit = require('express-rate-limit');

// A generous ceiling across the whole API — mainly to blunt accidental
// runaway loops on the frontend, not meant to bother real usage.
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
});

// Login and registration are the two endpoints most worth protecting from
// being hammered — brute-forcing PINs or spamming account creation.
// Deliberately stricter than the general limit.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many attempts from this network. Please wait a few minutes and try again.' }
});

module.exports = { generalLimiter, authLimiter };
