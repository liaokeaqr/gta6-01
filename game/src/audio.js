// All sound is synthesised with WebAudio: no audio files, nothing to download.
// The AudioContext is only built after the first user gesture (browsers block
// audio before that), and every call is wrapped in try/catch so a missing or
// blocked audio device can never break the game.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function blip(freq, dur, type, vol, when) {
    if (!ctx || muted) return;
    try {
      const t = when ?? now();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol || 0.25, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch {
      // Sound is garnish: never let it throw.
    }
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!ctx || muted) return;
    try {
      const t = now();
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff || 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t);
    } catch {
      // Sound is garnish: never let it throw.
    }
  }

  return {
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = !!value;
      try {
        if (master) master.gain.value = muted ? 0 : 0.5;
      } catch {
        // Ignore.
      }
    },
    /** Call from a user gesture (start / click): builds and resumes the context. */
    resume() {
      try {
        const c = ensure();
        if (c && c.state === 'suspended') void c.resume();
      } catch {
        // Ignore.
      }
    },
    /**
     * Continuous engine hum. `speed` is the car's speed in m/s, `driving` false
     * on foot (the hum fades out). Called every frame; cheap when nothing changes.
     */
    engine(speed, driving) {
      try {
        const c = ensure();
        if (!c || muted) {
          if (engineGain) engineGain.gain.value = 0;
          return;
        }
        if (!engineOsc) {
          engineOsc = c.createOscillator();
          engineOsc.type = 'sawtooth';
          engineFilter = c.createBiquadFilter();
          engineFilter.type = 'lowpass';
          engineFilter.frequency.value = 500;
          engineGain = c.createGain();
          engineGain.gain.value = 0;
          engineOsc.connect(engineFilter);
          engineFilter.connect(engineGain);
          engineGain.connect(master);
          engineOsc.start();
        }
        const target = driving ? 0.05 + Math.min(0.16, Math.abs(speed || 0) * 0.006) : 0;
        engineGain.gain.setTargetAtTime(target, now(), 0.08);
        engineOsc.frequency.setTargetAtTime(52 + Math.abs(speed || 0) * 4.5, now(), 0.08);
        engineFilter.frequency.setTargetAtTime(320 + Math.abs(speed || 0) * 26, now(), 0.1);
      } catch {
        // Ignore.
      }
    },
    /** Two-tone police siren while any police are chasing; call every frame. */
    siren(active) {
      try {
        const c = ensure();
        if (!c || muted || !active) {
          if (sirenGain) sirenGain.gain.value = 0;
          return;
        }
        if (!sirenOsc) {
          sirenOsc = c.createOscillator();
          sirenOsc.type = 'triangle';
          sirenOsc.frequency.value = 660;
          sirenGain = c.createGain();
          sirenGain.gain.value = 0;
          sirenOsc.connect(sirenGain);
          sirenGain.connect(master);
          sirenOsc.start();
        }
        sirenGain.gain.setTargetAtTime(0.05, now(), 0.1);
        sirenTimer += 1;
        if (sirenTimer % 30 === 0) {
          sirenOsc.frequency.setTargetAtTime(sirenOsc.frequency.value > 700 ? 520 : 880, now(), 0.05);
        }
      } catch {
        // Ignore.
      }
    },
    /** Named one-shot effects, triggered by world events. */
    play(name) {
      try {
        ensure();
        if (!ctx || muted) return;
        const t = now();
        if (name === 'pickup') {
          blip(880, 0.09, 'sine', 0.25, t);
          blip(1318, 0.14, 'sine', 0.22, t + 0.08);
        } else if (name === 'deliver') {
          blip(523, 0.12, 'sine', 0.25, t);
          blip(659, 0.12, 'sine', 0.25, t + 0.11);
          blip(784, 0.2, 'sine', 0.28, t + 0.22);
        } else if (name === 'hit') {
          noiseBurst(0.22, 0.5, 700);
          blip(90, 0.2, 'sine', 0.4, t);
        } else if (name === 'wanted') {
          blip(392, 0.12, 'square', 0.12, t);
          blip(311, 0.18, 'square', 0.12, t + 0.13);
        } else if (name === 'busted') {
          blip(440, 0.25, 'sawtooth', 0.2, t);
          blip(349, 0.25, 'sawtooth', 0.2, t + 0.22);
          blip(262, 0.45, 'sawtooth', 0.22, t + 0.44);
        } else if (name === 'win') {
          blip(523, 0.14, 'sine', 0.25, t);
          blip(659, 0.14, 'sine', 0.25, t + 0.13);
          blip(784, 0.14, 'sine', 0.25, t + 0.26);
          blip(1046, 0.32, 'sine', 0.28, t + 0.39);
        } else if (name === 'shoot') {
          noiseBurst(0.09, 0.4, 3200);
          blip(1500, 0.08, 'square', 0.14, t);
          blip(320, 0.1, 'sine', 0.2, t + 0.02);
        } else if (name === 'punch') {
          noiseBurst(0.1, 0.35, 500);
          blip(75, 0.12, 'sine', 0.4, t);
        } else if (name === 'click') {
          blip(660, 0.05, 'sine', 0.15, t);
        }
      } catch {
        // Ignore.
      }
    },
  };
}
