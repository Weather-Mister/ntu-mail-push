/* Local-only PC audio oscilloscope.
   Starts only from an explicit click/keyboard action and uses the browser's
   own share picker. No captured audio is uploaded or stored. */
(() => {
  const scope = document.getElementById('scheduleScope');
  const trace = document.getElementById('scheduleScopeTrace');
  const label = document.getElementById('scheduleScopeLabel');
  const value = document.getElementById('scheduleScopeValue');
  const mode = document.getElementById('scheduleScopeMode');
  const hint = document.getElementById('scheduleScopeHint');
  if (!scope || !trace) return;

  let audioContext = null;
  let source = null;
  let analyser = null;
  let data = null;
  let stream = null;
  let active = false;
  let connecting = false;
  let gain = 1;
  let raf = 0;

  function setUi(on, status='SYSTEM OUT') {
    scope.classList.toggle('pc-audio-active', on);
    scope.classList.toggle('is-audio', on);
    scope.setAttribute('aria-pressed', on ? 'true' : 'false');
    scope.title = on ? 'Click to stop monitoring PC audio' : 'Click to monitor PC audio';
    if (on) {
      if (label) label.textContent = 'AUDIO / PC';
      if (value) value.textContent = 'LIVE';
      if (mode) mode.textContent = status;
      if (hint) hint.textContent = 'CLICK STOP';
      scope.setAttribute('aria-label', 'Live PC audio oscilloscope. Activate to stop monitoring.');
    }
  }

  function draw() {
    if (!active || !analyser || !data) return;
    analyser.getByteTimeDomainData(data);

    let energy = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / data.length);
    const desired = rms > 0.004 ? Math.min(5.5, Math.max(1, 0.24 / rms)) : 1;
    gain += (desired - gain) * 0.12;

    const width = 200;
    const mid = 21;
    const amp = 17.5;
    let d = '';
    for (let x = 0; x <= width; x += 2) {
      const i = Math.min(data.length - 1, Math.floor((x / width) * (data.length - 1)));
      const sample = ((data[i] - 128) / 128) * gain;
      const y = Math.max(2.5, Math.min(39.5, mid + sample * amp));
      d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)} `;
    }
    trace.setAttribute('d', d.trim());
    raf = requestAnimationFrame(draw);
  }

  async function stop() {
    active = false;
    connecting = false;
    cancelAnimationFrame(raf);
    try { source?.disconnect(); } catch {}
    source = null;
    analyser = null;
    data = null;
    stream?.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
    stream = null;
    if (audioContext) {
      try { await audioContext.close(); } catch {}
    }
    audioContext = null;
    gain = 1;
    scope.classList.remove('pc-audio-active', 'is-audio');
    scope.setAttribute('aria-pressed', 'false');
    scope.title = 'Click to monitor PC audio';
    window.dispatchEvent(new Event('resize'));
  }

  async function start() {
    if (active || connecting) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getDisplayMedia || !AudioContextCtor) {
      if (label) label.textContent = 'AUDIO / PC';
      if (value) value.textContent = 'N/A';
      if (mode) mode.textContent = 'UNSUPPORTED';
      if (hint) hint.textContent = 'BROWSER';
      return;
    }

    connecting = true;
    if (label) label.textContent = 'AUDIO / PC';
    if (value) value.textContent = '…';
    if (mode) mode.textContent = 'CHOOSE OUTPUT';
    if (hint) hint.textContent = 'SHARE AUDIO';

    let picked = null;
    try {
      picked = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include'
      });

      const audioTrack = picked.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track shared');

      picked.getVideoTracks().forEach(track => {
        try { track.stop(); } catch {}
      });

      stream = new MediaStream([audioTrack]);
      audioContext = new AudioContextCtor();
      await audioContext.resume();
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.28;
      source.connect(analyser);
      data = new Uint8Array(analyser.fftSize);

      active = true;
      connecting = false;
      audioTrack.addEventListener('ended', () => { if (active) stop(); }, { once: true });
      setUi(true);
      draw();
    } catch (error) {
      picked?.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      connecting = false;
      if (value) value.textContent = '--';
      if (mode) mode.textContent = error?.name === 'NotAllowedError' ? 'CANCELLED' : 'NO AUDIO';
      if (hint) hint.textContent = 'CLICK RETRY';
      scope.setAttribute('aria-label', 'PC audio monitor is off. Activate to try again.');
    }
  }

  function toggle() {
    if (active) stop();
    else start();
  }

  scope.addEventListener('click', toggle);
  scope.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
})();
