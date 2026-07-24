// Imports book inventory from an .xlsx workbook (matching the Titles/Copies
// schema already used across this project's Google-Sheets-era backends)
// into the local SQLite database. Safe to re-run — it replaces the titles/
// copies tables wholesale each time rather than trying to diff/merge, so
// re-seeding after editing the spreadsheet always leaves the database
// matching the file exactly.
//
// Usage:
//   node scripts/seed.js path/to/inventory.xlsx
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { openDatabase } = require('../src/db');

const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node scripts/seed.js path/to/inventory.xlsx');
    process.exit(1);
}

function normalizeAgeBracket(raw) {
    const cleaned = (raw || '').toString().trim().toLowerCase();
    if (cleaned === 'kids') return 'Kids';
    if (cleaned === 'adults') return 'Adults';
    return null; // unrecognized/blank — the frontend treats missing ageBracket as Adults by default
}

function normalizeStatus(raw) {
    const cleaned = (raw || '').toString().trim().toUpperCase();
    return ['AVAILABLE', 'ON_LOAN', 'RESERVED'].includes(cleaned) ? cleaned : 'AVAILABLE';
}

function main() {
    const workbook = XLSX.readFile(path.resolve(filePath));

    if (!workbook.SheetNames.includes('Titles') || !workbook.SheetNames.includes('Copies')) {
        console.error(`Expected 'Titles' and 'Copies' sheets in the workbook. Found: ${workbook.SheetNames.join(', ')}`);
        process.exit(1);
    }

    const titleRows = XLSX.utils.sheet_to_json(workbook.Sheets['Titles'], { defval: null });
    const copyRows = XLSX.utils.sheet_to_json(workbook.Sheets['Copies'], { defval: null });

    const db = openDatabase(process.env.DATABASE_PATH || './data/unity_shelf.db');

    const seed = db.transaction(() => {
        db.prepare(`DELETE FROM copies`).run();
        db.prepare(`DELETE FROM titles`).run();

        const insertTitle = db.prepare(`
            INSERT INTO titles (id, title, author, publisher, reference_no, age_bracket, grade, cover_image_url, isbn)
            VALUES (@id, @title, @author, @publisher, @referenceNo, @ageBracket, @grade, @coverImageUrl, @isbn)
        `);
        let titleCount = 0, unmappedAgeBracket = 0;
        for (const row of titleRows) {
            if (!row.id || !row.title) continue;
            const ageBracket = normalizeAgeBracket(row.ageBracket);
            if (!ageBracket) unmappedAgeBracket++;
            insertTitle.run({
                id: String(row.id).trim(),
                title: String(row.title).trim(),
                author: row.author ? String(row.author).trim() : null,
                publisher: row.publisher ? String(row.publisher).trim() : null,
                referenceNo: row.referenceNo ? String(row.referenceNo).trim() : null,
                ageBracket,
                grade: row.grade ? String(row.grade).trim() : null,
                coverImageUrl: row.coverImageUrl ? String(row.coverImageUrl).trim() : null,
                isbn: row.isbn ? String(row.isbn).trim() : null
            });
            titleCount++;
        }

        const insertCopy = db.prepare(`
            INSERT INTO copies (copy_id, title_id, branch, status)
            VALUES (@copyId, @titleId, @branch, @status)
        `);
        let copyCount = 0, skippedOrphans = 0, tbdBranch = 0;
        const validTitleIds = new Set(titleRows.map(r => r.id && String(r.id).trim()).filter(Boolean));
        for (const row of copyRows) {
            if (!row.copyId || !row.titleId) continue;
            if (!validTitleIds.has(String(row.titleId).trim())) { skippedOrphans++; continue; }
            const branch = row.branch ? String(row.branch).trim() : 'TBD';
            if (branch === 'TBD') tbdBranch++;
            insertCopy.run({
                copyId: String(row.copyId).trim(),
                titleId: String(row.titleId).trim(),
                branch,
                status: normalizeStatus(row.status)
            });
            copyCount++;
        }

        return { titleCount, unmappedAgeBracket, copyCount, skippedOrphans, tbdBranch };
    });

    const result = seed();

    console.log(`Imported ${result.titleCount} titles and ${result.copyCount} copies into ${process.env.DATABASE_PATH || './data/unity_shelf.db'}.`);
    if (result.unmappedAgeBracket > 0) {
        console.log(`  ${result.unmappedAgeBracket} titles had no recognizable ageBracket ('Kids'/'Adults') — left NULL, the frontend groups these under Adults by default.`);
    }
    if (result.tbdBranch > 0) {
        console.log(`  ${result.tbdBranch} copies still have branch = 'TBD' — these need a real branch (e.g. 'Unity West') assigned before residents can borrow them at a specific location. Update these directly in the database, or re-run this seed after filling in the 'branch' column in the spreadsheet.`);
    }
    if (result.skippedOrphans > 0) {
        console.log(`  Skipped ${result.skippedOrphans} copy rows referencing a titleId not present in the Titles sheet.`);
    }
}

main();
