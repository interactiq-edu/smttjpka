// Read-only validation of an exported database: executes only in memory.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const file=process.argv[2];
if(!file)throw new Error('Pass the path to a D1 SQL backup.');
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=OFF');
db.exec(readFileSync(file,'utf8'));
db.exec('PRAGMA foreign_keys=ON');
const tables=['questions','quiz_questions','attempt_answers','attempts','resource_live_states'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const before=snapshot();
db.exec('BEGIN');db.exec(readFileSync('migrations/0028_learning_upgrade.sql','utf8'));db.exec('COMMIT');
const after=snapshot();
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing data differs after migration.');
if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key violation after migration.');
console.log('Exact data preserved:',Object.fromEntries(tables.map(table=>[table,after[table].length])));
db.close();
