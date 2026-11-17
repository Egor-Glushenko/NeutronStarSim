/* =========================================================================
   Звук: синтез на Web Audio API.
   Слои: гармоническая подложка (пэд), ритм импульсов (FM-колокол + тело +
   щелчок), шум аккреции, шипение магнетара, эффекты (вспышка, взрыв).
   Всё идёт через общий компрессор и реверб.
   ========================================================================= */
(function (NS) {
  'use strict';

  /* Пентатоника ля-минор — любая частота ложится в гармонию */
  const SCALE = [110.00, 130.81, 146.83, 164.81, 196.00];
  const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

  function pickRoot(nu) {
    const i = Math.round(Math.log2(Math.max(20, nu)) * 2);
    const idx = ((i % 5) + 5) % 5;
    return SCALE[idx];
  }

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.enabled = false;
      this.paused = false;
      this.volume = 0.55;
      this.mix = { ambience: 0.75, pulse: 0.8, fx: 0.9, reverb: 0.45 };
      this.rhythm = true;
      this.pulseRate = 1;
      this.baseHz = 110;
      this.accretion = 0;
      this.magnetar = 0;
      this._next = 0;
      this._timer = 0;
      this._root = 0;
      this._noiseRamp = false;
      this._beat = 0;
      this._noiseBuf = null;
      this._n = null;
    }

    /* ------------------------------------------------------------- граф --- */
    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      this.ctx = ctx;

      /* мастер: gain -> limiter -> destiny */
      const master = ctx.createGain();
      master.gain.value = 0.0001;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -22;
      comp.knee.value = 16;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;

      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 9000;

      master.connect(tone);
      tone.connect(comp);
      comp.connect(limiter);
      limiter.connect(ctx.destination);

      /* реверб: посыл -> свёртка -> возврат */
      const send = ctx.createGain();
      send.gain.value = 1.0;
      const verb = ctx.createConvolver();
      verb.buffer = this._impulse(ctx, 2.6, 2.4);
      const verbGain = ctx.createGain();
      verbGain.gain.value = this.mix.reverb;
      const verbHp = ctx.createBiquadFilter();
      verbHp.type = 'highpass';
      verbHp.frequency.value = 180;
      send.connect(verbHp);
      verbHp.connect(verb);
      verb.connect(verbGain);
      verbGain.connect(master);

      /* ---- пэд ---- */
      const padGain = ctx.createGain();
      padGain.gain.value = 0.0;
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 700;
      padFilter.Q.value = 1.6;

      const padLfo = ctx.createOscillator();
      padLfo.type = 'sine';
      padLfo.frequency.value = 0.055;
      const padLfoGain = ctx.createGain();
      padLfoGain.gain.value = 260;
      padLfo.connect(padLfoGain);
      padLfoGain.connect(padFilter.frequency);

      const oscs = [];
      const voices = [
        { type: 'sine', mul: 0.5, gain: 0.55, det: 0 },
        { type: 'triangle', mul: 1.0, gain: 0.26, det: 4 },
        { type: 'sawtooth', mul: 1.5, gain: 0.10, det: -6 },
        { type: 'sine', mul: 2.0, gain: 0.14, det: 7 }
      ];
      voices.forEach((v) => {
        const o = ctx.createOscillator();
        o.type = v.type;
        o.frequency.value = 110 * v.mul;
        o.detune.value = v.det;
        const g = ctx.createGain();
        g.gain.value = v.gain;
        o.connect(g);
        g.connect(padFilter);
        o.start();
        oscs.push({ osc: o, mul: v.mul });
      });
      padFilter.connect(padGain);
      padGain.connect(master);
      padGain.connect(send);
      padLfo.start();

      /* ---- шум: аккреция ---- */
      const noiseBuf = this._noise(ctx, 3.0);
      this._noiseBuf = noiseBuf;

      const accSrc = ctx.createBufferSource();
      accSrc.buffer = noiseBuf;
      accSrc.loop = true;
      const accBp = ctx.createBiquadFilter();
      accBp.type = 'bandpass';
      accBp.frequency.value = 420;
      accBp.Q.value = 0.7;
      const accGain = ctx.createGain();
      accGain.gain.value = 0;
      accSrc.connect(accBp);
      accBp.connect(accGain);
      accGain.connect(master);
      accGain.connect(send);
      accSrc.start();

      /* ---- шипение магнетара ---- */
      const shSrc = ctx.createBufferSource();
      shSrc.buffer = noiseBuf;
      shSrc.loop = true;
      const shBp = ctx.createBiquadFilter();
      shBp.type = 'bandpass';
      shBp.frequency.value = 5200;
      shBp.Q.value = 3.0;
      const shGain = ctx.createGain();
      shGain.gain.value = 0;
      shSrc.connect(shBp);
      shBp.connect(shGain);
      shGain.connect(master);
      shSrc.start();

      this._n = {
        master: master, send: send, verbGain: verbGain,
        padGain: padGain, padFilter: padFilter, oscs: oscs,
        accGain: accGain, accBp: accBp, shGain: shGain,
        padLfo: padLfo
      };
      this.ready = true;
      return true;
    }

    _impulse(ctx, seconds, decay) {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const env = Math.pow(1 - t, decay);
          data[i] = (Math.random() * 2 - 1) * env * (1 - 0.35 * Math.sin(i * 0.0007));
        }
        /* ранние отражения */
        for (let k = 0; k < 6; k++) {
          const pos = Math.floor(rate * (0.01 + k * 0.013));
          if (pos < len) data[pos] += (Math.random() * 2 - 1) * 0.35 * (1 - k / 6);
        }
      }
      return buf;
    }

    _noise(ctx, seconds) {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.03 * w) / 1.03;
        d[i] = last * 3.0;
      }
      return buf;
    }

    _now() { return this.ctx ? this.ctx.currentTime : 0; }

    /* ------------------------------------------------------- включение --- */
    setEnabled(on) {
      this.enabled = !!on;
      if (!this.ctx) {
        if (!this.enabled) return;
        if (!this._build()) { this.enabled = false; return; }
      }
      const ctx = this.ctx;
      if (on) {
        if (ctx.state === 'suspended') ctx.resume();
        this._apply();
        this._rampMaster(this.volume * 0.55);
        this._startScheduler();
      } else {
        this._rampMaster(0);
        this._stopScheduler();
        if (ctx.state === 'running') setTimeout(() => { if (!this.enabled) ctx.suspend(); }, 400);
      }
    }

    _rampMaster(v) {
      if (!this.ctx) return;
      const g = this._n.master.gain;
      const t = this._now();
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(Math.max(0.0001, v), t + 0.4);
    }

    setVolume(v) {
      this.volume = v;
      if (this.enabled) this._rampMaster(v * 0.55);
    }

    setMix(mix) {
      Object.assign(this.mix, mix || {});
      if (!this._n) return;
      const t = this._now();
      this._n.verbGain.gain.setTargetAtTime(this.mix.reverb * 0.9, t, 0.2);
      this._apply();
    }

    setRhythm(on) { this.rhythm = !!on; }

    setPaused(p) { this.paused = !!p; }

    /* ------------------------------------------------------- параметры --- */
    setSpin(hz, nu) {
      this.pulseRate = Math.max(0.06, Math.min(4.5, hz));
      const root = pickRoot(nu);
      if (this._root === 0 || Math.abs(root - this._root) > 0.5) {
        this._root = root;
        this.baseHz = root;
        if (this._n) {
          const t = this._now();
          this._n.oscs.forEach((o) => {
            o.osc.frequency.setTargetAtTime(root * o.mul, t, 0.35);
          });
          this._n.padFilter.frequency.setTargetAtTime(500 + 900 * Math.min(1, Math.log10(1 + nu) / 2.6), t, 0.6);
        }
      }
      if (this._noiseRamp !== true && this._n) this._noiseRamp = true;
    }

    setAccretion(x) {
      this.accretion = x;
      if (!this._n) return;
      const t = this._now();
      this._n.accGain.gain.setTargetAtTime(0.20 * x * x * this.mix.fx, t, 0.35);
      this._n.accBp.frequency.setTargetAtTime(280 + 780 * x, t, 0.35);
    }

    setMagnetar(x) {
      this.magnetar = x;
      if (!this._n) return;
      const t = this._now();
      this._n.shGain.gain.setTargetAtTime(0.012 * x * this.mix.ambience, t, 0.5);
    }

    _apply() {
      if (!this._n) return;
      const t = this._now();
      this._n.padGain.gain.setTargetAtTime(0.34 * this.mix.ambience, t, 0.5);
      this._n.verbGain.gain.setTargetAtTime(this.mix.reverb * 0.9, t, 0.3);
      this._n.accGain.gain.setTargetAtTime(0.20 * this.accretion * this.accretion * this.mix.fx, t, 0.4);
      this._n.shGain.gain.setTargetAtTime(0.012 * this.magnetar * this.mix.ambience, t, 0.5);
    }

    /* ------------------------------------------------- расписание ритма -- */
    _startScheduler() {
      this._stopScheduler();
      this._next = this._now() + 0.10;
      this._timer = setInterval(() => this._tick(), 90);
    }

    _stopScheduler() {
      if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    }

    _tick() {
      if (!this.ctx || !this.ready || this.paused) return;
      if (this.ctx.state !== 'running') return;
      const horizon = this._now() + 0.28;
      let guard = 0;
      while (this._next < horizon && guard++ < 8) {
        if (this.rhythm) this._pulse(this._next);
        const period = 1 / this.pulseRate;
        this._next += period;
        if (this._next < this._now() - 0.5) this._next = this._now() + period;
      }
    }

    _pan(node, pan) {
      if (this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        node.connect(p);
        return p;
      }
      return node;
    }

    _pulse(at) {
      const ctx = this.ctx, n = this._n;
      this._beat++;
      const g = ctx.createGain();
      g.gain.value = this.mix.pulse;
      /* панорама «гуляет» по сцене */
      const pan = Math.sin(this._beat * 0.9) * 0.55;
      const out = this._pan(g, pan);
      out.connect(n.master);
      out.connect(n.send);

      const f0 = this.baseHz;
      const dur = Math.min(0.45, 0.65 / this.pulseRate);

      /* 1. тело удара */
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(f0, at);
      body.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + dur * 0.85);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, at);
      bg.gain.exponentialRampToValueAtTime(0.9, at + 0.006);
      bg.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      body.connect(bg);
      bg.connect(g);
      body.start(at);
      body.stop(at + dur + 0.06);

      /* 2. металлический призвук (FM) */
      const car = ctx.createOscillator();
      car.type = 'sine';
      car.frequency.setValueAtTime(f0 * 3.0, at);
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(f0 * 3.0 * 1.41, at);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f0 * 5.5, at);
      modGain.gain.exponentialRampToValueAtTime(1, at + 0.18);
      mod.connect(modGain);
      modGain.connect(car.frequency);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, at);
      cg.gain.exponentialRampToValueAtTime(0.16, at + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.8);
      car.connect(cg);
      cg.connect(g);
      car.start(at);
      mod.start(at);
      car.stop(at + dur + 0.06);
      mod.stop(at + dur + 0.06);

      /* 3. щелчок приёмника */
      if (this._noiseBuf) {
        const s = ctx.createBufferSource();
        s.buffer = this._noiseBuf;
        s.playbackRate.value = 1 + Math.random() * 0.4;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1800 + Math.random() * 900;
        bp.Q.value = 1.2;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, at);
        ng.gain.exponentialRampToValueAtTime(0.10, at + 0.004);
        ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
        s.connect(bp);
        bp.connect(ng);
        ng.connect(g);
        s.start(at, Math.random() * 2.0, 0.08);
      }

      /* самопроизвольный «выброс» в общий gain — чтобы не плодить узлы */
      setTimeout(() => { try { out.disconnect(); } catch (e) { /* ignore */ } },
        (dur + 0.4) * 1000);
    }

    /* ---------------------------------------------------------- эффекты --- */
    flare() {
      if (!this.ctx || !this.enabled || !this.ready) return;
      const ctx = this.ctx, n = this._n, t = this._now() + 0.02;
      const g0 = ctx.createGain();
      g0.gain.value = this.mix.fx;
      const out = this._pan(g0, 0);
      out.connect(n.master);
      out.connect(n.send);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.75);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.9);

      if (this._noiseBuf) {
        const s = ctx.createBufferSource();
        s.buffer = this._noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2400, t);
        bp.frequency.exponentialRampToValueAtTime(300, t + 0.7);
        bp.Q.value = 1.4;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.20, t + 0.03);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        s.connect(bp); bp.connect(g2); g2.connect(out);
        s.start(t, Math.random(), 0.9);
      }
    }

    /* Взрыв сверхновой: суббас + рокот + треск */
    boom() {
      if (!this.ctx || !this.ready) return;
      const ctx = this.ctx, n = this._n, t = this._now() + 0.01;
      const g0 = ctx.createGain();
      g0.gain.value = this.mix.fx;
      const out = g0;
      g0.connect(n.master);
      g0.connect(n.send);

      /* суббас */
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(110, t);
      sub.frequency.exponentialRampToValueAtTime(26, t + 2.2);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(0.85, t + 0.03);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      sub.connect(sg); sg.connect(out);
      sub.start(t); sub.stop(t + 3.3);

      /* рокот: шум со спадом фильтра */
      if (this._noiseBuf) {
        const s = ctx.createBufferSource();
        s.buffer = this._noiseBuf;
        s.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5200, t);
        lp.frequency.exponentialRampToValueAtTime(140, t + 3.0);
        lp.Q.value = 0.9;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.exponentialRampToValueAtTime(0.55, t + 0.04);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
        s.connect(lp); lp.connect(ng); ng.connect(out);
        s.start(t);
        s.stop(t + 3.7);

        /* треск */
        for (let i = 0; i < 14; i++) {
          const at = t + 0.05 + Math.random() * 1.8;
          const c = ctx.createBufferSource();
          c.buffer = this._noiseBuf;
          c.playbackRate.value = 0.6 + Math.random();
          const hp = ctx.createBiquadFilter();
          hp.type = 'bandpass';
          hp.frequency.value = 900 + Math.random() * 2600;
          hp.Q.value = 2.0;
          const cg = ctx.createGain();
          cg.gain.setValueAtTime(0.0001, at);
          cg.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.07, at + 0.008);
          cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.12 + Math.random() * 0.2);
          c.connect(hp); hp.connect(cg); cg.connect(out);
          c.start(at, Math.random() * 2.4, 0.35);
        }
      }
    }

    setHidden(hidden) {
      if (!this.ctx) return;
      if (hidden) { if (this.ctx.state === 'running') this.ctx.suspend(); }
      else if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
    }
  }

  NS.Sound = SoundEngine;
})(window.NS = window.NS || {});
