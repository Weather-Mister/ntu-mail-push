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
  let captureEpoch = 0;
  const inputStreams = [];
  let currentInput = null;
  let lastAutoSwitch = 0;
  let pendingFirefoxStream = null;
  let pickerGeneration = 0;

  const multiPreferenceKey = 'ntu-scope-firefox-inputs';
  function readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(multiPreferenceKey));
      if (Array.isArray(stored)) return [...new Set(stored.filter(id => typeof id === 'string' && id))].slice(0, 12);
    } catch {}
    const prior = readPreference();
    return prior ? [prior] : [];
  }
  function savePreferences(ids) {
    try { localStorage.setItem(multiPreferenceKey, JSON.stringify([...new Set(ids)].slice(0, 12))); } catch {}
  }
  function statusForInput(input) {
    if (!input) return 'AUDIO INPUT';
    const name = input.track.label || input.label || 'INPUT';
    return inputStreams.length > 1 ? 'AUTO: ' + name.slice(0, 12).toUpperCase()
      : (loopbackName.test(name) ? 'LOOPBACK IN' : 'AUDIO INPUT');
  }


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
    if (!active) return;
    if (isFirefox) {
      // Firefox may move a track to "ended" without delivering its event to a
      // particular MediaStream wrapper. Prune from readyState as well, so
      // stale sources cannot keep the count wrong or freeze auto-selection.
      const previousCount = inputStreams.length;
      for (let i = inputStreams.length - 1; i >= 0; i--) {
        const input = inputStreams[i];
        if (input.track.readyState !== 'ended') continue;
        try { input.source.disconnect(); } catch {}
        inputStreams.splice(i, 1);
      }
      if (inputStreams.length !== previousCount && inputStreams.length) {
        if (!inputStreams.includes(currentInput)) currentInput = null;
        if (value) value.textContent = inputStreams.length > 1 ? inputStreams.length + ' IN' : 'LIVE';
        if (label) label.textContent = inputStreams.length > 1 ? 'AUDIO / AUTO' : 'AUDIO / IN';
        if (mode) mode.textContent = statusForInput(currentInput || inputStreams[0]);
      }

      // Separate analysers avoid mixing inputs and let us select the strongest
      // *actual* input signal instead of inferring the OS playback device.
      let best = null;
      for (const input of inputStreams) {
        if (input.track.readyState === 'ended') continue;
        input.analyser.getByteTimeDomainData(input.data);
        let sum = 0;
        for (const sample of input.data) {
          const v = (sample - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / input.data.length);
        input.level += (rms - input.level) * (rms > input.level ? 0.4 : 0.14);
        if (!best || input.level > best.level) best = input;
      }
      if (!best) { stop(); return; }
      const now = performance.now();
      if (!currentInput || !inputStreams.includes(currentInput) ||
          (best !== currentInput && best.level > 0.012 &&
           (currentInput.level < 0.009 || best.level > currentInput.level * 1.4) &&
           now - lastAutoSwitch > 240)) {
        currentInput = best;
        lastAutoSwitch = now;
        if (mode) mode.textContent = statusForInput(currentInput);
      }
      analyser = currentInput.analyser;
      data = currentInput.data;
    }
    if (!analyser || !data) return;
    if (!isFirefox) analyser.getByteTimeDomainData(data);

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
    // Invalidate any enumerateDevices() that is still resolving.
    pickerGeneration++;
    inputPicker?.remove();
    inputPicker = null;
    document.removeEventListener('pointerdown', dismissPicker);
    document.removeEventListener('keydown', dismissPickerKey);
  }

  function stop() {
    captureEpoch++;
    closePicker();
    // A granted input may still be waiting for AudioContext.resume().
    pendingFirefoxStream?.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
    pendingFirefoxStream = null;
    for (const input of inputStreams.splice(0)) {
      try { input.source.disconnect(); } catch {}
      input.stream.getTracks().forEach(track => { try { track.stop(); } catch {} });
    }
    currentInput = null;
    lastAutoSwitch = 0;
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

  async function startFirefox(selected = null) {
    if (active || connecting) return;
    const media = navigator.mediaDevices;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!media?.getUserMedia || !AudioContextCtor) {
      scope.classList.add('pc-audio-error');
      if (mode) mode.textContent = 'UNSUPPORTED';
      return;
    }
    const requested = selected || readPreferences();
    const choices = requested.length ? requested : [null];
    const epoch = ++captureEpoch;
    connecting = true;
    scope.classList.remove('pc-audio-error');
    scope.classList.add('pc-audio-pending');
    if (label) label.textContent = 'AUDIO / IN';
    if (value) value.textContent = '…';
    if (mode) mode.textContent = 'CHOOSE INPUT';
    if (hint) hint.textContent = 'REMEMBER PERMISSION';

    // Unlock Web Audio directly in the initiating click's user activation.
    // Firefox may otherwise leave resume() pending when first called after the
    // async device-permission prompt. The analyser connects after capture.
    try {
      audioContext = new AudioContextCtor();
      audioContext.resume().catch(() => {});
    } catch {
      stop();
      scope.classList.add('pc-audio-error');
      if (mode) mode.textContent = 'AUDIO ERROR';
      if (hint) hint.textContent = 'CLICK RETRY';
      return;
    }

    let firstError = null;
    for (const deviceId of choices) {
      let picked = null;
      try {
        picked = await media.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {})
          },
          video: false
        });
        if (epoch !== captureEpoch) {
          picked.getTracks().forEach(track => track.stop());
          return;
        }
        pendingFirefoxStream = picked;
        const track = picked.getAudioTracks()[0];
        if (!track) throw new Error('No audio input track');
        // The audio context has already been resumed under the original
        // click gesture; never block source setup on a later autoplay prompt.
        const inputSource = audioContext.createMediaStreamSource(new MediaStream([track]));
        const inputAnalyser = audioContext.createAnalyser();
        inputAnalyser.fftSize = 512;
        inputAnalyser.smoothingTimeConstant = 0.28;
        inputSource.connect(inputAnalyser);
        const input = {
          stream: picked, track, source: inputSource, analyser: inputAnalyser,
          data: new Uint8Array(inputAnalyser.fftSize), level: 0,
          id: deviceId || track.getSettings?.().deviceId || '',
          label: track.label || ''
        };
        inputStreams.push(input);
        pendingFirefoxStream = null;
        track.addEventListener('ended', () => {
          if (!active) return;
          try { inputSource.disconnect(); } catch {}
          const idx = inputStreams.indexOf(input);
          if (idx >= 0) inputStreams.splice(idx, 1);
          if (!inputStreams.length) stop();
          else {
            if (currentInput === input) currentInput = null;
            if (value) value.textContent = inputStreams.length > 1 ? inputStreams.length + ' IN' : 'LIVE';
          }
        }, { once: true });
      } catch (error) {
        if (!firstError) firstError = error;
        if (pendingFirefoxStream === picked) pendingFirefoxStream = null;
        picked?.getTracks().forEach(track => { try { track.stop(); } catch {} });
        // A rejection is not permission to try other new devices.
        if (error?.name === 'NotAllowedError') break;
      }
    }
    if (epoch !== captureEpoch) return;
    connecting = false;
    if (!inputStreams.length) {
      stop();
      scope.classList.add('pc-audio-error');
      if (label) label.textContent = 'AUDIO / IN';
      if (value) value.textContent = '--';
      if (mode) mode.textContent = firstError?.name === 'NotAllowedError'
        ? 'INPUT BLOCKED' : 'NO AUDIO INPUT';
      if (hint) hint.textContent = 'CHECK INPUT / PERMISSION';
      return;
    }
    if (!requested.length) {
      const firstId = inputStreams[0].id;
      if (firstId) savePreferences([firstId]);
    }
    active = true;
    scope.classList.remove('pc-audio-pending', 'pc-audio-error');
    currentInput = inputStreams[0];
    setUi(true, statusForInput(currentInput));
    if (label) label.textContent = inputStreams.length > 1 ? 'AUDIO / AUTO' : 'AUDIO / IN';
    if (value) value.textContent = inputStreams.length > 1 ? inputStreams.length + ' IN' : 'LIVE';
    draw();
  }

  async function start({ deviceId = '', exact = false } = {}) {
    if (active || connecting) return;
    if (isFirefox) return startFirefox(deviceId ? [deviceId] : null);
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
    closePicker();
    const generation = pickerGeneration;
    let devices;
    try {
      devices = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    } catch { return; }
    if (generation !== pickerGeneration) return;

    const picker = document.createElement('div');
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Oscilloscope audio inputs');
    picker.style.cssText = 'position:fixed;z-index:10000;width:255px;padding:12px;box-sizing:border-box;border:1px solid #777568;border-radius:5px;background:#d8d3c5;box-shadow:0 5px 17px #0005;color:#32342f;font:12px system-ui,sans-serif';
    const rect = scope.getBoundingClientRect();
    picker.style.left = `${Math.max(8, Math.min(innerWidth - 263, rect.left))}px`;
    picker.style.top = `${Math.max(8, Math.min(innerHeight - 160, rect.bottom + 6))}px`;

    const caption = document.createElement('strong');
    caption.textContent = 'AUDIO INPUTS / AUTO';
    caption.style.cssText = 'display:block;font-size:11px;letter-spacing:.05em;margin-bottom:8px';
    const list = document.createElement('div');
    list.style.cssText = 'max-height:180px;overflow:auto;display:grid;gap:7px';
    const chosen = new Set(readPreferences());
    if (!chosen.size) inputStreams.forEach(input => { if (input.id) chosen.add(input.id); });
    const checkboxes = [];
    devices.forEach((device, i) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:7px;cursor:pointer;line-height:1.25';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = device.deviceId;
      checkbox.checked = chosen.has(device.deviceId);
      checkbox.setAttribute('aria-label', device.label || `Input ${i + 1}`);
      const text = document.createElement('span');
      text.textContent = device.label || `Input ${i + 1}`;
      row.append(checkbox, text);
      list.append(row);
      checkboxes.push(checkbox);
    });
    const note = document.createElement('p');
    note.textContent = devices.length
      ? 'Select inputs once. The strongest active signal appears automatically. PC sound requires loopback inputs.'
      : 'No selectable inputs listed. Click the oscilloscope to grant audio permission first.';
    note.style.cssText = 'font-size:10px;line-height:1.4;margin:8px 0;color:#55584c';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:7px';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.disabled = !checkboxes.some(c => c.checked);
    for (const button of [cancel, apply]) {
      button.style.cssText = 'padding:4px 9px;border-radius:3px;border:1px solid #777568;background:#eae5d7;color:#32342f;cursor:pointer';
    }
    checkboxes.forEach(c => c.addEventListener('change', () => {
      apply.disabled = !checkboxes.some(c => c.checked);
    }));
    cancel.addEventListener('click', closePicker);
    apply.addEventListener('click', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      if (!selected.length) return;
      savePreferences(selected);
      stop();
      startFirefox(selected);
    });
    buttons.append(cancel, apply);
    picker.append(caption, list, note, buttons);
    document.body.append(picker);
    inputPicker = picker;
    document.addEventListener('pointerdown', dismissPicker);
    document.addEventListener('keydown', dismissPickerKey);
    (checkboxes[0] || cancel).focus();
  }

  function toggle() {
    // A second click cancels a pending Firefox permission/device request.
    if (isFirefox && connecting) { stop(); return; }
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
