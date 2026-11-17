/* =========================================================================
   Физика нейтронной звезды (СИ) + форматирование чисел
   ========================================================================= */
(function (NS) {
  'use strict';

  const C = 2.99792458e8;      // м/с
  const G = 6.6743e-11;        // м^3/(кг·с^2)
  const MSUN = 1.98892e30;     // кг
  const MU0 = 1.25663706212e-6;// Гн/м
  const YR = 3.15576e7;        // с

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  /* ------------------------------------------------------------- величины -- */
  function derive(P) {
    const M = P.mass * MSUN;
    const R = P.radiusKm * 1e3;
    const B = P.Bgauss * 1e-4;            // Гс -> Тл
    const omega = 2 * Math.PI * P.nu;
    const I = 0.35 * M * R * R;           // момент инерции (реалистичный коэф.)
    const sinA = Math.sin(P.alpha);

    /* Магнитодипольное излучение: L = (2π/3)·B²R⁶ω⁴sin²α/(μ0c³) */
    const Lsd = (2 * Math.PI / 3) * B * B * Math.pow(R, 6) * Math.pow(omega, 4) *
      sinA * sinA / (MU0 * C * C * C);

    /* Торможение: I·ω·ω̇ = -L  =>  ω̇ = -L/(I·ω) */
    const omegaDot = omega > 0 ? -Lsd / (I * omega) : 0;
    const PdotAbs = omega > 0 ? Math.abs((2 * Math.PI / (omega * omega)) * omegaDot) : 0;
    const tau = PdotAbs > 0 ? (1 / P.nu) / (2 * PdotAbs) / YR : Infinity;

    /* Гравитация и компактность */
    const Rs = 2 * G * M / (C * C);
    const comp = Rs / R;
    const zGrav = comp < 1 ? 1 / Math.sqrt(1 - comp) - 1 : Infinity;
    const gSurf = G * M / (R * R);
    const vEsc = Math.sqrt(2 * G * M / R);

    /* Предел разрыва (ньютоновский кеплеровский) */
    const omegaMax = Math.sqrt(G * M / (R * R * R));

    /* Экваториальная скорость */
    const betaEq = omega * R / C;

    /* Световой цилиндр и радиус совместного вращения */
    const RlcKm = omega > 0 ? (C / omega) / 1e3 : Infinity;
    const RcoKm = omega > 0 ? Math.cbrt(G * M / (omega * omega)) / 1e3 : Infinity;

    /* Аккреция */
    const mdotKgs = P.mdot > 0 ? P.mdot * MSUN / YR : 0;
    const Lacc = mdotKgs > 0 ? G * M * mdotKgs / R : 0;
    const omegaUp = mdotKgs > 0 ? (mdotKgs * Math.sqrt(G * M * R)) / I : 0;

    /* Магнитный момент и радиус Альвена (магнитосфера против давления вещества) */
    const muMag = B * Math.pow(R, 3);
    const Rm = mdotKgs > 0
      ? Math.pow(Math.pow(muMag, 4) / (2 * G * M * mdotKgs * mdotKgs), 1 / 7)
      : Infinity;
    const RmKm = Rm / 1e3;
    const Rco = omega > 0 ? Math.cbrt(G * M / (omega * omega)) : Infinity;

    /* Режим аккреции */
    let regime = 'эжектор';
    if (mdotKgs > 0) {
      if (Rm < R * 1.02) regime = 'прямая аккреция';
      else if (Rm < Rco) regime = 'аккреция на полюса';
      else regime = 'пропеллер';
    }
    /* Равновесный период (Гоша–Лэмба): P_eq ≈ 2π R_m^1.5 / sqrt(GM) */
    const Peq = Rm > 0 && isFinite(Rm)
      ? 2 * Math.PI * Math.pow(Rm, 1.5) / Math.sqrt(G * M) : Infinity;
    const omegaEq = Peq > 0 && isFinite(Peq) ? 2 * Math.PI / Peq : 0;

    /* Эддингтоновский предел */
    const Ledd = 1.26e31 * (P.mass);
    const eddFrac = Lacc / Ledd;

    /* Линия смерти радиопульсаров: B12 / P² ≳ 0.2 */
    const period = 1 / P.nu;
    const deathValue = (P.Bgauss / 1e12) / (period * period);
    const dead = deathValue < 0.2;

    /* Энергия связи и средняя плотность */
    const Ebond = 0.6 * G * M * M / R;
    const rhoMean = M / (4 / 3 * Math.PI * R * R * R);

    /* Центробежное уплощение */
    const oblateness = omega * omega * R * R * R / (G * M);

    /* Стабильность: причинность R > 1.6 Rs (EOS), предел ОВ ~2.2 M☉ */
    const stable = R > 1.6 * Rs && P.mass < 2.25;

    /* Энергия вращения */
    const Erot = 0.5 * I * omega * omega;

    /* Температура -> визуальный индекс 0..1 (1e5..1e7 K).
       Наблюдаемая температура ниже из-за гравитационного красного смещения. */
    const TK = P.tempMK * 1e6;
    const TKobs = TK / (1 + (isFinite(zGrav) ? zGrav : 0));
    const uTemp = clamp((Math.log10(TKobs) - 5.0) / 2.0, 0, 1);

    return {
      M: M, R: R, B: B, omega: omega, I: I,
      Lsd: Lsd, omegaDot: omegaDot, Pdot: PdotAbs, tau: tau,
      Rs: Rs, comp: comp, zGrav: zGrav, gSurf: gSurf, vEsc: vEsc,
      omegaMax: omegaMax, nuMax: omegaMax / (2 * Math.PI),
      betaEq: betaEq, RlcKm: RlcKm, RcoKm: RcoKm,
      mdotKgs: mdotKgs, Lacc: Lacc, omegaUp: omegaUp, Erot: Erot,
      muMag: muMag, Rm: Rm, RmKm: RmKm, Rco: Rco, regime: regime,
      Peq: Peq, omegaEq: omegaEq, Ledd: Ledd, eddFrac: eddFrac,
      deathValue: deathValue, dead: dead, Ebond: Ebond, rhoMean: rhoMean,
      oblateness: oblateness, stable: stable,
      TK: TK, uTemp: uTemp
    };
  }

  /* ------------------------------------------- визуальное замедление вращения */
  const NU_MIN = 0.05, NU_MAX = 1500;
  function visualHz(nu) {
    const t = Math.log(nu / NU_MIN) / Math.log(NU_MAX / NU_MIN);
    return 0.22 + 1.85 * clamp(t, 0, 1);
  }

  function diskLevel(mdot) {
    if (!(mdot > 0)) return 0;
    return clamp(Math.log10(mdot / 1e-13) / Math.log10(1e-7 / 1e-13), 0, 1);
  }

  function classify(P, D) {
    if (P.mdot > 2e-11) return 'Аккретор';
    if (P.Bgauss >= 1e14) return 'Магнетар';
    if (P.nu >= 100) return 'Мил. пульсар';
    if (P.Bgauss >= 4e12 && P.nu < 12) return 'Молодой пульсар';
    return 'Пульсар';
  }

  /* ------------------------------------------------------- форматирование -- */
  const SUPS = { '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207b' };
  function sup(n) {
    const s = String(n);
    let out = '';
    for (let i = 0; i < s.length; i++) out += SUPS[s[i]] || s[i];
    return out;
  }

  function sci(x, digits) {
    if (x === 0) return '0';
    if (!isFinite(x)) return '\u221e';
    const d = digits === undefined ? 1 : digits;
    const e = Math.floor(Math.log10(Math.abs(x)));
    if (e >= 3 && e <= 5) {
      /* 71 969 — без экспоненты */
      return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
    }
    if (e >= -2 && e <= 2) {
      const dec = Math.max(0, 2 - (e > 0 ? e : 0));
      return x.toFixed(dec).replace('.', ',');
    }
    const m = x / Math.pow(10, e);
    return m.toFixed(d).replace('.', ',') + '\u00b7' + '10' + sup(e);
  }

  function num(x, d) {
    if (!isFinite(x)) return '\u221e';
    return x.toFixed(d === undefined ? 2 : d).replace('.', ',');
  }

  function fmtPeriod(nu) {
    const P = 1 / nu;
    if (P >= 1) return num(P, 2) + ' с';
    if (P >= 1e-3) return num(P * 1e3, 1) + ' мс';
    return num(P * 1e6, 1) + ' мкс';
  }

  function fmtBigW(w) {
    // мощность в ваттах
    if (!isFinite(w) || w <= 0) return '\u2014';
    return sci(w, 2) + ' Вт';
  }

  function fmtDistanceKm(km) {
    if (!isFinite(km)) return '\u2014';
    if (km >= 1e6) return sci(km / 1e6, 2) + ' млн км';
    if (km >= 1e4) return num(km / 1e3, 1) + ' тыс. км';
    if (km >= 10) return num(km, 1) + ' км';
    return num(km, 2) + ' км';
  }

  function fmtAge(yr) {
    if (!isFinite(yr) || yr <= 0) return '\u2014';
    if (yr >= 1e9) return num(yr / 1e9, 2) + ' млрд лет';
    if (yr >= 1e6) return num(yr / 1e6, 2) + ' млн лет';
    if (yr >= 1e3) return num(yr / 1e3, 1) + ' тыс. лет';
    return num(yr, 0) + ' лет';
  }

  NS.Physics = derive;
  NS.Fmt = {
    sci: sci, num: num, sup: sup, period: fmtPeriod,
    power: fmtBigW, distance: fmtDistanceKm, age: fmtAge
  };
  NS.MathX = {
    clamp: clamp,
    visualHz: visualHz,
    diskLevel: diskLevel,
    classify: classify,
    NU_MIN: NU_MIN,
    NU_MAX: NU_MAX
  };
})(window.NS = window.NS || {});
