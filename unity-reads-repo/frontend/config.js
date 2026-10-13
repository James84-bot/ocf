// Where this frontend finds its API. The only line most deployments change.
//
// - Served by the backend itself (Docker, or `npm start` with SERVE_FRONTEND
//   left on): leave it empty and the page talks to its own server.
// - Hosted separately (GitHub Pages, Netlify): put the backend's URL here.
//
// The defaults below keep the original Unity Homes setup working: GitHub Pages
// talks to the Railway backend, and VS Code Live Server (port 5500) talks to a
// backend running locally on port 3000.
window.UNITY_SHELF_API = (function () {
    var host = location.hostname, port = location.port;
    if (host.endsWith('github.io')) return 'https://ocf-production.up.railway.app';
    if (port === '5500') return 'http://localhost:3000';
    return '';
})();
