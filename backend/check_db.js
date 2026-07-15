const sqlite3 = require('better-sqlite3');
const db = sqlite3('data/database.db');

const rows = db.prepare('SELECT id, title, thumbnail_path, original_url FROM photos').all();
console.log('Database records:');
console.log(JSON.stringify(rows, null, 2));

db.close();