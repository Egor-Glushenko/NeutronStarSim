/* =========================================================================
   Небольшая обвязка над WebGL: контекст, программы, буферы, звёздный фон
   ========================================================================= */
(function (NS) {
  'use strict';

  function compile(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || '(нет лога)';
      gl.deleteShader(sh);
      const e = new Error('Шейдер ' + name + ': ' + log);
      e.glslLog = log;
      e.glslSrc = src;
      e.glslName = name;
      throw e;
    }
    return sh;
  }

  function link(gl, vsSrc, fsSrc, name) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + '/vertex');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + '/fragment');
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) || '(нет лога)';
      gl.deleteProgram(p);
      const e = new Error('Линковка программы ' + name + ': ' + log);
      e.glslName = name;
      throw e;
    }

    const uCache = Object.create(null);
    const aCache = Object.create(null);
    return {
      name: name,
      prog: p,
      use: function () { gl.useProgram(p); return this; },
      u: function (n) {
        let v = uCache[n];
        if (v === undefined) { v = gl.getUniformLocation(p, n); uCache[n] = v; }
        return v;
      },
      a: function (n) {
        let v = aCache[n];
        if (v === undefined) { v = gl.getAttribLocation(p, n); aCache[n] = v; }
        return v;
      }
    };
  }

  /* Компиляция с запасным вариантом mediump (старые мобильные GPU) */
  function program(gl, vsSrc, fsSrc, name) {
    try {
      return link(gl, vsSrc, fsSrc, name);
    } catch (e) {
      if (e.glslName) {
        // если это не ошибка препроцессора точности — не маскируем её
        const retryVs = vsSrc.replace(/highp/g, 'mediump');
        const retryFs = fsSrc.replace(/highp/g, 'mediump');
        if (retryVs !== vsSrc || retryFs !== fsSrc) {
          return link(gl, retryVs, retryFs, name + '(mediump)');
        }
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------------ фон -- */

  function makeSkyCanvas() {
    const W = 1024, H = 512;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');

    c.fillStyle = '#03040a';
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';

    const blobs = [
      [0.10, 0.28, 0.26, 'rgba(58,40,140,0.50)'],
      [0.22, 0.62, 0.20, 'rgba(18,68,140,0.38)'],
      [0.42, 0.20, 0.30, 'rgba(118,32,110,0.28)'],
      [0.58, 0.72, 0.24, 'rgba(18,88,120,0.30)'],
      [0.72, 0.34, 0.30, 'rgba(48,30,120,0.42)'],
      [0.88, 0.58, 0.22, 'rgba(28,58,140,0.32)'],
      [0.97, 0.18, 0.20, 'rgba(88,40,130,0.26)']
    ];
    for (let i = 0; i < blobs.length; i++) {
      const u = blobs[i][0], v = blobs[i][1], r = blobs[i][2] * W, col = blobs[i][3];
      const y = v * H, rr = r;
      for (let dx = -1; dx <= 1; dx++) {
        const x = u * W + dx * W;
        const g = c.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
    }

    /* Млечный Путь — широкая полоса пыли и мелких звёзд */
    const bandY = 0.38 * H;
    for (let i = 0; i < 3400; i++) {
      const x = Math.random() * W;
      const gauss = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const y = bandY + gauss * 0.10 * H;
      const a = 0.03 + Math.random() * 0.16 * (1 - Math.abs(gauss) * 0.8);
      const s = 0.6 + Math.random() * 1.4;
      c.fillStyle = 'rgba(' + (200 + Math.random() * 55 | 0) + ',' +
        (210 + Math.random() * 45 | 0) + ',255,' + a.toFixed(3) + ')';
      c.fillRect(x, y, s, s);
    }

    /* тёмные пылевые прожилки */
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * W;
      const y = bandY + (Math.random() - 0.5) * 0.06 * H;
      const rr = 30 + Math.random() * 90;
      const g = c.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, 'rgba(4,5,12,0.55)');
      g.addColorStop(1, 'rgba(4,5,12,0)');
      c.fillStyle = g;
      c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    return cv;
  }

  function textureFromCanvas(gl, canvas) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  /* Промежуточная цель рендера (текстура + framebuffer) */
  function makeRT(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { tex: tex, fbo: fbo, w: w, h: h };
  }

  function freeRT(gl, rt) {
    if (!rt) return;
    gl.deleteTexture(rt.tex);
    gl.deleteFramebuffer(rt.fbo);
  }

  NS.GL = {
    create: function (canvas) {
      const opts = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        desynchronized: true,
        failIfMajorPerformanceCaveat: false
      };
      let gl = null;
      try { gl = canvas.getContext('webgl2', opts); } catch (e) { gl = null; }
      if (!gl) {
        try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
      }
      return gl;
    },
    program: program,
    makeSkyCanvas: makeSkyCanvas,
    textureFromCanvas: textureFromCanvas,
    makeRT: makeRT,
    freeRT: freeRT,
    quad: function (gl) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
      ]), gl.STATIC_DRAW);
      return buf;
    },
    dynamic: function (gl, floats) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_DRAW);
      return buf;
    }
  };
})(window.NS = window.NS || {});
