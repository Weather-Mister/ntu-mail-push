import { parseCoolFeed,fetchCoolFeed } from './cool.mjs';
import { transferRoutes, handleTransfer, validDownload } from './transfer.mjs';
import { FileStorageError } from './sqlite-files.mjs';
import { importFile } from './file-import.mjs';
export { FileStore } from './sqlite-files.mjs';

const encoder = new TextEncoder();
const routes = new Map([
  ['status', 'GET'], ['todos/list', 'GET'], ['todos/create', 'POST'],
  ['todos/update', 'POST'], ['todos/delete', 'POST'], ['todos/import', 'POST'],
  ['cool-calendar', 'GET'], ['todos/socket', 'GET']
  ,['migration/file-import','POST'],['migration/file-check','GET']
]);
for (const [route, method] of transferRoutes) routes.set(route, method);
export async function hashKey(key) {
  const normalized = key.trim().toLowerCase() === 'begum' ? 'begum' : key.trim();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(normalized)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function sameHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || '') || !/^[a-f0-9]{64}$/.test(right || '')) return false;
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function response(data, status = 200, origin = '') {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'Vary': 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'content-type, x-schedule-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }});
}
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function body(req) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new RequestError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new RequestError(400, 'Invalid JSON.'); }
}
function taskView(row) {
  return { id: row.id, text: row.text, done: Boolean(row.done), createdAt: row.created_at, updatedAt: row.updated_at };
}
function hub(env) { return env.TASK_SYNC.get(env.TASK_SYNC.idFromName(env.APP_SLUG)); }
async function changed(env) {
  // D1 commits first. A missed invalidation is repaired by the client fallback check.
  try { await hub(env).fetch('https://sync.internal/changed', { method: 'POST', headers:{'x-schedule-auth-hash':env.SCHEDULE_KEY_HASH} }); }
  catch { /* A task commit must not become a failed write because sync is unavailable. */ }
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (origin && !origins.includes(origin)) return response({ error: 'Origin is not allowed.' }, 403);
    if (req.method === 'OPTIONS') return response({}, 200, origin);
    const route = (new URL(req.url).searchParams.get('route') || '').replace(/^\/+|\/+$/g, '');
    if (!routes.has(route)) return response({ error: 'Not found.' }, 404, origin);
    if (routes.get(route) !== req.method) return response({ error: 'Method is not allowed.' }, 405, origin);
    try {
      if (!['eren', 'begum'].includes(env.APP_SLUG) || !/^[a-f0-9]{64}$/.test(env.SCHEDULE_KEY_HASH || '')) {
        return response({ error: 'Schedule backend is not configured.' }, 503, origin);
      }
      // WebSockets authenticate in the first message; pairing keys never enter URLs.
      const signed = route === 'transfer/object' && await validDownload(req, env);
      if (route !== 'todos/socket' && !signed) {
        const key = req.headers.get('x-schedule-key') || '';
        if (key.trim().length < 5 || key.length > 200 || !sameHash(await hashKey(key), env.SCHEDULE_KEY_HASH)) {
          return response({ error: 'Pairing required.' }, 401, origin);
        }
      }
      const owner = await env.DB.prepare('SELECT app_slug,source_workspace_hash FROM migration_owner WHERE singleton = 1').first();
      if (!owner || owner.app_slug !== env.APP_SLUG) return response({ error: 'Database ownership mismatch.' }, 503, origin);
      if(route.startsWith('migration/file-'))return importFile(req,env,owner,(data,status=200)=>response(data,status,origin));
      if (transferRoutes.has(route)) return await handleTransfer(req,env,owner,(data,status=200)=>response(data,status,origin),body);
      if (route === 'todos/socket') {
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return response({ error: 'WebSocket required.' }, 426, origin);
        const headers=new Headers(req.headers);headers.set('x-schedule-auth-hash',env.SCHEDULE_KEY_HASH);
        return hub(env).fetch(new Request(req,{headers}));
      }
      if (route === 'status') return response({ ok: true, app: env.APP_SLUG }, 200, origin);
      if (route === 'todos/list') {
        const { results } = await env.DB.prepare('SELECT id,text,done,created_at,updated_at FROM schedule_manual_tasks ORDER BY created_at DESC,id DESC LIMIT 200').all();
        return response({ tasks: results.map(taskView) }, 200, origin);
      }
      if (route === 'todos/create') {
        const input = await body(req);
        const text = String(input?.text || '').trim();
        const requestedId = String(input?.id || '').trim();
        const id = requestedId && requestedId.length <= 120 ? requestedId : crypto.randomUUID();
        if (!text) return response({ error: 'Task text is required.' }, 400, origin);
        if (text.length > 500) return response({ error: 'Task is too long.' }, 400, origin);
        const row = await env.DB.prepare(`INSERT INTO schedule_manual_tasks(id,text,done,updated_at)
          VALUES(?,?,0,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,done=0,updated_at=excluded.updated_at
          RETURNING id,text,done,created_at,updated_at`).bind(id, text, new Date().toISOString()).first();
        await changed(env);
        return response({ task: taskView(row) }, 200, origin);
      }
      if (route === 'todos/update') {
        const input = await body(req);
        const id = String(input?.id || '').trim();
        if (!id) return response({ error: 'Task id is required.' }, 400, origin);
        if (typeof input?.done !== 'boolean') return response({ error: 'Done must be boolean.' }, 400, origin);
        const row = await env.DB.prepare('UPDATE schedule_manual_tasks SET done=?,updated_at=? WHERE id=? RETURNING id,text,done,created_at,updated_at')
          .bind(Number(input.done), new Date().toISOString(), id).first();
        if (!row) return response({ error: 'Task not found.' }, 404, origin);
        await changed(env);
        return response({ task: taskView(row) }, 200, origin);
      }
      if (route === 'todos/delete') {
        const input = await body(req);
        const id = String(input?.id || '').trim();
        if (!id) return response({ error: 'Task id is required.' }, 400, origin);
        await env.DB.prepare('DELETE FROM schedule_manual_tasks WHERE id=?').bind(id).run();
        await changed(env);
        return response({ ok: true }, 200, origin);
      }
      if (route === 'todos/import') {
        const input = await body(req);
        const tasks = (Array.isArray(input?.tasks) ? input.tasks.slice(0, 200) : []).map(task => ({
          id: String(task?.id || '').trim(), text: String(task?.text || '').trim().slice(0, 500), done: Number(Boolean(task?.done))
        })).filter(task => task.id && task.id.length <= 120 && task.text);
        // At most 90 bind parameters per statement and seven statements per import,
        // fitting D1's 100-parameter and Free-plan 50-query limits.
        const statements = [];
        for (let offset = 0; offset < tasks.length; offset += 30) {
          const group = tasks.slice(offset, offset + 30);
          statements.push(env.DB.prepare('INSERT INTO schedule_manual_tasks(id,text,done) VALUES ' + group.map(() => '(?,?,?)').join(',') + ' ON CONFLICT(id) DO NOTHING')
            .bind(...group.flatMap(task => [task.id,task.text,task.done])));
        }
        const results = statements.length ? await env.DB.batch(statements) : [];
        const imported = results.reduce((total, result) => total + (result.meta?.changes || 0), 0);
        if (imported) await changed(env);
        return response({ ok: true, imported }, 200, origin);
      }
      if (route === 'cool-calendar') {
        if (!env.COOL_FEED_URL) return response({ error: 'NTU COOL calendar is not configured for this workspace.' }, 503, origin);
        const feed = new URL(env.COOL_FEED_URL);
        if (feed.protocol !== 'https:' || feed.hostname !== 'cool.ntu.edu.tw') return response({ error: 'Calendar configuration is invalid.' }, 503, origin);
        let upstream;
        try { upstream = await fetchCoolFeed(feed); }
        catch { return response({ error: 'NTU COOL calendar feed could not be reached safely.' }, 502, origin); }
        if (!upstream.ok) return response({ error: 'NTU COOL calendar feed could not be loaded.' }, 502, origin);
        return response({ syncedAt: new Date().toISOString(), events: parseCoolFeed(await upstream.text()) }, 200, origin);
      }
    } catch (error) {
      if (error instanceof RequestError || error instanceof FileStorageError) return response({ error: error.message }, error.status, origin);
      // Do not log request headers, private feed URLs, task text or upstream errors.
      return response({ error: 'Schedule backend request failed.' }, 503, origin);
    }
  }
};

