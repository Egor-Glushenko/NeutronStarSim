/* =========================================================================
   Основной модуль: сцена, камера, геометрия, постобработка, HUD
   ========================================================================= */
(function (NS) {
  'use strict';

  const GL = NS.GL;
  const SH = NS.SHADERS;
  const Physics = NS.Physics;
  const M = NS.MathX;
  const F = NS.Fmt;
  const UI = NS.UI;
  const clamp = M.clamp;
  const RAD = Math.PI / 180;
  const MSUN = 1.98892e30;

  /* ------------------------------------------------------------ параметры -- */
  const DEFAULTS = {
    preset: 'pulsar',
    nu: 29.9,
    alpha: 50 * RAD,
    Bgauss: 3.8e12,
    mass: 1.4,
    radiusKm: 12,
    tempMK: 1.6,
    mdot: 0,
    autoEvo: 0,
    timeScale: 1,
    boomEnergy: 1e51,
    boomMass: 0.1,
    collapse: false,
    showField: true,
    showBeam: true,
    showDisk: true,
    showJets: false,
    autoRotate: true,
    glow: 1,
    bloom: 1,
    particles: 0.6,
    quality: 'auto',
    sound: false,
    volume: 0.55,
    ambience: 0.75,
    pulseGain: 0.8,
    reverb: 0.45,
    rhythm: true
  };

  const PRESETS = {
    pulsar: {
      nu: 29.9, alpha: 50 * RAD, Bgauss: 3.8e12, mass: 1.4, radiusKm: 12,
      tempMK: 1.6, mdot: 0, accent: '#6fb0ff', accent2: '#a97bff', tint: [0.24, 0.30, 0.62]
    },
    magnetar: {
      nu: 0.35, alpha: 12 * RAD, Bgauss: 2.0e14, mass: 1.4, radiusKm: 11.5,
      tempMK: 4.5, mdot: 0, accent: '#b98cff', accent2: '#5fd0ff', tint: [0.42, 0.24, 0.68]
    },
    ms: {
      nu: 600, alpha: 25 * RAD, Bgauss: 8e8, mass: 1.7, radiusKm: 11.2,
      tempMK: 0.8, mdot: 0, accent: '#4fe0cf', accent2: '#7aa8ff', tint: [0.16, 0.44, 0.50]
    },
    binary: {
      nu: 4.2, alpha: 18 * RAD, Bgauss: 2e12, mass: 1.5, radiusKm: 12.4,
      tempMK: 1.2, mdot: 2e-9, accent: '#ffa04a', accent2: '#ff5f7a', tint: [0.55, 0.30, 0.22]
    },
    young: {
      nu: 1.8, alpha: 40 * RAD, Bgauss: 5e13, mass: 1.35, radiusKm: 12.6,
      tempMK: 6.0, mdot: 0, accent: '#9aa8ff', accent2: '#e08cff', tint: [0.34, 0.28, 0.66]
    },
    sn: {
      nu: 0.6, alpha: 35 * RAD, Bgauss: 1.2e13, mass: 1.7, radiusKm: 11.8,
      tempMK: 7.5, mdot: 0, accent: '#ff8a4a', accent2: '#ffd36b', tint: [0.60, 0.34, 0.20]
    }
  };

  const P = {};
  Object.keys(DEFAULTS).forEach((k) => { P[k] = DEFAULTS[k]; });
  let D = Physics(P);

  /* ---------------------------------------------------------------- DOM --- */
  const canvas = document.getElementById('sky');
  const controlsEl = document.getElementById('controls');
  const hudRowsEl = document.getElementById('hudRows');
  const statusEl = document.getElementById('status');
  const badgeTypeEl = document.getElementById('badgeType');
  const badgeInfoEl = document.getElementById('badgeInfo');
  const pulseCanvas = document.getElementById('pulse');
  const pulseCtx = pulseCanvas.getContext('2d');
  const PW = 320, PH = 104, PDPR = 2;
  pulseCanvas.width = PW * PDPR;
  pulseCanvas.height = PH * PDPR;
  const pulseRateEl = document.getElementById('pulseRate');
  const hintEl = document.getElementById('hint');
  const veilEl = document.getElementById('veil');
  const btnPause = document.getElementById('btnPause');

  /* --------------------------------------------------------------- WebGL --- */
  const gl = GL.create(canvas);
  if (!gl) {
    veilEl.hidden = false;
    return;
  }

  let progs, quadBuf, lineBuf, sprBuf, skyTex;
  let sceneRT = null, bloomA = null, bloomB = null, blurTmp = null;

  try {
    progs = {
      bg: GL.program(gl, SH.quadVS, SH.bg, 'bg'),
      sphere: GL.program(gl, SH.quadVS, SH.sphere, 'sphere'),
      volume: GL.program(gl, SH.quadVS, SH.volume, 'volume'),
      line: GL.program(gl, SH.lineVS, SH.lineFS, 'line'),
      spr: GL.program(gl, SH.sprVS, SH.sprFS, 'sprite'),
      bright: GL.program(gl, SH.quadVS, SH.bright, 'bright'),
      blur: GL.program(gl, SH.quadVS, SH.blur, 'blur'),
      composite: GL.program(gl, SH.quadVS, SH.composite, 'composite')
    };
    quadBuf = GL.quad(gl);
    skyTex = GL.textureFromCanvas(gl, GL.makeSkyCanvas());
  } catch (err) {
    console.error(err);
    const box = document.createElement('pre');
    box.style.cssText = 'max-width:760px;white-space:pre-wrap;font-size:11px;color:#ff9d9d';
    box.textContent = String(err && err.message) + '\n\n' + (err.glslSrc || '');
    veilEl.querySelector('.veilbox').appendChild(box);
    veilEl.hidden = false;
    return;
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  /* --------------------------------------------------------------- состояние */
  const st = {
    phase: 0, t: 0, last: 0, raf: 0,
    fps: 60, frames: 0, fpsT: 0, lastAdapt: 0,
    perfScale: 1, dragging: false,
    flare: 0, flash: 0, wantShot: false,
    hudT: 0, pulseT: 0, pulseCalcT: 0, sndT: 0, syncT: 0,
    hidden: false,
    collapse: 0,
    boom: { active: false, t: 0, dur: 7.0, intensity: 0, shellR: 0, age: 0, v: 0, fired: false }
  };

  const cam = { yaw: 0.62, pitch: 0.30, dist: 5.4, targetDist: 5.4 };
  const fov = 42 * RAD;
  const eye = [0, 0, 5.4], fwd = [0, 0, -1], right = [1, 0, 0], up = [0, 1, 0];
  const uTan = Math.tan(fov / 2);
  const spinM = new Float32Array(9);
  const spinInvM = new Float32Array(9);

  const sound = new NS.Sound();

  /* ---------------------------------------------------------- силовые линии */
  const SHELLS = [1.55, 2.25, 3.3, 4.9];
  const AZIM = 6;
  const SEG = 30;
  const LINE_VERTS = SHELLS.length * AZIM * SEG * 2;

  const lineLocal = new Float32Array(LINE_VERTS * 3);
  const lineRgb = new Float32Array(LINE_VERTS * 3);
  const lineData = new Float32Array(LINE_VERTS * 6);
  let lineVertCount = 0;

  function buildField() {
    const a = P.alpha;
    const mx = Math.sin(a), my = Math.cos(a), mz = 0;
    let e1x = my, e1y = -mx, e1z = 0;
    let n1 = Math.hypot(e1x, e1y, e1z);
    if (n1 < 1e-4) { e1x = 1; e1y = 0; e1z = 0; n1 = 1; }
    e1x /= n1; e1y /= n1; e1z /= n1;
    const e2x = my * e1z - mz * e1y;
    const e2y = mz * e1x - mx * e1z;
    const e2z = mx * e1y - my * e1x;

    const bri = clamp((Math.log10(P.Bgauss) - 8) / 7, 0, 1);
    const base = 0.20 + 0.72 * bri;

    let vi = 0, ci = 0;
    for (let s = 0; s < SHELLS.length; s++) {
      const L = SHELLS[s];
      const th0 = Math.asin(Math.min(1, Math.sqrt(1 / L)));
      for (let az = 0; az < AZIM; az++) {
        const phi = (az / AZIM) * Math.PI * 2 + (s * 0.13);
        const cphi = Math.cos(phi), sphi = Math.sin(phi);
        let prev = null;
        for (let k = 0; k <= SEG; k++) {
          const th = th0 + (Math.PI - 2 * th0) * (k / SEG);
          const r = L * Math.sin(th) * Math.sin(th);
          const ct = Math.cos(th), stt = Math.sin(th);
          const dx = ct * mx + stt * (cphi * e1x + sphi * e2x);
          const dy = ct * my + stt * (cphi * e1y + sphi * e2y);
          const dz = ct * mz + stt * (cphi * e1z + sphi * e2z);
          const px = dx * r, py = dy * r, pz = dz * r;
          if (prev) {
            for (let q = 0; q < 2; q++) {
              const p = q === 0 ? prev : [px, py, pz];
              lineLocal[vi] = p[0]; lineLocal[vi + 1] = p[1]; lineLocal[vi + 2] = p[2];
              vi += 3;
              const rr = Math.hypot(p[0], p[1], p[2]);
              const fade = clamp((rr - 1.02) / 0.22, 0, 1);
              const k2 = base * fade;
              lineRgb[ci] = 0.18 * k2;
              lineRgb[ci + 1] = 0.54 * k2;
              lineRgb[ci + 2] = k2;
              ci += 3;
            }
          }
          prev = [px, py, pz];
        }
      }
    }
    lineVertCount = vi / 3;
    if (!lineBuf) lineBuf = GL.dynamic(gl, LINE_VERTS * 6);
  }

  /* -------------------------------------------------------------- частицы -- */
  const MAX_PARTICLES = 420;
  const parts = [];
  let partCount = 0;
  const sprData = new Float32Array(MAX_PARTICLES * 8);

  function initParticles() {
    parts.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      parts.push({
        r: 1.28 + Math.pow(Math.random(), 1.5) * 2.9,
        ang: Math.random() * Math.PI * 2,
        h: (Math.random() - 0.5) * 1.5,
        spd: 0.35 + Math.random() * 0.9,
        size: 0.018 + Math.random() * 0.05,
        br: 0.35 + Math.random() * 0.65,
        ph: Math.random() * 6.28
      });
    }
    if (!sprBuf) sprBuf = GL.dynamic(gl, MAX_PARTICLES * 8);
    updatePartCount();
  }

  function updatePartCount() {
    partCount = Math.round(MAX_PARTICLES * P.particles);
  }

  function updateParticles(dt) {
    if (partCount <= 0) return;
    const a = P.alpha;
    const mx = Math.sin(a), my = Math.cos(a), mz = 0;
    let e1x = my, e1y = -mx, e1z = 0;
    const n1 = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= n1; e1y /= n1; e1z /= n1;
    const e2x = my * e1z - mz * e1y;
    const e2y = mz * e1x - mx * e1z;
    const e2z = mx * e1y - my * e1x;

    const c = Math.cos(st.phase), s = Math.sin(st.phase);
    const w = 0.55 + 2 * Math.PI * M.visualHz(P.nu) * 0.30;
    const dim = 1 - st.collapse;

    for (let i = 0; i < partCount; i++) {
      const p = parts[i];
      p.ang += p.spd * dt * w;
      const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
      const hgt = p.h + 0.10 * Math.sin(st.t * 0.9 + p.ph);
      const lx = (ca * e1x + sa * e2x) * p.r + mx * hgt;
      const ly = (ca * e1y + sa * e2y) * p.r + my * hgt;
      const lz = (ca * e1z + sa * e2z) * p.r + mz * hgt;
      const wx = lx * c + lz * s;
      const wy = ly;
      const wz = -lx * s + lz * c;

      const o = i * 8;
      sprData[o] = wx; sprData[o + 1] = wy; sprData[o + 2] = wz;
      const tw = (0.55 + 0.45 * Math.sin(st.t * 2.0 + p.ph)) * dim;
      sprData[o + 3] = 0.55 * p.br * tw;
      sprData[o + 4] = 0.82 * p.br * tw;
      sprData[o + 5] = 1.0 * p.br * tw;
      sprData[o + 6] = 1.0;
      sprData[o + 7] = p.size;
    }
  }

  /* ------------------------------------------------------------- осколки --- */
  const MAX_DEBRIS = 340;
  const debrisData = new Float32Array(MAX_DEBRIS * 8);
  const debris = [];
  for (let i = 0; i < MAX_DEBRIS; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    debris.push({
      dx: rr * Math.cos(th),
      dy: u * 0.62,
      dz: rr * Math.sin(th),
      spd: 0.45 + Math.random() * 1.1,
      size: 0.03 + Math.random() * 0.09,
      ph: Math.random() * 6.28
    });
  }
  let debrisN = 0;

  function updateDebris() {
    if (!st.boom.active && st.boom.intensity <= 0.01) { debrisN = 0; return; }
    const age = st.boom.age;
    debrisN = Math.round(MAX_DEBRIS * clamp(1 - age * 0.35, 0, 1));
    for (let i = 0; i < debrisN; i++) {
      const p = debris[i];
      const r = 1.15 + Math.pow(age, 0.7) * 13.5 * p.spd;
      const o = i * 8;
      debrisData[o] = p.dx * r;
      debrisData[o + 1] = p.dy * r;
      debrisData[o + 2] = p.dz * r;
      const fade = clamp(1 - age * 1.1, 0, 1);
      const hot = clamp(1 - age * 0.9, 0, 1);
      debrisData[o + 3] = (1.0 * hot + 0.9 * (1 - hot)) * fade;
      debrisData[o + 4] = (0.75 * hot + 0.30 * (1 - hot)) * fade;
      debrisData[o + 5] = (0.45 * hot + 0.10 * (1 - hot)) * fade;
      debrisData[o + 6] = 1.0;
      debrisData[o + 7] = p.size * (1 - age * 0.5);
    }
  }

  /* -------------------------------------------------------------- фон/цвет */
  let accent = '#6fb0ff';
  let accent2 = '#a97bff';
  const tintCol = [0.28, 0.24, 0.62];

  function setAccent(a1, a2) {
    accent = a1;
    accent2 = a2;
    document.documentElement.style.setProperty('--accent', a1);
    document.documentElement.style.setProperty('--accent-2', a2);
    drawPulseStatic();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------------------------------------------------------------- камера */
  function updateCamera(dt) {
    if (!st.dragging && P.autoRotate) cam.yaw += 0.055 * dt;
    cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 9);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const fit = clamp(1.02 / aspect, 1, 2.4);
    const dist = cam.dist * fit;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    eye[0] = dist * cp * Math.sin(cam.yaw);
    eye[1] = dist * sp;
    eye[2] = dist * cp * Math.cos(cam.yaw);

    const inv = 1 / Math.hypot(eye[0], eye[1], eye[2]);
    fwd[0] = -eye[0] * inv; fwd[1] = -eye[1] * inv; fwd[2] = -eye[2] * inv;

    let rx = -fwd[2], ry = 0, rz = fwd[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    right[0] = rx; right[1] = ry; right[2] = rz;

    up[0] = ry * fwd[2] - rz * fwd[1];
    up[1] = rz * fwd[0] - rx * fwd[2];
    up[2] = rx * fwd[1] - ry * fwd[0];
  }

  /* ------------------------------------------------------------- отрисовка */
  function setCommon(p, w, h) {
    gl.uniform2f(p.u('uRes'), w, h);
    gl.uniform1f(p.u('uTan'), uTan);
    gl.uniform3f(p.u('uEye'), eye[0], eye[1], eye[2]);
    gl.uniform3f(p.u('uFwd'), fwd[0], fwd[1], fwd[2]);
    gl.uniform3f(p.u('uRight'), right[0], right[1], right[2]);
    gl.uniform3f(p.u('uUp'), up[0], up[1], up[2]);
  }

  function drawFullscreen(p) {
    const a = p.a('aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(a);
  }

  function ensureTargets() {
    const w = canvas.width, h = canvas.height;
    if (sceneRT && sceneRT.w === w && sceneRT.h === h) return;
    GL.freeRT(gl, sceneRT); GL.freeRT(gl, bloomA); GL.freeRT(gl, bloomB); GL.freeRT(gl, blurTmp);
    sceneRT = GL.makeRT(gl, w, h);
    bloomA = GL.makeRT(gl, Math.max(2, w >> 1), Math.max(2, h >> 1));
    blurTmp = GL.makeRT(gl, Math.max(2, w >> 2), Math.max(2, h >> 2));
    bloomB = GL.makeRT(gl, Math.max(2, w >> 2), Math.max(2, h >> 2));
  }

  function pass(prog, target, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    prog.use();
    setup(prog);
    drawFullscreen(prog);
  }

  function bindTex(unit, tex, prog, name) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u(name), unit);
  }

  function render() {
    ensureTargets();
    const w = canvas.width, h = canvas.height;

    const bri = clamp((Math.log10(P.Bgauss) - 8) / 7, 0, 1);
    const vOmega = 2 * Math.PI * M.visualHz(P.nu);
    const acc = M.diskLevel(P.mdot);
    const bh = st.collapse;
    const dim = 1 - bh;

    const c = Math.cos(st.phase), s = Math.sin(st.phase);
    spinM[0] = c; spinM[1] = 0; spinM[2] = -s;
    spinM[3] = 0; spinM[4] = 1; spinM[5] = 0;
    spinM[6] = s; spinM[7] = 0; spinM[8] = c;
    spinInvM[0] = c; spinInvM[1] = 0; spinInvM[2] = s;
    spinInvM[3] = 0; spinInvM[4] = 1; spinInvM[5] = 0;
    spinInvM[6] = -s; spinInvM[7] = 0; spinInvM[8] = c;

    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.008, 0.012, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    /* ---- 1. фон ---- */
    const pbg = progs.bg;
    pbg.use();
    setCommon(pbg, w, h);
    bindTex(0, skyTex, pbg, 'uSky');
    gl.uniform1f(pbg.u('uTime'), st.t);
    gl.uniform3f(pbg.u('uTint'), tintCol[0], tintCol[1], tintCol[2]);
    gl.uniform1f(pbg.u('uTintAmt'), 1.0);
    drawFullscreen(pbg);

    /* ---- 2. звезда (с альфа-сглаживанием края) ---- */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const ps = progs.sphere;
    ps.use();
    setCommon(ps, w, h);
    gl.uniformMatrix3fv(ps.u('uSpinInv'), false, spinInvM);
    gl.uniform1f(ps.u('uAlpha'), P.alpha);
    gl.uniform1f(ps.u('uTemp'), D.uTemp);
    gl.uniform1f(ps.u('uSpot'), 0.26 + 0.62 * bri + 0.4 * acc);
    gl.uniform1f(ps.u('uSpotSharp'), 26 + 80 * (1 - bri));
    gl.uniform1f(ps.u('uRim'), (0.22 + 0.70 * bri + 0.25 * acc) * dim);
    gl.uniform1f(ps.u('uBeta'), Math.min(0.16, vOmega * 0.05));
    gl.uniform1f(ps.u('uDetail'), P.quality === 'low' ? 0.0 : 1.0);
    gl.uniform1f(ps.u('uTime'), st.t);
    gl.uniform1f(ps.u('uAccretion'), acc);
    gl.uniform1f(ps.u('uBH'), bh);
    drawFullscreen(ps);

    /* ---- 3. объём ---- */
    gl.blendFunc(gl.ONE, gl.ONE);
    const pv = progs.volume;
    pv.use();
    setCommon(pv, w, h);
    gl.uniformMatrix3fv(pv.u('uSpin'), false, spinM);
    gl.uniform1f(pv.u('uAlpha'), P.alpha);
    gl.uniform1f(pv.u('uTime'), st.t);
    gl.uniform1f(pv.u('uGlow'), P.glow * dim);
    gl.uniform1f(pv.u('uBeam'), P.showBeam ? (0.55 + 1.05 * bri) * dim : 0);
    gl.uniform1f(pv.u('uBeamWidth'), 0.030 + 0.030 * (1 - bri));
    gl.uniform1f(pv.u('uDisk'), P.showDisk ? acc : 0);
    gl.uniform1f(pv.u('uDiskIn'), 1.50);
    gl.uniform1f(pv.u('uDiskOut'), 4.2);
    gl.uniform1f(pv.u('uFlare'), st.flare);
    gl.uniform1f(pv.u('uJet'), P.showJets ? 0.55 + 0.45 * acc : 0);
    gl.uniform1f(pv.u('uBoom'), st.boom.intensity);
    gl.uniform1f(pv.u('uBoomR'), st.boom.shellR);
    gl.uniform1f(pv.u('uBoomAge'), st.boom.age);
    gl.uniform1f(pv.u('uFlash'), st.flash * 0.45);
    gl.uniform3f(pv.u('uBeamColor'), 0.62, 0.82, 1.0);
    gl.uniform3f(pv.u('uCoronaColor'),
      0.30 + 0.36 * acc + 0.30 * st.boom.age,
      0.52 + 0.04 * acc - 0.10 * st.boom.age,
      1.0 - 0.56 * acc - 0.40 * st.boom.age);
    drawFullscreen(pv);

    /* ---- 4. силовые линии ---- */
    if (P.showField && lineVertCount > 0 && dim > 0.02) {
      const pl = progs.line;
      pl.use();
      setCommon(pl, w, h);

      const ex = eye[0], ey = eye[1], ez = eye[2];
      const e2c = ex * ex + ey * ey + ez * ez - 1;
      let o = 0;
      for (let v = 0; v < lineVertCount; v++) {
        const li = v * 3;
        const lx = lineLocal[li], ly = lineLocal[li + 1], lz = lineLocal[li + 2];
        const wx = lx * c + lz * s;
        const wy = ly;
        const wz = -lx * s + lz * c;
        const dx = wx - ex, dy = wy - ey, dz = wz - ez;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let vis = dim;
        if (dist > 0.01) {
          const idx = dx / dist, idy = dy / dist, idz = dz / dist;
          const b = ex * idx + ey * idy + ez * idz;
          const disc = b * b - e2c;
          if (disc > 0) {
            const th = -b - Math.sqrt(disc);
            if (th > 0 && dist > th) vis = 0;
          }
        }
        lineData[o] = wx;
        lineData[o + 1] = wy;
        lineData[o + 2] = wz;
        lineData[o + 3] = lineRgb[li] * vis;
        lineData[o + 4] = lineRgb[li + 1] * vis;
        lineData[o + 5] = lineRgb[li + 2] * vis;
        o += 6;
      }

      const aPos = pl.a('aPos'), aCol = pl.a('aCol');
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.LINES, 0, lineVertCount);
      gl.disableVertexAttribArray(aPos);
      gl.disableVertexAttribArray(aCol);
    }

    /* ---- 5. частицы и осколки ---- */
    const pr = progs.spr;
    const drawSprites = (data, count) => {
      if (count <= 0) return;
      pr.use();
      setCommon(pr, w, h);
      const aPos = pr.a('aPos'), aCol = pr.a('aCol'), aSize = pr.a('aSize');
      gl.bindBuffer(gl.ARRAY_BUFFER, sprBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 8));
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(aSize);
      gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 32, 28);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disableVertexAttribArray(aPos);
      gl.disableVertexAttribArray(aCol);
      gl.disableVertexAttribArray(aSize);
    };
    drawSprites(sprData, partCount);
    drawSprites(debrisData, debrisN);

    /* ---- 6. постобработка: bloom ---- */
    gl.disable(gl.BLEND);
    const pb = progs.bright;
    pass(pb, bloomA, (p) => {
      bindTex(0, sceneRT.tex, p, 'uTex');
      gl.uniform1f(p.u('uThreshold'), 0.80);
      gl.uniform1f(p.u('uKnee'), 0.25);
    });

    const pbl = progs.blur;
    const d1 = 1.5 / bloomA.w;
    pass(pbl, blurTmp, (p) => {
      bindTex(0, bloomA.tex, p, 'uTex');
      gl.uniform2f(p.u('uDir'), d1, 0);
    });
    const d1v = 1.5 / bloomA.h;
    pass(pbl, bloomA, (p) => {
      bindTex(0, blurTmp.tex, p, 'uTex');
      gl.uniform2f(p.u('uDir'), 0, d1v);
    });
    const d2 = 2.6 / bloomA.w;
    pass(pbl, blurTmp, (p) => {
      bindTex(0, bloomA.tex, p, 'uTex');
      gl.uniform2f(p.u('uDir'), d2, 0);
    });
    const d2v = 2.6 / bloomB.h;
    pass(pbl, bloomB, (p) => {
      bindTex(0, blurTmp.tex, p, 'uTex');
      gl.uniform2f(p.u('uDir'), 0, d2v);
    });

    /* ---- 7. композит на экран ---- */
    const pc = progs.composite;
    pass(pc, null, (p) => {
      bindTex(0, sceneRT.tex, p, 'uScene');
      bindTex(1, bloomA.tex, p, 'uB1');
      bindTex(2, bloomB.tex, p, 'uB2');
      gl.uniform1f(p.u('uBloom'), P.bloom);
      gl.uniform1f(p.u('uFlash'), st.flash * 0.55);
      gl.uniform1f(p.u('uExposure'), 1.0);
    });

    if (st.wantShot) {
      st.wantShot = false;
      try {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'нейтронная-звезда.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------------ HUD -- */
  const HUD_SPEC = [
    { k: 'Частота \u03bd', v: () => F.num(P.nu, P.nu < 10 ? 2 : 1) + ' Гц' },
    { k: 'Период P', v: () => F.period(P.nu) },
    { k: 'Торможение \u1e56', v: () => F.sci(D.Pdot, 2) + ' с/с' },
    { k: 'Возраст \u03c4', v: () => F.age(D.tau) },
    { k: 'Поле B', v: () => F.sci(P.Bgauss, 1) + ' Гс' },
    { k: 'Потери L', v: () => F.power(D.Lsd) },
    { k: 'Режим', v: () => D.regime, wide: false },
    { k: 'Радиус магнитосферы', v: () => (isFinite(D.RmKm) ? F.distance(D.RmKm) : '\u2014') },
    { k: 'Аккреция L', v: () => (D.Lacc > 0 ? F.power(D.Lacc) : '\u2014') },
    { k: 'Эддингтон', v: () => (D.Lacc > 0 ? F.num(D.eddFrac, 3) : '\u2014') },
    {
      k: 'Масса / радиус', wide: true, warn: () => !D.stable,
      v: () => F.num(P.mass, 2) + ' M\u2609 \u00b7 ' + F.num(P.radiusKm, 1) + ' км'
    },
    { k: 'Красное смещение', v: () => F.num(D.zGrav, 3) },
    { k: 'Экватор v/c', v: () => F.num(D.betaEq, 3) },
    { k: 'Световой цилиндр', v: () => F.distance(D.RlcKm) },
    { k: 'FPS \u00b7 замедление', v: () => Math.round(st.fps) + ' \u00b7 \u00d7' + F.sci(P.nu / M.visualHz(P.nu), 1) }
  ];
  const hudRefs = [];

  function buildHud() {
    hudRowsEl.innerHTML = '';
    HUD_SPEC.forEach((row) => {
      const d = document.createElement('div');
      d.className = 'stat' + (row.wide ? ' wide' : '');
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = row.k;
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = '\u2014';
      d.appendChild(k);
      d.appendChild(v);
      hudRowsEl.appendChild(d);
      hudRefs.push({ el: v, row: row });
    });
  }

  function updateHud() {
    for (let i = 0; i < HUD_SPEC.length; i++) {
      const ref = hudRefs[i];
      const txt = HUD_SPEC[i].v();
      if (ref.el.textContent !== txt) ref.el.textContent = txt;
      if (HUD_SPEC[i].warn) {
        const bad = HUD_SPEC[i].warn();
        if (ref.el.classList.contains('bad') !== bad) ref.el.classList.toggle('bad', bad);
      }
    }
    const type = st.collapse > 0.5 ? 'Чёрная дыра' : M.classify(P, D);
    if (badgeTypeEl.textContent !== type) badgeTypeEl.textContent = type;
    let info;
    if (st.boom.active || st.boom.intensity > 0.02) {
      info = 'сверхновая \u00b7 E ' + F.sci(P.boomEnergy, 1) + ' эрг \u00b7 v ' +
        F.num(st.boom.v / 2.99792458e8, 3) + ' c';
    } else {
      info = '\u03bd ' + F.num(P.nu, 1) + ' Гц \u00b7 B ' + F.sci(P.Bgauss, 1) + ' Гс' +
        (P.mdot > 0 ? ' \u00b7 ' + D.regime : '');
    }
    if (badgeInfoEl.textContent !== info) badgeInfoEl.textContent = info;
    const sTxt = P.paused ? '\u25cf пауза' : '\u25cf идёт';
    if (statusEl.textContent !== sTxt) {
      statusEl.textContent = sTxt;
      statusEl.classList.toggle('paused', !!P.paused);
    }
    pulseRateEl.textContent = '\u03bd\u0432\u0438\u0437 ' + F.num(M.visualHz(P.nu), 2) + ' Гц';
  }

  /* --------------------------------------------------------- профиль импульса */
  const pulseCurve = new Float32Array(160);

  function computePulseCurve() {
    const N = pulseCurve.length;
    const sa = Math.sin(P.alpha), ca = Math.cos(P.alpha);
    const L = Math.hypot(eye[0], eye[1], eye[2]) || 1;
    const ox = eye[0] / L, oy = eye[1] / L, oz = eye[2] / L;
    const sharp = 2.5 + 6.5 * clamp((Math.log10(P.Bgauss) - 8) / 7, 0, 1);
    let max = 1e-6;
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * Math.PI * 2;
      const cph = Math.cos(ph), sph = Math.sin(ph);
      const mx = sa * cph, my = ca, mz = -sa * sph;
      const d1 = mx * ox + my * oy + mz * oz;
      const f = Math.pow(Math.max(0, d1), sharp) +
        0.55 * Math.pow(Math.max(0, -d1), sharp);
      pulseCurve[i] = f;
      if (f > max) max = f;
    }
    for (let i = 0; i < N; i++) pulseCurve[i] /= max;
  }

  function drawPulseStatic() {
    const W = PW, H = PH;
    const ctx = pulseCtx;
    ctx.setTransform(PDPR, 0, 0, PDPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(150,185,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round((i / 4) * W) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 14); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(150,185,255,0.16)';
    ctx.beginPath(); ctx.moveTo(0, H - 14.5); ctx.lineTo(W, H - 14.5); ctx.stroke();

    const grad = ctx.createLinearGradient(0, 0, 0, H - 14);
    grad.addColorStop(0, hexA(accent, 0.55));
    grad.addColorStop(1, hexA(accent, 0.02));
    ctx.beginPath();
    ctx.moveTo(0, H - 14);
    for (let i = 0; i < pulseCurve.length; i++) {
      const x = (i / (pulseCurve.length - 1)) * W;
      const y = (H - 14) - pulseCurve[i] * (H - 24);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H - 14);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < pulseCurve.length; i++) {
      const x = (i / (pulseCurve.length - 1)) * W;
      const y = (H - 14) - pulseCurve[i] * (H - 24);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = 'rgba(130,148,174,0.85)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('0', 2, H - 3);
    ctx.fillText('фаза', W / 2 - 12, H - 3);
    ctx.fillText('1', W - 8, H - 3);
  }

  function drawPulseMarker() {
    drawPulseStatic();
    const W = PW, H = PH;
    const ctx = pulseCtx;
    const p = ((st.phase / (Math.PI * 2)) % 1 + 1) % 1;
    const x = p * W;
    ctx.strokeStyle = hexA('#ffffff', 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 14); ctx.stroke();

    const idx = Math.min(pulseCurve.length - 1, Math.round(p * (pulseCurve.length - 1)));
    const y = (H - 14) - pulseCurve[idx] * (H - 24);
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = hexA(accent, 0.35);
    ctx.fill();
  }

  /* -------------------------------------------------------------- эволюция */
  function evolve(dt) {
    if (!(P.autoEvo > 0)) return;
    const dYr = P.autoEvo * dt * P.timeScale;
    if (!(dYr > 0)) return;
    const om = D.omega;
    let dOm = D.omegaDot * dYr * 3.15576e7;
    if (P.mdot > 0) dOm += D.omegaUp * dYr * 3.15576e7;
    const lim = om * 0.03;
    if (dOm > lim) dOm = lim;
    if (dOm < -lim) dOm = -lim;
    let om2 = Math.max(2 * Math.PI * 0.02, om + dOm);
    om2 = Math.min(D.omegaMax * 0.985, om2);
    P.nu = om2 / (Math.PI * 2);

    if (P.Bgauss > 1e13) P.Bgauss *= Math.exp(-dYr / 4e5);
    if (P.Bgauss < 1e8) P.Bgauss = 1e8;

    D = Physics(P);
    if (performance.now() - st.syncT > 180) {
      st.syncT = performance.now();
      ui.syncKeys(['nu', 'Bgauss'], P);
    }
  }

  /* ------------------------------------------------------------ взрыв ----- */
  function explode() {
    const E = P.boomEnergy * 1e-7;                 // эрг -> Дж
    const Mej = Math.max(1e-4, P.boomMass) * MSUN;
    const v = Math.sqrt(2 * E / Mej);
    st.boom.active = true;
    st.boom.t = 0;
    st.boom.age = 0;
    st.boom.intensity = 1.0;
    st.boom.shellR = 1.15;
    st.boom.v = v;
    st.flash = 1.1;
    st.collapse = 0;
    sound.boom();
    if (P.mdot > 0) { /* аккреция сметена */ }
    ui.clearPreset();
  }

  function updateBoom(dt) {
    const b = st.boom;
    if (!b.active) return;
    b.t += dt;
    const u = Math.min(1, b.t / b.dur);
    b.age = u;
    b.shellR = 1.15 + 7.6 * Math.pow(u, 0.45);
    const attack = u < 0.04 ? u / 0.04 : 1;
    b.intensity = attack * Math.pow(1 - u, 1.6);
    if (P.collapse) {
      st.collapse = clamp((b.t - 1.6) / 2.2, 0, 1);
    }
    if (u >= 1) {
      b.active = false;
      b.intensity = 0;
    }
  }

  /* -------------------------------------------------------------- отклик UI */
  let ui = null;

  function applyPreset(id) {
    const pr = PRESETS[id];
    if (!pr) return;
    P.nu = pr.nu;
    P.alpha = pr.alpha;
    P.Bgauss = pr.Bgauss;
    P.mass = pr.mass;
    P.radiusKm = pr.radiusKm;
    P.tempMK = pr.tempMK;
    P.mdot = pr.mdot;
    P.preset = id;
    setAccent(pr.accent, pr.accent2);
    tintCol[0] = pr.tint[0]; tintCol[1] = pr.tint[1]; tintCol[2] = pr.tint[2];
    refresh(true);
    ui.setPreset(id);
    if (id === 'sn') explode();
  }

  function setParam(key, value) {
    if (P[key] === value) return;
    P[key] = value;
    if (key === 'preset') return;
    ui.clearPreset();
    refresh(false, key);
  }

  function refresh(full, key) {
    D = Physics(P);
    buildField();
    updatePartCount();

    if (key === 'quality' || full) resize();

    if (key === 'sound' || full) sound.setEnabled(P.sound);
    if (key === 'volume' || full) sound.setVolume(P.volume);
    if (key === 'rhythm' || full) sound.setRhythm(P.rhythm);
    if (key === 'ambience' || key === 'pulseGain' || key === 'reverb' || full) {
      sound.setMix({ ambience: P.ambience, pulse: P.pulseGain, reverb: P.reverb, fx: 0.9 });
    }
    sound.setSpin(M.visualHz(P.nu), P.nu);
    sound.setAccretion(M.diskLevel(P.mdot));
    sound.setMagnetar(clamp((Math.log10(P.Bgauss) - 12) / 2.5, 0, 1));

    computePulseCurve();
    drawPulseStatic();
    updateHud();

    if (full && ui) ui.refresh(P);
  }

  /* ----------------------------------------------------------------- разметка */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = P.quality === 'low' ? 0.72
      : P.quality === 'high' ? Math.min(dpr, 2)
        : Math.min(dpr, 1.5);
    const maxPixels = P.quality === 'high' ? 4.2e6
      : P.quality === 'med' ? 3.2e6
        : P.quality === 'low' ? 1.6e6 : 2.6e6;
    let scale = base * st.perfScale;
    let w = window.innerWidth * scale;
    let h = window.innerHeight * scale;
    const over = Math.sqrt((w * h) / maxPixels);
    if (over > 1) { w /= over; h /= over; }
    const W = Math.max(320, Math.round(w));
    const H = Math.max(240, Math.round(h));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
  }

  function adaptQuality(now) {
    if (P.quality !== 'auto') return;
    if (now - st.lastAdapt < 1400) return;
    st.lastAdapt = now;
    if (st.fps < 42 && st.perfScale > 0.62) {
      st.perfScale = Math.max(0.62, st.perfScale - 0.12);
      resize();
    } else if (st.fps > 56 && st.perfScale < 1) {
      st.perfScale = Math.min(1, st.perfScale + 0.06);
      resize();
    }
  }

  /* ------------------------------------------------------------------ цикл -- */
  function frame(now) {
    st.raf = requestAnimationFrame(frame);
    if (st.hidden) return;

    let dt = (now - st.last) / 1000;
    st.last = now;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.08);

    st.frames++;
    if (now - st.fpsT > 500) {
      st.fps = st.frames * 1000 / (now - st.fpsT);
      st.frames = 0;
      st.fpsT = now;
      adaptQuality(now);
    }

    const adt = dt * P.timeScale;

    if (!P.paused) {
      st.t += adt;
      st.phase += 2 * Math.PI * M.visualHz(P.nu) * adt;
      if (st.phase > Math.PI * 2) st.phase -= Math.PI * 2;
      updateParticles(adt);
      evolve(dt);
      updateBoom(adt);
      updateDebris();
      if (P.Bgauss >= 8e13 && Math.random() < adt * 0.05) doFlare(true);
    }

    st.flare *= Math.exp(-dt * 2.0);
    if (st.flare < 0.002) st.flare = 0;
    st.flash *= Math.exp(-dt * 6.2);
    if (st.flash < 0.002) st.flash = 0;

    updateCamera(dt);
    render();

    if (now - st.hudT > 160) {
      st.hudT = now;
      updateHud();
    }
    if (now - st.pulseT > 90) {
      st.pulseT = now;
      if (now - st.pulseCalcT > 340) {
        st.pulseCalcT = now;
        computePulseCurve();
      }
      drawPulseMarker();
    }
    if (now - st.sndT > 250) {
      st.sndT = now;
      sound.setSpin(M.visualHz(P.nu), P.nu);
    }
  }

  function doFlare(random) {
    st.flare = random ? 0.7 + Math.random() * 0.5 : 1.2;
    if (!random) st.flash = Math.max(st.flash, 0.35);
    sound.flare();
  }

  /* ------------------------------------------------------------- управление */
  function togglePanel() {
    document.body.classList.toggle('panel-hidden');
    fadeHint(true);
  }

  function fadeHint() {
    hintEl.classList.add('gone');
  }

  let lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    st.dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    document.body.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    fadeHint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!st.dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    cam.yaw -= dx * 0.0055;
    cam.pitch = clamp(cam.pitch + dy * 0.0045, -1.30, 1.30);
  });
  function endDrag() {
    st.dragging = false;
    document.body.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.targetDist = clamp(cam.targetDist * Math.exp(e.deltaY * 0.0011), 2.2, 13);
    fadeHint();
  }, { passive: false });

  canvas.addEventListener('dblclick', resetView);

  function resetView() {
    cam.yaw = 0.62;
    cam.pitch = 0.30;
    cam.targetDist = 5.4;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  document.addEventListener('visibilitychange', () => {
    st.hidden = document.hidden;
    sound.setHidden(document.hidden);
    if (!document.hidden) {
      st.last = performance.now();
      st.fpsT = performance.now();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'h' || k === 'р') togglePanel();
    else if (k === 'm' || k === 'ь') { P.sound = !P.sound; refresh(false, 'sound'); ui.refresh(P); }
    else if (k === 'r' || k === 'к') resetAll();
    else if (k === 'e' || k === 'у') explode();
    else if (k === '1') applyPreset('pulsar');
    else if (k === '2') applyPreset('magnetar');
    else if (k === '3') applyPreset('ms');
    else if (k === '4') applyPreset('binary');
    else if (k === '5') applyPreset('young');
    else if (k === '6') applyPreset('sn');
  });

  function togglePause() {
    P.paused = !P.paused;
    btnPause.classList.toggle('on', !!P.paused);
    btnPause.textContent = P.paused ? 'Продолжить' : 'Пауза';
    sound.setPaused(!!P.paused);
    updateHud();
  }

  function resetAll() {
    Object.keys(DEFAULTS).forEach((k) => { P[k] = DEFAULTS[k]; });
    P.paused = false;
    btnPause.classList.remove('on');
    btnPause.textContent = 'Пауза';
    sound.setPaused(false);
    st.perfScale = 1;
    st.phase = 0;
    st.collapse = 0;
    st.boom.active = false;
    st.boom.intensity = 0;
    st.flash = 0;
    resetView();
    applyPreset('pulsar');
  }

  /* ---------------------------------------------------------------- запуск -- */
  function act(id, arg) {
    if (id === 'preset') applyPreset(arg);
    else if (id === 'flare') doFlare(false);
    else if (id === 'boom') explode();
    else if (id === 'view') resetView();
    else if (id === 'pause') togglePause();
    else if (id === 'shot') st.wantShot = true;
    else if (id === 'reset') resetAll();
  }

  buildHud();
  initParticles();

  ui = UI.create({
    root: controlsEl,
    get: (k) => P[k],
    set: (k, v) => {
      if (k === 'sound') {
        P.sound = v;
        sound.setEnabled(v);
        if (v) sound.setVolume(P.volume);
        refresh(false, 'sound');
        return;
      }
      setParam(k, v);
    },
    act: act
  });

  document.getElementById('btnPause').addEventListener('click', togglePause);
  document.getElementById('btnBoom').addEventListener('click', explode);
  document.getElementById('btnShot').addEventListener('click', () => { st.wantShot = true; });
  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('btnCollapse').addEventListener('click', togglePanel);
  document.getElementById('fab').addEventListener('click', togglePanel);

  document.addEventListener('pointerdown', () => {
    if (P.sound && sound.enabled && sound.ctx && sound.ctx.state === 'suspended') {
      sound.ctx.resume();
    }
  }, { once: true });

  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
    document.body.classList.add('panel-hidden');
  }

  resize();
  setAccent('#6fb0ff', '#a97bff');
  refresh(true);
  ui.setPreset('pulsar');
  computePulseCurve();
  drawPulseStatic();

  st.last = performance.now();
  st.fpsT = performance.now();
  st.raf = requestAnimationFrame(frame);

  setTimeout(() => fadeHint(), 9000);

  window.NS_APP = {
    P: P, cam: cam, st: st, D: () => D,
    progs: () => progs, sound: sound, ui: () => ui, boom: explode
  };
})(window.NS = window.NS || {});
