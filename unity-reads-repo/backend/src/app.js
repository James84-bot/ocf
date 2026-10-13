const path = require('path');
const fs = require('fs');
const express = require('express');
const { publicSettings } = require('./settings');
const cors = require('cors');
const morgan = require('morgan');

const { generalLimiter } = require('./middleware/rateLimiters');
const { errorHandler } = require('./middleware/errorHandler');

function createApp(db) {
    const app = express();

    app.use(cors({
        origin: (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
    }));
    app.use(express.json());
    if (process.env.NODE_ENV !== 'test') {
        app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
    }
    // One-server mode: the backend also serves the frontend, so a single URL
    // (or a single Docker container) runs the whole library. Set
    // SERVE_FRONTEND=false when the frontend is hosted elsewhere (e.g. GitHub Pages).
    const frontendDir = path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend'));
    if (process.env.SERVE_FRONTEND !== 'false' && fs.existsSync(path.join(frontendDir, 'index.html'))) {
        app.use(express.static(frontendDir, { index: 'index.html', maxAge: '1h' }));
    }
    // (Static files are served before the API rate limiter so page assets don't use up a visitor's API allowance.)

    app.use(generalLimiter);

    app.get('/health', (req, res) => res.json({ ok: true, service: 'unity-shelf-backend' }));

    // Branding and lending rules for the frontend (name, logo, branches, fines).
    app.get('/api/settings', (req, res) => res.json(publicSettings()));

    // Login and registration get the stricter rate limiter applied
    // directly on their individual routes (inside routes/auth.js and
    // routes/registration.js) — attaching it here via app.use() would
    // apply it to every request that reaches this point in the stack,
    // not just those two routes.
    app.use(require('./routes/auth')(db));
    app.use(require('./routes/registration')(db));

    app.use(require('./routes/account')(db));
    app.use(require('./routes/sync')(db));
    app.use(require('./routes/transactions')(db));
    app.use(require('./routes/reservations')(db));
    app.use(require('./routes/admin')(db));

    app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