// This sends task invalidations only. It has no notification, mail or Web Push code.
export class TaskSync {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const expected=req.headers.get('x-schedule-auth-hash')||this.env.SCHEDULE_KEY_HASH;
    if(!/^[a-f0-9]{64}$/.test(expected||''))return new Response('Sync authorization unavailable',{status:503});
    if (new URL(req.url).pathname === '/changed' && req.method === 'POST') {
      for (const socket of this.state.getWebSockets()) {
        const attachment=socket.deserializeAttachment();if(!attachment?.paired)continue;
        if(!sameHash(attachment.authHash||this.env.SCHEDULE_KEY_HASH,expected)){socket.close(1008,'Pairing changed');continue;}
        try { socket.send(JSON.stringify({ event: 'changed' })); } catch { socket.close(); }
      }
      return new Response(null, { status: 204 });
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.state.getWebSockets().length >= 32) return new Response('Too many connections', { status: 429 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ paired: false,authHash:expected });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.paired) { socket.close(1008, 'No client messages supported'); return; }
    let input;
    try { if (typeof message !== 'string' || message.length > 300) throw new Error(); input = JSON.parse(message); }
    catch { socket.close(1008, 'Invalid authentication'); return; }
    const key = typeof input?.key === 'string' ? input.key : '';
    const expected=attachment?.authHash||this.env.SCHEDULE_KEY_HASH;
    if (input?.event !== 'pair' || key.length < 5 || key.length > 200 || !sameHash(await hashKey(key), expected)) {
      socket.close(1008, 'Pairing required'); return;
    }
    socket.serializeAttachment({ paired: true,authHash:expected });
    socket.send(JSON.stringify({ event: 'ready' }));
  }
  webSocketClose(socket, code, reason) { socket.close(code, reason); }
  webSocketError(socket) { socket.close(1011, 'Connection failed'); }
}
