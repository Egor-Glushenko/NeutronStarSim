/* =========================================================================
   Меню управления: строится из схемы параметров, секции — аккордеон
   ========================================================================= */
(function (NS) {
  'use strict';

  const F = NS.Fmt;
  const pct = (v) => Math.round(v * 100) + '%';

  /* --------------------------------------------------------------- схема --- */
  const SCHEMA = [
    {
      type: 'pills', key: 'preset', label: 'Сценарий',
      options: [
        { id: 'pulsar', label: 'Пульсар' },
        { id: 'magnetar', label: 'Магнетар' },
        { id: 'ms', label: 'Мил. пульсар' },
        { id: 'binary', label: 'Аккретор' },
        { id: 'young', label: 'Молодой' },
        { id: 'sn', label: 'Взрыв' }
      ]
    },

    { type: 'group', title: 'Вращение и поле', open: true },
    {
      type: 'range', key: 'nu', label: 'Частота вращения', unit: 'Гц',
      min: 0.05, max: 1500, log: true,
      hint: 'Сколько оборотов в секунду. У реальных пульсаров — от 0,05 до 700 Гц.',
      fmt: (v) => F.num(v, v < 10 ? 2 : 1)
    },
    {
      type: 'range', key: 'alpha', label: 'Наклон магнитной оси', unit: '\u00b0',
      min: 0, max: 90,
      hint: 'Если ось совпадает с осью вращения (0°), пульсар «молчит».',
      fmt: (v) => F.num(v * 180 / Math.PI, 0),
      custom: {
        toT: (v) => (v * 180 / Math.PI) / 90,
        fromT: (t) => t * 90 * Math.PI / 180
      }
    },
    {
      type: 'range', key: 'Bgauss', label: 'Индукция на полюсе', unit: 'Гс',
      min: 1e8, max: 1e15, log: true,
      hint: 'Поле задаёт торможение, мощность излучения и радиус магнитосферы.',
      fmt: (v) => F.sci(v, 1)
    },

    { type: 'group', title: 'Вещество', open: true },
    {
      type: 'range', key: 'mass', label: 'Масса', unit: 'M\u2609',
      min: 1.0, max: 2.6, step: 0.01,
      fmt: (v) => F.num(v, 2)
    },
    {
      type: 'range', key: 'radiusKm', label: 'Радиус', unit: 'км',
      min: 9, max: 15, step: 0.1,
      fmt: (v) => F.num(v, 1)
    },
    {
      type: 'range', key: 'tempMK', label: 'Температура поверхности', unit: 'МК',
      min: 0.2, max: 8, log: true,
      hint: 'Молодые звёзды горячее, старые остывают до сотен тысяч кельвинов.',
      fmt: (v) => F.num(v, v < 1 ? 2 : 1)
    },
    {
      type: 'range', key: 'mdot', label: 'Темп аккреции', unit: 'M\u2609/год',
      min: 0, max: 1e-8,
      hint: 'Перетекание вещества: диск, раскрутка, рентген. Режим считается по радиусу Альвена.',
      fmt: (v) => (v <= 0 ? 'нет' : F.sci(v, 1)),
      custom: {
        toT: (v) => {
          if (!(v > 0)) return 0;
          const lo = Math.log10(1e-13), hi = Math.log10(1e-8);
          return Math.max(0.02, (Math.log10(v) - lo) / (hi - lo));
        },
        fromT: (t) => {
          if (t <= 0.02) return 0;
          const lo = Math.log10(1e-13), hi = Math.log10(1e-8);
          return Math.pow(10, lo + ((t - 0.02) / 0.98) * (hi - lo));
        }
      }
    },

    { type: 'group', title: 'Взрыв и вспышки', open: false },
    {
      type: 'range', key: 'boomEnergy', label: 'Энергия взрыва', unit: 'эрг',
      min: 1e44, max: 1e52, log: true,
      hint: 'Типичная сверхновая — 10⁵¹ эрг.',
      fmt: (v) => F.sci(v, 1)
    },
    {
      type: 'range', key: 'boomMass', label: 'Масса выброса', unit: 'M\u2609',
      min: 0.005, max: 1, log: true,
      fmt: (v) => F.num(v, v < 0.1 ? 3 : 2)
    },
    { type: 'check', key: 'collapse', label: 'Коллапс в чёрную дыру',
      hint: 'После взрыва остаток схлопывается' },
    {
      type: 'actions', items: [
        { id: 'boom', label: '\uD83D\uDCA5 Взрыв' },
        { id: 'flare', label: '\u26a1 Вспышка' }
      ]
    },

    { type: 'group', title: 'Эволюция', open: false },
    {
      type: 'range', key: 'autoEvo', label: 'Течение времени', unit: 'лет/с',
      min: 0, max: 1e6,
      hint: 'Ускоренное время: звезда тормозится, поле магнетара затухает.',
      fmt: (v) => (v <= 0 ? 'выкл' : F.sci(v, 1)),
      custom: {
        toT: (v) => (v <= 0 ? 0 : Math.max(0.02, Math.log10(v / 100) / 4)),
        fromT: (t) => (t <= 0.02 ? 0 : 100 * Math.pow(10, ((t - 0.02) / 0.98) * 4))
      }
    },
    {
      type: 'range', key: 'timeScale', label: 'Темп анимации', unit: '\u00d7',
      min: 0.15, max: 3, log: true,
      fmt: (v) => F.num(v, 2)
    },

    { type: 'group', title: 'Взгляд', open: false },
    { type: 'check', key: 'showField', label: 'Силовые линии' },
    { type: 'check', key: 'showBeam', label: 'Конусы излучения' },
    { type: 'check', key: 'showDisk', label: 'Аккреционный диск' },
    { type: 'check', key: 'showJets', label: 'Джеты вдоль оси' },
    { type: 'check', key: 'autoRotate', label: 'Вращение камеры' },
    { type: 'range', key: 'glow', label: 'Свечение короны', min: 0, max: 2, fmt: pct },
    { type: 'range', key: 'bloom', label: 'Цветение (bloom)', min: 0, max: 2, fmt: pct },
    { type: 'range', key: 'particles', label: 'Плотность частиц', min: 0, max: 1, fmt: pct },
    {
      type: 'select', key: 'quality', label: 'Качество',
      options: [
        { id: 'auto', label: 'Авто (следит за FPS)' },
        { id: 'low', label: 'Низкое — экономия' },
        { id: 'med', label: 'Среднее' },
        { id: 'high', label: 'Высокое' }
      ]
    },
    { type: 'actions', items: [{ id: 'view', label: '\u27f3 Сброс вида' }] },

    { type: 'group', title: 'Звук', open: true },
    { type: 'check', key: 'sound', label: 'Включить звук', hint: 'Синтез на лету, без файлов' },
    { type: 'range', key: 'volume', label: 'Общая громкость', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'ambience', label: 'Фон и гул', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'pulseGain', label: 'Ритм импульсов', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'reverb', label: 'Реверберация', min: 0, max: 1, fmt: pct },
    { type: 'check', key: 'rhythm', label: 'Пульсация включена' },
    {
      type: 'note',
      text: 'Клавиши: пробел — пауза, H — панель, M — звук, E — взрыв, R — сброс, 1…6 — сценарии. ' +
        'Мышью — камера, колесо — масштаб, двойной щелчок — вернуть вид.'
    }
  ];

  /* --------------------------------------------------------------- утилиты -- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function sliderFill(input, t) {
    input.style.setProperty('--p', (Math.max(0, Math.min(1, t)) * 100).toFixed(1) + '%');
  }

  function toT(p, v) {
    if (p.custom && p.custom.toT) return p.custom.toT(v);
    if (p.log) {
      const lo = Math.log(p.min), hi = Math.log(p.max);
      return (Math.log(Math.max(p.min, v)) - lo) / (hi - lo);
    }
    return (v - p.min) / (p.max - p.min);
  }

  function fromT(p, t) {
    t = Math.max(0, Math.min(1, t));
    if (p.custom && p.custom.fromT) return p.custom.fromT(t);
    if (p.log) {
      const lo = Math.log(p.min), hi = Math.log(p.max);
      return Math.exp(lo + t * (hi - lo));
    }
    let v = p.min + t * (p.max - p.min);
    if (p.step) v = Math.round(v / p.step) * p.step;
    return v;
  }

  /* -------------------------------------------------------------------- API -- */
  function create(opts) {
    const root = opts.root;
    const get = opts.get;
    const set = opts.set;
    const act = opts.act;

    const refs = Object.create(null);
    const groups = Object.create(null);
    let pillButtons = [];
    let activePreset = 'pulsar';
    let dragging = null;

    root.innerHTML = '';

    function addGroup(title, open) {
      const g = el('div', 'grp' + (open ? ' open' : ' closed'));
      const head = el('button', 'gh');
      head.type = 'button';
      const t = el('span', null, title);
      const ic = el('i', null, '\u25be');
      head.appendChild(t);
      head.appendChild(ic);
      const body = el('div', 'gc');
      head.addEventListener('click', () => {
        const isOpen = g.classList.contains('open');
        g.classList.toggle('open', !isOpen);
        g.classList.toggle('closed', isOpen);
      });
      g.appendChild(head);
      g.appendChild(body);
      root.appendChild(g);
      return { group: g, body: body, title: title };
    }

    let current = null;

    SCHEMA.forEach((item) => {
      if (item.type === 'group') {
        current = addGroup(item.title, item.open !== false);
        groups[item.title] = current;
        return;
      }

      const host = current ? current.body : root;

      if (item.type === 'pills') {
        const pills = el('div', 'pills');
        item.options.forEach((o) => {
          const b = el('button', 'pill', o.label);
          b.type = 'button';
          b.dataset.preset = o.id;
          b.addEventListener('click', () => { act('preset', o.id); });
          pillButtons.push(b);
          pills.appendChild(b);
        });
        host.appendChild(pills);
        return;
      }

      if (item.type === 'actions') {
        const row = el('div', 'pills');
        item.items.forEach((it) => {
          const b = el('button', 'pill act-pill', it.label);
          b.type = 'button';
          b.dataset.act = it.id;
          b.addEventListener('click', () => act(it.id));
          row.appendChild(b);
        });
        host.appendChild(row);
        return;
      }

      if (item.type === 'note') {
        host.appendChild(el('p', 'tip', item.text));
        return;
      }

      if (item.type === 'check') {
        const lab = el('label', 'sw');
        if (item.hint) lab.title = item.hint;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!get(item.key);
        input.setAttribute('aria-label', item.label);
        const track = el('span', 'track');
        const txt = el('span', 'txt', item.label);
        input.addEventListener('change', () => set(item.key, input.checked));
        lab.appendChild(input);
        lab.appendChild(track);
        lab.appendChild(txt);
        host.appendChild(lab);
        refs[item.key] = { type: 'check', input: input };
        return;
      }

      if (item.type === 'select') {
        const row = el('div', 'row');
        const lbl = el('div', 'lbl');
        lbl.appendChild(el('span', null, item.label));
        row.appendChild(lbl);
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', item.label);
        item.options.forEach((o) => {
          const op = document.createElement('option');
          op.value = o.id;
          op.textContent = o.label;
          sel.appendChild(op);
        });
        sel.value = get(item.key);
        sel.addEventListener('change', () => set(item.key, sel.value));
        row.appendChild(sel);
        host.appendChild(row);
        refs[item.key] = { type: 'select', input: sel };
        return;
      }

      /* range */
      const row = el('div', 'row');
      const lbl = el('div', 'lbl');
      const name = el('span', null, item.label);
      if (item.hint) name.title = item.hint;
      const val = el('b');
      lbl.appendChild(name);
      lbl.appendChild(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.0005';
      input.setAttribute('aria-label', item.label);
      row.appendChild(lbl);
      row.appendChild(input);

      const unitTxt = item.unit ? ' ' + item.unit : '';
      const paint = (v) => {
        val.innerHTML = item.fmt(v) + (unitTxt ? '<em>' + unitTxt + '</em>' : '');
        sliderFill(input, toT(item, v));
      };

      input.addEventListener('pointerdown', () => { dragging = item.key; });
      input.addEventListener('input', () => {
        const v = fromT(item, parseFloat(input.value));
        paint(v);
        set(item.key, v);
      });
      input.addEventListener('change', () => { dragging = null; });
      input.addEventListener('blur', () => { dragging = null; });

      host.appendChild(row);
      refs[item.key] = { type: 'range', input: input, paint: paint, def: item };
    });

    function refresh(values) {
      Object.keys(refs).forEach((k) => {
        const r = refs[k];
        if (!r) return;
        if (r.type === 'range') {
          if (dragging === k) return;
          const v = values[k];
          r.paint(v);
          r.input.value = String(toT(r.def, v));
          sliderFill(r.input, toT(r.def, v));
        } else if (r.type === 'check') {
          r.input.checked = !!values[k];
        } else if (r.type === 'select') {
          r.input.value = values[k];
        }
      });
    }

    function syncKeys(keys, values) {
      keys.forEach((k) => {
        const r = refs[k];
        if (!r || r.type !== 'range' || dragging === k) return;
        const v = values[k];
        r.paint(v);
        r.input.value = String(toT(r.def, v));
        sliderFill(r.input, toT(r.def, v));
      });
    }

    function setPreset(id) {
      activePreset = id;
      pillButtons.forEach((b) => b.classList.toggle('on', b.dataset.preset === id));
    }

    function clearPreset() {
      if (!activePreset) return;
      activePreset = null;
      pillButtons.forEach((b) => b.classList.remove('on'));
    }

    function openGroup(title, isOpen) {
      const g = groups[title];
      if (!g) return;
      g.group.classList.toggle('open', isOpen);
      g.group.classList.toggle('closed', !isOpen);
    }

    return {
      refresh: refresh,
      syncKeys: syncKeys,
      setPreset: setPreset,
      clearPreset: clearPreset,
      openGroup: openGroup,
      refs: refs
    };
  }

  NS.UI = { create: create, SCHEMA: SCHEMA, toT: toT, fromT: fromT };
})(window.NS = window.NS || {});
