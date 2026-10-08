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

  // Firefox lacks getDisplayMedia audio capture. A permitted audio input
  // (e.g. Stereo Mix / BlackHole / PipeWire monitor) is the fallback.
  const isFirefox = /Firefox\/\d+/.test(navigator.userAgent);
  const preferenceKey = 'ntu-scope-firefox-input';
  const loopbackName = /loopback|stereo mix|blackhole|monitor of|vb-audio|cable output|virtual audio/i;
  const readPreference = () => {
    try { return localStorage.getItem(preferenceKey) || ''; } catch { return ''; }
  };
  const savePreference = id => {
    if (id) try { localStorage.setItem(preferenceKey, id); } catch {}
  };

  let audioContext = null;
  let source = null;
  let analyser = null;
  let data = null;
  let stream = null;
  let active = false;
  let connecting = false;
  let level = 0;
  let raf = 0;
  let inputPicker = null;

  function setUi(on, status='SYSTEM OUT') {
    scope.classList.toggle('pc-audio-active', on);
    scope.classList.toggle('is-audio', on);
    scope.setAttribute('aria-pressed', on ? 'true' : 'false');
    scope.title = isFirefox
      ? (on ? 'Click to stop. Right-click or Shift+Enter to change input.'
            : 'Click to monitor an audio input. Select a loopback input for system sound.')
      : (on ? 'Click to stop monitoring PC audio' : 'Click to monitor PC audio');
    if (on) {
      if (label) label.textContent = isFirefox ? 'AUDIO / IN' : 'AUDIO / PC';
      if (value) value.textContent = 'LIVE';
      if (mode) mode.textContent = status;
      if (hint) hint.textContent = isFirefox ? 'CHANGE INPUT: RIGHT-CLICK' : 'CLICK STOP';
      scope.setAttribute('aria-label', isFirefox
        ? 'Live audio input oscilloscope. Activate to stop. Right-click or Shift+Enter to change input.'
        : 'Live PC audio oscilloscope. Activate to stop monitoring.');
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
    // Follow loudness while preserving the schedule trace's wavelength and motion.
    const desired = Math.min(1, rms * 3);
    level += (desired - level) * (desired > level ? 0.3 : 0.12);
    drawScheduleScope(performance.now(), level);
    raf = requestAnimationFrame(draw);
  }

  function dismissPicker(event) {
    if (inputPicker && !inputPicker.contains(event.target)) closePicker();
  }

  function dismissPickerKey(event) {
    if (event.key === 'Escape') closePicker();
  }

  function closePicker() {
    inputPicker?.remove();
    inputPicker = null;
    document.removeEventListener('pointerdown', dismissPicker);
    document.removeEventListener('keydown', dismissPickerKey);
  }

  function stop() {
    closePicker();
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
      try { audioContext.close().catch(() => {}); } catch {}
    }
    audioContext = null;
    level = 0;
    scope.classList.remove('pc-audio-active', 'pc-audio-pending', 'pc-audio-error', 'is-audio');
    scope.setAttribute('aria-pressed', 'false');
    scope.title = isFirefox
      ? 'Click to monitor an audio input. Select a loopback input for system sound.'
      : 'Click to monitor PC audio';
    if (label) label.textContent = 'ΔT / SCHED';
    if (value) value.textContent = '--';
    if (mode) mode.textContent = 'SCHEDULE';
    if (hint) hint.textContent = 'λ ∝ ΔT';
    scope.setAttribute('aria-label', isFirefox
      ? 'Schedule interval monitor. Activate to monitor an audio input in Firefox.'
      : 'Schedule interval monitor. Activate to monitor PC audio.');
    window.dispatchEvent(new Event('resize'));
  }

  async function start({ deviceId = '', exact = false } = {}) {
    if (active || connecting) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const media = navigator.mediaDevices;
    if (!(isFirefox ? media?.getUserMedia : media?.getDisplayMedia) || !AudioContextCtor) {
      scope.classList.add('pc-audio-error');
      if (label) label.textContent = isFirefox ? 'AUDIO / IN' : 'AUDIO / PC';
      if (value) value.textContent = 'N/A';
      if (mode) mode.textContent = 'UNSUPPORTED';
      if (hint) hint.textContent = 'BROWSER';
      return;
    }

    scope.classList.remove('pc-audio-error');
    scope.classList.add('pc-audio-pending');
    connecting = true;
    if (label) label.textContent = isFirefox ? 'AUDIO / IN' : 'AUDIO / PC';
    if (value) value.textContent = '…';
    if (mode) mode.textContent = isFirefox ? 'CHOOSE INPUT' : 'CHOOSE OUTPUT';
    if (hint) hint.textContent = isFirefox ? 'REMEMBER PERMISSION' : 'SHARE AUDIO';

    let picked = null;
    try {
      picked = isFirefox
        ? await media.getUserMedia({
            audio: {
              echoCancellation: false, noiseSuppression: false, autoGainControl: false,
              ...((deviceId || readPreference())
                ? { deviceId: exact ? { exact: deviceId } : { ideal: deviceId || readPreference() } }
                : {})
            },
            video: false
          })
        : await media.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: {
          suppressLocalAudioPlayback: false,
          restrictOwnAudio: false
        },
        systemAudio: 'include',
        windowAudio: 'system',
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude'
      });

      const audioTrack = picked.getAudioTracks()[0];
      const videoTrack = picked.getVideoTracks()[0];
      const displaySurface = videoTrack?.getSettings?.().displaySurface || 'shared';
      if (!audioTrack) {
        const error = new Error('No audio track shared');
        error.code = 'NO_AUDIO_TRACK';
        error.displaySurface = displaySurface;
        throw error;
      }

      /* Keep the browser's video capture track alive even though we never
         render or store it. Some browsers tie the shared audio track to the
         lifetime of the display-capture source; stopping video here can end
         the audio immediately and make the scope fall back to schedule mode. */
      stream = picked;
      if (isFirefox) savePreference(audioTrack.getSettings?.().deviceId || deviceId);
      audioContext = new AudioContextCtor();
      await audioContext.resume();
      source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.28;
      source.connect(analyser);
      data = new Uint8Array(analyser.fftSize);

      active = true;
      connecting = false;
      scope.classList.remove('pc-audio-pending', 'pc-audio-error');
      audioTrack.addEventListener('ended', () => { if (active) stop(); }, { once: true });
      videoTrack?.addEventListener('ended', () => { if (active) stop(); }, { once: true });
      const sourceLabel = isFirefox
        ? (loopbackName.test(audioTrack.label || '') ? 'LOOPBACK IN' : 'AUDIO INPUT')
        : (displaySurface === 'monitor' ? 'SYSTEM OUT' : displaySurface.toUpperCase());
      setUi(true, sourceLabel);
      draw();
    } catch (error) {
      stop();
      picked?.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      connecting = false;
      scope.classList.remove('pc-audio-pending', 'pc-audio-active', 'is-audio');
      scope.classList.add('pc-audio-error');
      if (label) label.textContent = isFirefox ? 'AUDIO / IN' : 'AUDIO / PC';
      const noAudio = error?.code === 'NO_AUDIO_TRACK';
      if (value) value.textContent = '--';
      if (mode) mode.textContent = error?.name === 'NotAllowedError'
        ? (isFirefox ? 'INPUT BLOCKED' : 'CANCELLED')
        : (isFirefox && error?.name === 'NotFoundError'
          ? 'NO AUDIO INPUT'
          : (noAudio ? 'NO AUDIO TRACK' : 'CAPTURE ERROR'));
      if (hint) hint.textContent = isFirefox ? 'CHECK INPUT / PERMISSION' : (noAudio ? 'SCREEN + SHARE AUDIO' : 'CLICK RETRY');
      scope.setAttribute(
        'aria-label',
        isFirefox
          ? 'Audio input unavailable. Allow the microphone permission and select a loopback device to monitor PC sound.'
          : (noAudio
            ? 'The selected source did not provide audio. Choose Entire Screen or a browser tab and enable Share audio.'
            : 'PC audio monitor is off. Activate to try again.')
      );
    }
  }

  async function showInputPicker() {
    if (!isFirefox || !navigator.mediaDevices?.enumerateDevices) return;
    if (!active) { start(); return; }
    closePicker();
    let devices;
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    } catch { return; }
    if (!active || !devices.length) return;

    const picker = document.createElement('div');
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Oscilloscope audio input');
    picker.style.cssText = 'position:fixed;z-index:10000;width:230px;padding:10px;box-sizing:border-box;border:1px solid #777568;border-radius:5px;background:#d8d3c5;box-shadow:0 5px 17px #0005;color:#32342f;font:12px system-ui,sans-serif';
    const rect = scope.getBoundingClientRect();
    picker.style.left = `${Math.max(8, Math.min(innerWidth - 238, rect.left))}px`;
    picker.style.top = `${Math.max(8, Math.min(innerHeight - 110, rect.bottom + 6))}px`;
    const caption = document.createElement('label');
    caption.textContent = 'AUDIO INPUT';
    caption.style.cssText = 'display:block;font-weight:700;font-size:10px;letter-spacing:.06em;margin-bottom:5px';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Audio input source');
    select.style.cssText = 'display:block;width:100%;font:12px system-ui,sans-serif;padding:4px';
    devices.forEach((d, i) => {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || `Input ${i + 1}`;
      select.append(option);
    });
    const current = stream?.getAudioTracks()[0]?.getSettings?.().deviceId || readPreference();
    if (devices.some(d => d.deviceId === current)) select.value = current;
    const note = document.createElement('div');
    note.textContent = 'For PC sound, select a loopback input.';
    note.style.cssText = 'font-size:10px;margin-top:6px;opacity:.8';
    picker.append(caption, select, note);
    select.addEventListener('change', () => {
      const nextId = select.value;
      closePicker();
      stop();
      start({ deviceId: nextId, exact: true });
    });
    document.body.append(picker);
    inputPicker = picker;
    document.addEventListener('pointerdown', dismissPicker);
    document.addEventListener('keydown', dismissPickerKey);
    select.focus();
  }

  function toggle() {
    if (active) stop();
    else {
      scope.classList.remove('pc-audio-error');
      start();
    }
  }

  if (isFirefox) {
    scope.title = 'Click to monitor an audio input. Select a loopback input for system sound.';
    scope.setAttribute('aria-label', 'Schedule interval monitor. Activate to monitor an audio input in Firefox.');
    scope.addEventListener('contextmenu', event => {
      event.preventDefault();
      showInputPicker();
    });
  }
  scope.addEventListener('click', toggle);
  scope.addEventListener('keydown', event => {
    if (isFirefox && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      showInputPicker();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
})();
