// Centralized error handler — anything a route throws (or an async route
// forwards via next(err)) lands here instead of leaking a stack trace to
// the client or, worse, crashing the process silently.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return next(err);
    res.status(status).json({
        message: err.expose ? err.message : 'Something went wrong on our end. Please try again.'
    });
}

// Wraps an async route handler so a rejected promise reaches errorHandler
// instead of becoming an unhandled rejection.
function asyncRoute(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncRoute };
