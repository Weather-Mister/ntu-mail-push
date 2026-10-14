import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { makeDatabase } from './snapshot.mjs';
const root = resolve(import.meta.dirname,'..');
const schema = readFileSync(resolve(root,'migrations/0001_schedule.sql'),'utf8');
export async function startRuntime(person, key, snapshot, port = 0, transfers = false, imports = false) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: resolve(root,'src'),
    modules: ['worker.mjs','cool.mjs','transfer.mjs','sqlite-files.mjs','file-import.mjs'].map(name => ({ type: 'ESModule', path: resolve(root,'src',name) })),
    compatibilityDate: '2026-10-13', host: '127.0.0.1', port,
    d1Databases: { DB: `${person}-schedule-local` },
    durableObjects: { TASK_SYNC: { className: 'TaskSync', useSQLite: true }, FILE_STORE: { className: 'FileStore', useSQLite: true } },
    bindings: { APP_SLUG: person, SCHEDULE_KEY_HASH: createHash('sha256').update(key).digest('hex'), ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173,https://weather-mister.github.io', TRANSFER_ENABLED: transfers?'true':'false', FILE_IMPORT_MODE: imports?'staging':'disabled', DOWNLOAD_SIGNING_KEY: createHash('sha256').update('local-files-'+key).digest('hex') }
  }));
  try {
    await runtime.ready;
    const db = await runtime.getD1Database('DB');
    const statements = schema.replace(/^--.*$/gm,'').split(';').map(value=>value.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
    const local = makeDatabase(snapshot,person);
    const owner = local.prepare('SELECT * FROM migration_owner').get();
    await db.prepare('INSERT INTO migration_owner VALUES(1,?,?,?)').bind(owner.app_slug,owner.source_workspace_hash,owner.snapshot_at).run();
    for (const task of local.prepare('SELECT * FROM schedule_manual_tasks').all()) {
      await db.prepare('INSERT INTO schedule_manual_tasks VALUES(?,?,?,?,?)').bind(task.id,task.text,task.done,task.created_at,task.updated_at).run();
    }
    local.close();
    return runtime;
  } catch (error) { await runtime.dispose(); throw error; }
}
