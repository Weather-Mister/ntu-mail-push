/* Optional, explicit Windows WASAPI helper bridge.
   No browser audio APIs. No server-side upload. Only receives envelope measurements from localhost. */
(() => {
  'use strict';
  const KEY = 'ntu-scope-pc-pairing-v1';
  const URL = 'ws://127.0.0.1:43187/stream?key=';
  const dialog = document.getElementById('scopeAudioDialog');
  const openButton = document.getElementById('scopeAudioToggle');
  const closeButton = document.getElementById('scopeAudioClose');
  const form = document.getElementById('scopeAudioForm');
  const input = document.getElementById('scopeAudioKey');
  const status = document.getElementById('scopeAudioStatus');
  const disconnectButton = document.getElementById('scopeAudioDisconnect');
  let socket = null;
  let frame = null;
  let lastFrameAt = 0;
  let reconnectTimer = 0;
  let retries = 0;
  let enabled = false;
  let token = '';

  const setStatus = message => {
    if (status) status.textContent = message;
  };
  const clearReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  };
  const displayState = () => {
    const connected = socket?.readyState === WebSocket.OPEN;
    if (openButton) {
      openButton.classList.toggle('is-connected', connected);
      openButton.title = connected ? 'PC audio connected — settings' : 'Connect Windows PC audio';
      openButton.setAttribute('aria-label', openButton.title);
      openButton.setAttribute('aria-pressed', String(connected));
    }
    if (disconnectButton) disconnectButton.disabled = !enabled;
  };
  const safeNumber = number =>
    Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  const read = () => {
    if (!enabled || socket?.readyState !== WebSocket.OPEN ||
        !frame || performance.now() - lastFrameAt > 380) return null;
    return frame;
  };
  function disconnect(clearKey = true) {
    enabled = false;
    token = '';
    frame = null;
    clearReconnect();
    if (socket) {
      const previous = socket;
      socket = null;
      try { previous.close(1000, 'Disconnect'); } catch (_) {}
    }
    if (clearKey) {
      try { localStorage.removeItem(KEY); } catch (_) {}
    }
    displayState();
    setStatus('Disconnected. The original schedule waveform is active.');
  }
  function scheduleReconnect() {
    if (!enabled || reconnectTimer) return;
    const delay = Math.min(20000, 2500 * Math.pow(1.65, Math.min(retries++, 5)));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connectSocket();
    }, delay);
  }
  function connectSocket() {
    if (!enabled || !token) return;
    clearReconnect();
    if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) return;
    setStatus('Connecting to the companion on this PC…');
    let candidate;
    try {
      candidate = new WebSocket(URL + encodeURIComponent(token));
    } catch (_) {
      setStatus('Firefox blocked localhost access. Check your browser permissions.');
      scheduleReconnect();
      return;
    }
    socket = candidate;
    displayState();

    candidate.addEventListener('open', () => {
      if (socket !== candidate || !enabled) return;
      retries = 0;
      setStatus('Connected. Your oscilloscope now follows system playback audio.');
      displayState();
    });
    candidate.addEventListener('message', event => {
      if (socket !== candidate || !enabled) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type !== 'levels' || data?.version !== 1 ||
            !Array.isArray(data.bins) || data.bins.length !== 64) return;
        // Protocol v1 remains compatible with older envelope-only helpers.
        // A current helper also sends 128 normalized, signed *time-domain*
        // samples, reproducing the first real-audio oscilloscope's trace.
        const hasWave = Object.hasOwn(data, 'wave');
        if (hasWave && (!Array.isArray(data.wave) || data.wave.length !== 128 ||
            !data.wave.every(sample => typeof sample === 'number' &&
              Number.isFinite(sample) && sample >= -1 && sample <= 1))) return;
        frame = {
          rms: safeNumber(data.rms),
          pitch: safeNumber(data.pitch),
          bins: data.bins.map(safeNumber),
          wave: hasWave ? data.wave.slice() : null
        };
        lastFrameAt = performance.now();
      } catch (_) {}
    });
    candidate.addEventListener('error', () => {
      if (socket !== candidate || !enabled) return;
      setStatus('Unable to connect. Start NTUScope.exe and allow Firefox device access.');
    });
    candidate.addEventListener('close', event => {
      if (socket !== candidate) return;
      socket = null;
      frame = null;
      displayState();
      if (!enabled) return;
      if (event.code === 1008) setStatus('Pairing was rejected. Check the key.');
      else setStatus('Companion offline or blocked. The schedule waveform is active.');
      scheduleReconnect();
    });
  }
  function connect(key) {
    const clean = String(key || '').trim().toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(clean)) {
      setStatus('Enter the 32-character key shown in NTUScope.exe.');
      return;
    }
    disconnect(false);
    token = clean;
    enabled = true;
    retries = 0;
    if (input) input.value = clean;
    try { localStorage.setItem(KEY, clean); } catch (_) {}
    displayState();
    connectSocket();
  }

  window.NTUScopeAudio = Object.freeze({ read, disconnect, connect });
  openButton?.addEventListener('click', () => {
    if (!dialog) return;
    displayState();
    const connected = socket?.readyState === WebSocket.OPEN;
    setStatus(connected ? 'Connected to PC audio.' : enabled
      ? 'Waiting for the Windows companion…'
      : 'Run NTUScope.exe, then enter its pairing key.');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  closeButton?.addEventListener('click', () => {
    if (typeof dialog?.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
  });
  form?.addEventListener('submit', event => {
    event.preventDefault();
    connect(input?.value);
  });
  disconnectButton?.addEventListener('click', () => disconnect());
  try {
    const remembered = localStorage.getItem(KEY);
    if (remembered) connect(remembered);
  } catch (_) {}
  displayState();
})();
