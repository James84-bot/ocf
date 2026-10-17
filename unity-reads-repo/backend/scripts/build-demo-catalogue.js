// Builds frontend/demo/catalogue.json from a seeded database, for the in-browser demo.
//
//   npm run seed -- seed-data/inventory.xlsx          # seed a database first
//   node scripts/build-demo-catalogue.js              # then export it
//
// Only books and copies are exported. Members, loans and reservations never are.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { openDatabase } = require('../src/db');

const db = openDatabase(process.env.DATABASE_PATH || './data/unity_shelf.db');
const titles = db.prepare(`SELECT id, title, author, age_bracket, grade, cover_image_url FROM titles ORDER BY id`).all();
const copies = db.prepare(`SELECT copy_id, title_id, branch FROM copies ORDER BY copy_id`).all();
if (!titles.length) {
    console.error('The database has no titles. Run the seed script first.');
    process.exit(1);
}
const byTitle = {};
for (const c of copies) (byTitle[c.title_id] = byTitle[c.title_id] || []).push([c.copy_id, c.branch]);

// Compact rows: [id, title, author, ageBracket, grade, coverImageUrl, [[copyId, branch], ...]]
const rows = titles.map(t => [t.id, t.title, t.author || '', t.age_bracket || '', t.grade || '', t.cover_image_url || '', byTitle[t.id] || []]);
const out = path.join(__dirname, '..', '..', 'frontend', 'demo', 'catalogue.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), titles: rows }));
console.log(`Wrote ${rows.length} titles and ${copies.length} copies to ${path.relative(process.cwd(), out)}`);
