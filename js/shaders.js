/* =========================================================================
   Шейдеры (GLSL ES 1.00 — работает и в WebGL1, и в WebGL2)
   ========================================================================= */
(function (NS) {
  'use strict';

  const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  /* ------------------------------------------------------------- общее ---- */
  const COMMON = `
precision highp float;
varying vec2 vUv;

uniform vec2 uRes;
uniform float uTan;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;

vec3 rayDir(vec2 ndc) {
  float a = uRes.x / max(uRes.y, 1.0);
  return normalize(uFwd + ndc.x * a * uTan * uRight + ndc.y * uTan * uUp);
}

/* Пересечение луча со сферой радиуса 1 в начале координат. */
float hitSphere(vec3 o, vec3 d, out float t) {
  t = -1.0;
  float b = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s;
  if (t0 > 0.0) { t = t0; return t0; }
  float t1 = -b + s;
  if (t1 > 0.0) { t = t1; return t1; }
  return -1.0;
}

/* Прицельное расстояние от центра до луча. */
float rayDist(vec3 o, vec3 d) {
  float tc = -dot(o, d);
  return tc > 0.0 ? length(o + d * tc) : length(o);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

float fbm3(vec3 p) {
  float s = 0.0;
  s += 0.5 * vnoise(p);
  s += 0.25 * vnoise(p * 2.03 + 5.1);
  s += 0.125 * vnoise(p * 4.07 + 11.7);
  return s / 0.875;
}

/* Цвет раскалённой поверхности: 0 — холодная кора, 1 — миллионы кельвинов */
vec3 bbColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.26, 0.03, 0.02), vec3(0.98, 0.22, 0.03), smoothstep(0.00, 0.12, t));
  c = mix(c, vec3(1.00, 0.55, 0.15), smoothstep(0.12, 0.24, t));
  c = mix(c, vec3(1.00, 0.80, 0.50), smoothstep(0.24, 0.34, t));
  c = mix(c, vec3(0.99, 0.95, 0.92), smoothstep(0.34, 0.42, t));
  c = mix(c, vec3(0.88, 0.94, 1.00), smoothstep(0.42, 0.50, t));
  c = mix(c, vec3(0.70, 0.84, 1.00), smoothstep(0.50, 0.62, t));
  c = mix(c, vec3(0.54, 0.64, 1.00), smoothstep(0.62, 0.76, t));
  c = mix(c, vec3(0.50, 0.34, 1.00), smoothstep(0.76, 0.90, t));
  c = mix(c, vec3(0.62, 0.42, 1.00), smoothstep(0.90, 1.00, t));
  return c;
}
`;

  /* ------------------------------------------------------------------ ФОН -- */
  const BG_FS = COMMON + `
uniform sampler2D uSky;
uniform float uTime;
uniform vec3 uTint;
uniform float uTintAmt;

void main() {
  vec3 d = rayDir(vUv);
  float lon = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));

  vec2 uv = vec2(lon * 0.15915494 + 0.5, lat * 0.31830989 + 0.5);
  vec3 sky = texture2D(uSky, uv).rgb;

  /* процедурные звёзды — резкие при любом разрешении */
  vec2 sp = vec2(lon * 6.3662, lat * 6.3662);
  vec3 stars = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 1.0 : 2.7;
    vec2 q = sp * sc;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash12(id + float(k) * 37.0);
    if (h > 0.52) {
      vec2 off = (vec2(hash12(id + 11.3), hash12(id + 71.7)) - 0.5) * 0.72;
      float dd = length(f - off);
      float mag = pow(hash12(id + 5.1), 12.0);
      float core = smoothstep(0.045, 0.0, dd);
      float halo = smoothstep(0.30, 0.0, dd) * 0.14;
      float tw = 0.72 + 0.28 * sin(uTime * 1.3 + h * 60.0);
      vec3 tint = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.87, 0.72), hash12(id + 3.3));
      stars += tint * (core * (0.30 + mag * 3.4) + halo * (0.25 + mag)) * tw;
    }
  }
  sky += stars;

  float band = exp(-pow(lat * 2.6, 2.0));
  sky += uTint * band * 0.035 * uTintAmt;

  gl_FragColor = vec4(sky, 1.0);
}`;

  /* -------------------------------------------------------------- СФЕРА --- */
  const SPHERE_FS = COMMON + `
uniform mat3 uSpinInv;
uniform float uAlpha;
uniform float uTemp;
uniform float uSpot;
uniform float uSpotSharp;
uniform float uRim;
uniform float uBeta;
uniform float uDetail;
uniform float uTime;
uniform float uAccretion;
uniform float uBH;

void main() {
  vec3 d = rayDir(vUv);
  float t;
  float hit = hitSphere(uEye, d, t);

  /* сглаживание силуэта без производных: ширина ~1 пиксель */
  float tca = max(-dot(uEye, d), 0.001);
  float perp = length(uEye + d * tca);
  float px = (2.0 * uTan / max(uRes.y, 1.0)) * tca;
  float cov = 1.0 - smoothstep(1.0 - px, 1.0 + px * 0.6, perp);
  if (hit < 0.0 || cov <= 0.002) { gl_FragColor = vec4(0.0); return; }

  vec3 n = normalize(uEye + d * t);
  vec3 p = uSpinInv * n;

  /* --- плазма: доменное искажение даёт текучие волокна --- */
  vec3 q = p * 2.3 + vec3(0.0, uTime * 0.035, 0.0);
  float w1 = fbm3(q);
  float plasma = 0.5;
  if (uDetail > 0.5) {
    float w2 = fbm3(q * 2.1 + w1 * 1.7 + 3.7);
    plasma = w1 * 0.42 + w2 * 0.58;
  } else {
    plasma = w1;
  }
  float fine = vnoise(p * 26.0);
  float fil = pow(1.0 - abs(2.0 * plasma - 1.0), 9.0);

  float tt = uTemp + (plasma - 0.5) * 0.055;
  vec3 col = bbColor(tt) * (0.995 + 0.02 * plasma);
  col += bbColor(min(1.0, tt + 0.14)) * fil * 0.13 * uDetail;
  col += vec3(0.02, 0.02, 0.03) * fine * 0.12;

  /* --- горячие пятна на магнитных полюсах --- */
  vec3 m = vec3(sin(uAlpha), cos(uAlpha), 0.0);
  float ca = dot(p, m);
  float spotN = pow(max(ca, 0.0), uSpotSharp);
  float spotS = pow(max(-ca, 0.0), uSpotSharp);
  float haloN = pow(max(ca, 0.0), uSpotSharp * 0.22);
  float haloS = pow(max(-ca, 0.0), uSpotSharp * 0.22);
  float spotFil = 0.72 + 0.55 * fil;
  col += vec3(1.0, 0.97, 0.90) * (spotN * 1.45 + spotS * 0.85) * spotFil * uSpot;
  col += vec3(1.0, 0.86, 0.70) * (haloN + haloS) * 0.10 * uSpot;
  col += vec3(0.92, 0.80, 1.0) * (haloN + haloS) * 0.22 * uAccretion;

  /* --- релятивистское усиление (доплер) --- */
  vec3 vel = cross(vec3(0.0, 1.0, 0.0), n);
  float vl = length(vel);
  vec3 vdir = vl > 1.0e-5 ? vel / vl : vec3(0.0);
  float beta = uBeta * vl * dot(vdir, -d);
  col *= pow(max(0.62, 1.0 + beta), 1.7);

  /* --- лимб --- */
  float mu = clamp(dot(n, -d), 0.0, 1.0);
  col *= mix(0.88, 1.0, pow(mu, 0.22));

  /* --- насыщенность и тональная компрессия --- */
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.32);
  col = vec3(1.0) - exp(-col * 1.18);

  /* --- голубой ободок --- */
  float rim = pow(1.0 - mu, 3.0);
  col += vec3(0.36, 0.60, 1.0) * rim * uRim;
  col += vec3(0.14, 0.26, 0.70) * pow(1.0 - mu, 9.0) * uRim;

  /* --- схлопывание в чёрную дыру --- */
  if (uBH > 0.001) {
    col = mix(col, vec3(0.004, 0.004, 0.008), uBH);
    col += vec3(1.0, 0.84, 0.58) * pow(1.0 - mu, 16.0) * uBH * 7.0;
    col += vec3(0.70, 0.82, 1.0) * pow(1.0 - mu, 5.0) * uBH * 0.9;
    col += vec3(0.35, 0.45, 0.9) * pow(1.0 - mu, 2.0) * uBH * 0.18;
  }

  gl_FragColor = vec4(col, cov);
}`;

  /* --------------------------------------------------------- ОБЪЁМ (add) -- */
  const VOL_FS = COMMON + `
uniform mat3 uSpin;
uniform float uAlpha;
uniform float uTime;
uniform float uGlow;
uniform float uBeam;
uniform float uBeamWidth;
uniform float uDisk;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uFlare;
uniform float uJet;
uniform float uBoom;
uniform float uBoomR;
uniform float uBoomAge;
uniform float uFlash;
uniform vec3 uBeamColor;
uniform vec3 uCoronaColor;

void main() {
  vec3 d = rayDir(vUv);
  vec3 col = vec3(0.0);

  float tHit;
  float hit = hitSphere(uEye, d, tHit);
  float dist = rayDist(uEye, d);
  float outside = smoothstep(0.97, 1.06, dist);

  /* --- корона --- */
  float near0 = exp(-max(dist - 1.0, 0.0) * 3.4);
  float far0  = exp(-max(dist - 1.0, 0.0) * 0.66);
  float flick = 0.95 + 0.05 * sin(uTime * 3.1) * sin(uTime * 1.7 + 1.3);
  col += uCoronaColor * (near0 * 0.48 + far0 * 0.11) * uGlow * outside * flick;

  /* --- вспышка (взрыв, всплеск магнетара) --- */
  col += vec3(1.0, 0.95, 0.88) * uFlash * 1.6;
  col += vec3(0.72, 0.52, 1.0) * uFlare * exp(-max(dist - 1.0, 0.0) * 4.5) * 2.2 * outside;

  vec3 ax = uSpin * vec3(sin(uAlpha), cos(uAlpha), 0.0);
  vec3 fallback = abs(ax.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);

  /* --- конусы излучения вдоль магнитной оси --- */
  for (int i = 0; i < 2; i++) {
    vec3 A = i == 0 ? ax : -ax;
    float da = dot(d, A);
    float den = 1.0 - da * da;
    if (den < 1.0e-4) continue;

    float od = dot(uEye, d);
    float oa = dot(uEye, A);
    float t = (oa * da - od) / den;
    if (t <= 0.0) continue;
    float s = oa + t * da;
    if (s <= 0.0) continue;

    vec3 P = uEye + d * t;
    if (length(P) < 1.02) continue;
    if (hit > 0.0 && t > tHit) continue;

    vec3 perpV = P - A * s;
    float dp = length(perpV);
    vec3 B1 = normalize(cross(A, fallback));
    vec3 B2 = cross(A, B1);
    vec3 pd = dp > 1.0e-4 ? perpV / dp : B1;
    float az = atan(dot(pd, B2), dot(pd, B1));

    float filament = 0.70 + 0.42 * sin(az * 5.0 + s * 2.3 - uTime * 2.4);
    float w = uBeamWidth * (1.0 + s * 0.80);
    float prof = exp(-(dp * dp) / (w * w));
    float fall = 1.0 / (1.0 + s * s * 0.16);
    float pulse = 0.86 + 0.14 * sin(uTime * 6.0);
    col += uBeamColor * prof * fall * filament * uBeam * pulse * smoothstep(0.55, 1.7, s);
  }

  /* --- струи вдоль оси вращения --- */
  for (int i = 0; i < 2; i++) {
    if (uJet < 0.002) continue;
    vec3 A = i == 0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
    float da = dot(d, A);
    float den = 1.0 - da * da;
    if (den < 1.0e-4) continue;
    float od = dot(uEye, d);
    float oa = dot(uEye, A);
    float t = (oa * da - od) / den;
    if (t <= 0.0) continue;
    float s = oa + t * da;
    if (s <= 0.0) continue;
    vec3 P = uEye + d * t;
    if (length(P) < 1.02) continue;
    if (hit > 0.0 && t > tHit) continue;
    float dp = length(P - A * s);
    float w = 0.045 + s * 0.045;
    float prof = exp(-(dp * dp) / (w * w));
    float knots = 0.55 + 0.45 * sin(s * 5.0 - uTime * 5.0);
    float fall = 1.0 / (1.0 + s * s * 0.09);
    col += vec3(0.55, 0.86, 1.0) * prof * fall * knots * uJet * smoothstep(0.7, 2.0, s);
  }

  /* --- аккреционный диск --- */
  if (uDisk > 0.001 && abs(d.y) > 1.0e-5) {
    float td = -uEye.y / d.y;
    if (td > 0.0) {
      vec3 P = uEye + d * td;
      float r = length(P.xz);
      if (r > uDiskIn && r < uDiskOut) {
        float occ = 1.0;
        if (hit > 0.0 && td > tHit) occ = 0.0;
        if (occ > 0.0) {
          float ang = atan(P.z, P.x);
          float ring = smoothstep(uDiskIn, uDiskIn * 1.10, r) *
                       (1.0 - smoothstep(uDiskOut * 0.55, uDiskOut, r));
          float spiral = 0.5 + 0.5 * sin(ang * 4.0 - log(r) * 9.0 + uTime * 1.2);
          float bands = 0.52 + 0.48 * spiral;
          float rim = exp(-pow((r - uDiskIn) * 2.4, 2.0));
          vec3 vdir = normalize(vec3(-P.z, 0.0, P.x));
          float dop = 1.0 + 0.75 * dot(vdir, -d);
          vec3 dc = mix(vec3(1.0, 0.95, 0.86), vec3(1.0, 0.40, 0.07),
                        smoothstep(uDiskIn * 1.25, uDiskOut * 0.85, r));
          col += dc * ring * bands * uDisk * occ * dop * 0.80;
          col += vec3(1.0, 0.86, 0.66) * rim * uDisk * occ * 0.55;
        }
      }
    }
  }

  /* --- оболочка взрыва --- */
  if (uBoom > 0.002 && uBoomR > 1.0) {
    float bb = dot(uEye, d);
    float cc = dot(uEye, uEye) - uBoomR * uBoomR;
    float dd = bb * bb - cc;
    if (dd > 0.0) {
      float sq = sqrt(dd);
      float t0 = -bb - sq;
      float t1 = -bb + sq;
      float inside = 0.0;
      float ts = t0;
      if (t0 <= 0.0) { ts = t1; inside = 1.0; }
      if (ts > 0.0) {
        vec3 P = uEye + d * ts;
        vec3 nd = normalize(P);
        float n1 = fbm3(nd * 5.0 + uBoomAge * 3.0);
        float n2 = fbm3(nd * 11.0 - uBoomAge * 2.0);
        float fil = pow(1.0 - abs(2.0 * n1 - 1.0), 4.0);
        float heat = clamp(1.0 - uBoomAge, 0.0, 1.0);
        vec3 fire = mix(vec3(1.0, 0.30, 0.06), vec3(0.62, 0.80, 1.0), smoothstep(0.15, 0.95, uBoomAge));
        float dens = (0.22 + 0.85 * fil) * (0.55 + 0.65 * n2);
        col += (fire * dens * 0.42 + vec3(1.0, 0.95, 0.85) * heat * heat * 0.28) *
               uBoom * mix(1.0, 0.40, inside);
      }
    }
  }

  gl_FragColor = vec4(col, 1.0);
}`;

  /* ------------------------------------------------------- СИЛОВЫЕ ЛИНИИ -- */
  const LINE_VS = `
attribute vec3 aPos;
attribute vec3 aCol;
uniform vec2 uRes;
uniform float uTan;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec3 vCol;

void main() {
  vec3 rel = aPos - uEye;
  float z = dot(rel, uFwd);
  float x = dot(rel, uRight);
  float y = dot(rel, uUp);
  float aspect = uRes.x / max(uRes.y, 1.0);
  float zz = max(z, 0.04);
  gl_Position = vec4(x / (zz * uTan * aspect), y / (zz * uTan), 0.0, 1.0);
  vCol = aCol * (z > 0.05 ? 1.0 : 0.0);
}`;

  const LINE_FS = `
precision highp float;
varying vec3 vCol;
void main() {
  gl_FragColor = vec4(vCol, 1.0);
}`;

  /* ------------------------------------------------------------ ЧАСТИЦЫ -- */
  const SPR_VS = `
attribute vec3 aPos;
attribute vec4 aCol;
attribute float aSize;
uniform vec2 uRes;
uniform float uTan;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec4 vCol;

void main() {
  vec3 rel = aPos - uEye;
  float z = dot(rel, uFwd);
  float x = dot(rel, uRight);
  float y = dot(rel, uUp);
  float aspect = uRes.x / max(uRes.y, 1.0);
  float zz = max(z, 0.05);
  gl_Position = vec4(x / (zz * uTan * aspect), y / (zz * uTan), 0.0, 1.0);

  float px = aSize * (uRes.y * 0.5 / uTan) / zz;
  gl_PointSize = clamp(px, 1.0, 30.0);

  float t = 1.0;
  vec3 dd = normalize(aPos - uEye);
  float bb = dot(uEye, dd);
  float cc = dot(uEye, uEye) - 1.0;
  float disc = bb * bb - cc;
  if (disc > 0.0) {
    float th = -bb - sqrt(disc);
    if (th > 0.0 && length(rel) > th) t = 0.0;
  }
  vCol = aCol * t * (z > 0.05 ? 1.0 : 0.0);
}`;

  const SPR_FS = `
precision highp float;
varying vec4 vCol;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.05, r);
  a *= a;
  gl_FragColor = vec4(vCol.rgb * vCol.a * a, 1.0);
}`;

  /* ------------------------------------------------- П О С Т О Б Р А Б О Т К А */
  const BRIGHT_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 c = texture2D(uTex, uv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float w = clamp((l - uThreshold) / max(uKnee, 0.001), 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  gl_FragColor = vec4(c * w, 1.0);
}`;

  const BLUR_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 s = texture2D(uTex, uv).rgb * 0.2270270270;
  s += (texture2D(uTex, uv + uDir * 1.3846153846).rgb +
        texture2D(uTex, uv - uDir * 1.3846153846).rgb) * 0.3162162162;
  s += (texture2D(uTex, uv + uDir * 3.2307692308).rgb +
        texture2D(uTex, uv - uDir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

  const COMP_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform float uBloom;
uniform float uFlash;
uniform float uExposure;

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 c = texture2D(uScene, uv).rgb;
  c += texture2D(uB1, uv).rgb * uBloom * 1.05;
  c += texture2D(uB2, uv).rgb * uBloom * 0.75;
  c *= uExposure;
  c += vec3(1.0, 0.96, 0.9) * uFlash;
  /* мягкое плечо: середина не темнеет, блики сжимаются */
  c = c / (1.0 + 0.10 * c);
  c = min(c, vec3(1.0));
  vec2 q = vUv * 0.5;
  c *= 1.0 - 0.20 * dot(q, q);
  gl_FragColor = vec4(c, 1.0);
}`;

  NS.SHADERS = {
    quadVS: QUAD_VS,
    bg: BG_FS,
    sphere: SPHERE_FS,
    volume: VOL_FS,
    lineVS: LINE_VS,
    lineFS: LINE_FS,
    sprVS: SPR_VS,
    sprFS: SPR_FS,
    bright: BRIGHT_FS,
    blur: BLUR_FS,
    composite: COMP_FS
  };
})(window.NS = window.NS || {});
