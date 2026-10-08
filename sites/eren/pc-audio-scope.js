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
  let level = 0;
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
    // Follow loudness while preserving the schedule trace's wavelength and motion.
    const desired = Math.min(1, rms * 3);
    level += (desired - level) * (desired > level ? 0.3 : 0.12);
    drawScheduleScope(performance.now(), level);
    raf = requestAnimationFrame(draw);
  }

  function stop() {
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
    scope.title = 'Click to monitor PC audio';
    if (label) label.textContent = 'ΔT / SCHED';
    if (value) value.textContent = '--';
    if (mode) mode.textContent = 'SCHEDULE';
    if (hint) hint.textContent = 'λ ∝ ΔT';
    scope.setAttribute('aria-label', 'Schedule interval monitor. Activate to monitor PC audio.');
    window.dispatchEvent(new Event('resize'));
  }

  async function start() {
    if (active || connecting) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getDisplayMedia || !AudioContextCtor) {
      scope.classList.add('pc-audio-error');
      if (label) label.textContent = 'AUDIO / PC';
      if (value) value.textContent = 'N/A';
      if (mode) mode.textContent = 'UNSUPPORTED';
      if (hint) hint.textContent = 'BROWSER';
      return;
    }

    scope.classList.remove('pc-audio-error');
    scope.classList.add('pc-audio-pending');
    connecting = true;
    if (label) label.textContent = 'AUDIO / PC';
    if (value) value.textContent = '…';
    if (mode) mode.textContent = 'CHOOSE OUTPUT';
    if (hint) hint.textContent = 'SHARE AUDIO';

    let picked = null;
    try {
      picked = await navigator.mediaDevices.getDisplayMedia({
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
      const sourceLabel = displaySurface === 'monitor' ? 'SYSTEM OUT' : displaySurface.toUpperCase();
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
      if (label) label.textContent = 'AUDIO / PC';
      const noAudio = error?.code === 'NO_AUDIO_TRACK';
      if (value) value.textContent = '--';
      if (mode) mode.textContent = error?.name === 'NotAllowedError'
        ? 'CANCELLED'
        : (noAudio ? 'NO AUDIO TRACK' : 'CAPTURE ERROR');
      if (hint) hint.textContent = noAudio ? 'SCREEN + SHARE AUDIO' : 'CLICK RETRY';
      scope.setAttribute(
        'aria-label',
        noAudio
          ? 'The selected source did not provide audio. Choose Entire Screen or a browser tab and enable Share audio.'
          : 'PC audio monitor is off. Activate to try again.'
      );
    }
  }

  function toggle() {
    if (active) stop();
    else {
      scope.classList.remove('pc-audio-error');
      start();
    }
  }

  scope.addEventListener('click', toggle);
  scope.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
})();
