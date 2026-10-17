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

// Demo mode: open the site with ?demo to try it with the real catalogue and demo accounts,
// answered entirely in the browser (demo/demo-api.js). It stays on for this tab until "Exit demo".
window.UNITY_SHELF_DEMO = (function () {
    try {
        var q = new URLSearchParams(location.search);
        if (q.has('demo')) sessionStorage.setItem('unity_shelf_demo', '1');
        if (q.has('live')) sessionStorage.removeItem('unity_shelf_demo');
        return sessionStorage.getItem('unity_shelf_demo') === '1';
    } catch (e) {
        return /[?&]demo\b/.test(location.search);
    }
})();
// The demo keeps its own copy of the app's saved state, so it never mixes with a real session.
window.UNITY_SHELF_STORAGE_KEY = window.UNITY_SHELF_DEMO ? 'unity_shelf_demo_app_state_v1' : 'unity_hub_circulation_state_v1';
