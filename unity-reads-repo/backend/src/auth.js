// Session tokens (JWT) and the middleware that enforces them.
//
// SECURITY: the whole point of this module is that identity is resolved
// from the *token*, never from anything the client puts in a request body.
// A route handler should read `req.user.userId`, set by requireAuth below —
// never `req.body.userId`. That's what closes the impersonation hole where
// anyone could act on another member's account by just editing the request.
const jwt = require('jsonwebtoken');

function signToken(user) {
    // Keep the payload minimal — just enough to identify and role-check the
    // caller. Anything else (name, estate) the client already has from the
    // login response body; no need to duplicate it into the token itself.
    return jwt.sign(
        { userId: user.userId, accountType: user.accountType },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Missing or malformed Authorization header.' });
    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { userId: payload.userId, accountType: payload.accountType };
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Session expired — please log in again.' });
    }
}

// Like requireAuth, but doesn't reject when the header is absent — it just
// leaves req.user unset. Used by /webhook/library-sync, which serves both
// the logged-out hero-preview call (titles only) and the authenticated
// call (titles + this user's own loans/reservations) at the same route.
function optionalAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) {
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            req.user = { userId: payload.userId, accountType: payload.accountType };
        } catch (err) {
            // An expired/invalid token on a route that tolerates anonymous
            // access just falls back to anonymous, rather than erroring.
        }
    }
    next();
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.accountType)) {
            return res.status(403).json({ message: 'Not authorized for this action.' });
        }
        next();
    };
}

module.exports = { signToken, requireAuth, optionalAuth, requireRole };
