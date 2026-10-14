// Task refresh signals only; no Web Push or mail alerts.
(() => {
  const settings = window.SCHEDULE_MIGRATION;
  if (!settings?.enabled) return;
  const storageKey = settings.app === 'begum' ? 'ntu-schedule-begum-pairing-key-v1' : 'ntu-schedule-pairing-key-v1';
  let socket, retry, poll, generation = 0, delay = 1500;
  const refresh = () => window.dispatchEvent(new Event('schedule-todos-changed'));
  function stop() {
    generation++;
    clearTimeout(retry); clearInterval(poll);
    retry = null; poll = null;
    if (socket) { const old = socket; socket = null; old.close(); }
  }
  function fallback() {
    if (!poll) poll = setInterval(() => { if (!document.hidden && navigator.onLine) refresh(); }, 30000);
  }
  function connect() {
    stop();
    if (!navigator.onLine || document.hidden) return;
    const mine = generation;
    let key = settings.stagingKey || '';
    try { key ||= localStorage.getItem(storageKey) || ''; } catch {}
    if (!key) return;
    const url = new URL(settings.apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('route', 'todos/socket');
    const current = new WebSocket(url);
    socket = current;
    fallback(); // Repairs a missed message even when a socket looks connected.
    current.onopen = () => current.send(JSON.stringify({ event: 'pair', key }));
    current.onmessage = event => {
      if (mine !== generation) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.event === 'ready') { delay = 1500; refresh(); }
      if (message.event === 'changed') refresh();
    };
    current.onclose = event => {
      if (mine !== generation) return;
      socket = null;
      if (event.code === 1008) return; // A rejected key must not loop against the service.
      retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 45000);
    };
    current.onerror = () => current.close();
  }
  window.addEventListener('schedule-pairing-changed', connect);
  window.addEventListener('online', connect);
  window.addEventListener('offline', stop);
  window.addEventListener('focus', () => { if (!socket) connect(); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : connect());
  window.addEventListener('storage', event => { if (event.key === storageKey) connect(); });
  connect();
})();
