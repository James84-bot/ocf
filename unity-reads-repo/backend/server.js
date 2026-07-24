require('dotenv').config();
const { createApp } = require('./src/app');
const { openDatabase } = require('./src/db');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace-this-with-a-long-random-string') {
    console.error(
        '\nJWT_SECRET is missing or still set to the placeholder value.\n' +
        'Copy .env.example to .env and set a real one:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
    );
    process.exit(1);
}

const db = openDatabase(process.env.DATABASE_PATH || './data/unity_shelf.db');
const app = createApp(db);

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Unity Shelf backend running at http://localhost:${port}`);
});
