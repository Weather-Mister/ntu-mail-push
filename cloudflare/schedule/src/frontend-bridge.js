// Loaded before app.js in a generated staging copy. The production app is untouched.
(() => {
  const settings = window.SCHEDULE_MIGRATION;
  if (!settings?.enabled) return;
  if (!['eren','begum'].includes(settings.app)) throw new Error('Invalid schedule migration owner');
  const legacy = 'https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/ntu-schedule-api';
  const allowed = new Set(['status','cool-calendar','todos/list','todos/create','todos/update','todos/delete','todos/import']);
  if (settings.transferEnabled) for (const route of ['transfer/list','transfer/text','transfer/upload','transfer/upload-chunk','transfer/finalize','transfer/chunk','transfer/file','transfer/delete']) allowed.add(route);
  const target = new URL(settings.apiUrl);
  if (target.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(target.hostname) && target.protocol === 'http:')) throw new Error('HTTPS schedule API required');
  const mailLegacy = 'https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/eren-mail';
  const mailAllowed = new Set(['bootstrap','status','settings','ntu/connect','oauth/start','oauth/finish','accounts','accounts/rename','accounts/disconnect','preferences','cached-mail','mail','thread','attachment','modify-batch','modify','mark-all-read','rules','rules/delete','unsubscribe','translate','ai','send','outbox','outbox/cancel','outbox/check','outbox/restore','drafts/attachment','drafts/attachment/delete','drafts','drafts/open','drafts/delete','sync']);
  const mailTarget = settings.mailApiUrl ? new URL(settings.mailApiUrl) : null;
  if (mailTarget && mailTarget.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(mailTarget.hostname) && mailTarget.protocol === 'http:')) throw new Error('HTTPS mail API required');
  const previousFetch = window.fetch.bind(window);
  window.fetch = async function migrationFetch(input, init) {
    const request = new Request(input instanceof Request ? input : new URL(String(input), window.location.href), init);
    const url = new URL(request.url);
    const route = url.searchParams.get('route') || '';
    const endpoint = url.origin + url.pathname;
    const selected = endpoint === legacy && allowed.has(route) ? target : endpoint === mailLegacy && mailTarget && mailAllowed.has(route) ? mailTarget : null;
    if (!selected) return previousFetch(input, init);
    const destination = new URL(selected);
    url.searchParams.forEach((value,name) => destination.searchParams.append(name,value));
    const headers = new Headers(request.headers);
    if (settings.stagingKey) headers.set('x-schedule-key', settings.stagingKey);
    return previousFetch(new Request(destination, {
      method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: request.signal, cache: 'no-store', redirect: request.redirect, credentials: 'omit'
    }));
  };
})();
