import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const schema = readFileSync(new URL('../migrations/0001_schedule.sql', import.meta.url), 'utf8');

export function validateSnapshot(snapshot) {
  if (snapshot.format !== 1 || snapshot.source_project !== 'evckshjtzikuusnkdnjn') throw new Error('Unexpected source project or format');
  if (!Number.isFinite(Date.parse(snapshot.snapshot_at))) throw new Error('Missing snapshot timestamp');
  if (!Array.isArray(snapshot.workspaces) || snapshot.workspaces.length !== 2) throw new Error('Expected exactly two workspaces');
  const owners = new Map();
  for (const person of ['eren', 'begum']) {
    const rows = snapshot.workspaces.filter(row => row.app_slug === person);
    if (rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0].workspace_hash)) throw new Error('Invalid workspace ownership');
    owners.set(rows[0].workspace_hash, person);
  }
  if (owners.size !== 2) throw new Error('Workspaces must be separate');
  for (const rows of [snapshot.tasks, snapshot.transfers]) {
    if (!Array.isArray(rows)) throw new Error('Missing snapshot rows');
    if (rows.some(row => !owners.has(row.workspace_hash))) throw new Error('Orphaned row; cannot assign data to a person');
  }
  for (const item of snapshot.transfers) {
    for (const key of [item.storage_key, item.download_storage_key, ...chunkKeys(item.content)].filter(Boolean)) {
      if (!key.startsWith(item.workspace_hash + '/')) throw new Error('Cross-workspace file reference');
    }
  }
  return snapshot;
}
function chunkKeys(content) { try { const value = JSON.parse(content || '{}'); return value.chunked && Array.isArray(value.keys) ? value.keys : []; } catch { return []; } }
const quote = value => value === null || value === undefined ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
export function personSnapshot(snapshot, person) {
  validateSnapshot(snapshot);
  if (!['eren', 'begum'].includes(person)) throw new Error('Select eren or begum');
  const owner = snapshot.workspaces.find(row => row.app_slug === person);
  return { owner, tasks: snapshot.tasks.filter(row => row.workspace_hash === owner.workspace_hash), transfers: snapshot.transfers.filter(row => row.workspace_hash === owner.workspace_hash) };
}
export function importSql(snapshot, person) {
  const { owner, tasks, transfers } = personSnapshot(snapshot, person);
  // Import into an empty staging DB only. A second import fails before overwriting rows.
  const statements = [schema,
    `INSERT INTO migration_owner(singleton,app_slug,source_workspace_hash,snapshot_at) VALUES(1,${quote(person)},${quote(owner.workspace_hash)},${quote(snapshot.snapshot_at)});`];
  for (const task of tasks) statements.push(`INSERT INTO schedule_manual_tasks(id,text,done,created_at,updated_at) VALUES(${quote(task.id)},${quote(task.text)},${task.done ? 1 : 0},${quote(task.created_at)},${quote(task.updated_at)});`);
  for (const item of transfers) statements.push(`INSERT INTO schedule_transfer_items(id,kind,content,storage_key,download_storage_key,filename,content_type,bytes,created_at) VALUES(${[item.id,item.kind,item.content,item.storage_key,item.download_storage_key,item.filename,item.content_type].map(quote).join(',')},${Number(item.bytes || 0)},${quote(item.created_at)});`);
  return statements.join('\n');
}
export function makeDatabase(snapshot, person, path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('BEGIN');
  try { db.exec(importSql(snapshot, person)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  return db;
}
export function digestRows(rows) {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a,b) => a.id.localeCompare(b.id)))).digest('hex');
}
if (process.argv[1]?.endsWith('snapshot.mjs')) {
  const [file, person, destination] = process.argv.slice(2);
  if (!file || !destination) throw new Error('Usage: node scripts/snapshot.mjs .private/snapshot.json eren .private/eren-import.sql');
  const snapshot = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const db = makeDatabase(snapshot, person);
  const expected = personSnapshot(snapshot, person);
  const tasks = db.prepare('SELECT * FROM schedule_manual_tasks ORDER BY id').all();
  if (tasks.length !== expected.tasks.length) throw new Error('Task count mismatch');
  writeFileSync(destination, importSql(snapshot, person));
  console.log(JSON.stringify({ person, tasks: tasks.length, transfers: expected.transfers.length, snapshotAt: snapshot.snapshot_at, validated: true }));
  db.close();
}
