'use strict';
// NEXUS Rewind: аналитика игрового времени за неделю, месяц, год и карточка-дашборд (SVG). Работает в браузере и в Node (тесты).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog-data.js'));
  else root.NexusRewind = factory(root.NexusData);
})(typeof self !== 'undefined' ? self : this, function (D) {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const MON_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const PERIODS = {week: 'Неделя', month: 'Месяц', year: 'Год'};

  // границы периода: неделя с понедельника, календарный месяц, календарный год; и такой же предыдущий период
  function range(period, now = new Date()) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let s, e, ps, pe;
    if (period === 'month') { s = new Date(t.getFullYear(), t.getMonth(), 1); e = new Date(t.getFullYear(), t.getMonth() + 1, 0); ps = new Date(t.getFullYear(), t.getMonth() - 1, 1); pe = new Date(t.getFullYear(), t.getMonth(), 0); }
    else if (period === 'year') { s = new Date(t.getFullYear(), 0, 1); e = new Date(t.getFullYear(), 11, 31); ps = new Date(t.getFullYear() - 1, 0, 1); pe = new Date(t.getFullYear() - 1, 11, 31); }
    else { const dow = (t.getDay() + 6) % 7; s = addDays(t, -dow); e = addDays(s, 6); ps = addDays(s, -7); pe = addDays(s, -1); period = 'week'; }
    const list = (a, b) => { const o = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(ymd(d)); return o; };
    const label = period === 'week' ? `${s.getDate()} ${s.getMonth() === e.getMonth() ? '' : MON_FULL[s.getMonth()] + ' '}– ${e.getDate()} ${MON_FULL[e.getMonth()]} ${e.getFullYear()}`
      : period === 'month' ? `${MON_NOM[s.getMonth()]} ${s.getFullYear()}` : String(s.getFullYear());
    return {period, start: ymd(s), end: ymd(e), days: list(s, e), prevStart: ymd(ps), prevEnd: ymd(pe), prevDays: list(ps, pe), label, today: ymd(t)};
  }
  const inR = (d, a, b) => d >= a && d <= b;

  // главный расчёт. lib: игры, meta: данные RAWG, period: week | month | year
  function compute(lib, meta, period, now = new Date()) {
    const R = range(period, now); meta = meta || {};
    const daySet = new Set(R.days), perGame = {}, perDay = {}, plat = {}, emu = {}, genre = {}, prevDay = {};
    let total = 0, prevTotal = 0, sessions = 0, sessSec = 0, completed = [];
    for (const [id, g] of Object.entries(lib || {})) {
      const days = g.days || {}, dp = g.dp || {}, m = meta[id] || {};
      const gen = (g.genres && g.genres.length ? g.genres : m.genres) || [], fallbackPlat = ((g.playedOn || [])[0]) || 'pc';
      for (const [d, sec] of Object.entries(days)) {
        if (!(sec > 0)) continue;
        if (inR(d, R.prevStart, R.prevEnd)) { prevTotal += sec; continue; }
        if (!daySet.has(d)) continue;
        total += sec; perDay[d] = (perDay[d] || 0) + sec; perGame[id] = (perGame[id] || 0) + sec;
        const x = dp[d];
        if (x && x.p) { for (const [p, s] of Object.entries(x.p)) plat[p] = (plat[p] || 0) + s; } else plat[fallbackPlat] = (plat[fallbackPlat] || 0) + sec;
        if (x && x.e) for (const [e, s] of Object.entries(x.e)) emu[e] = (emu[e] || 0) + s;
        const gs = gen.length ? gen : [''];
        for (const n of gs) if (n) genre[n] = (genre[n] || 0) + sec / gs.length;
      }
      for (const s of g.sessions || []) { const d = String(s.s || '').slice(0, 10); if (daySet.has(d) || inR(d, R.start, R.end)) { sessions++; sessSec += +s.sec || 0; } }
      if (g.finished && inR(g.finished, R.start, R.end)) completed.push({id, name: g.name, finished: g.finished});
    }
    // столбцы: неделя и месяц по дням, год по месяцам
    let series;
    if (R.period === 'year') { const mo = Array(12).fill(0); for (const [d, s] of Object.entries(perDay)) mo[+d.slice(5, 7) - 1] += s; series = mo.map((sec, i) => ({label: MON[i], sec, key: `${R.start.slice(0, 4)}-${pad(i + 1)}`})); }
    else series = R.days.map((d, i) => ({label: R.period === 'week' ? WD[i] : String(+d.slice(8)), sec: perDay[d] || 0, key: d, today: d === R.today}));
    const activeDays = Object.values(perDay).filter(v => v >= 60).length;
    const top = (o, n, f) => Object.entries(o).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => f(k, v));
    const games = top(perGame, 5, (id, sec) => ({id, name: lib[id].name, sec, pct: total ? sec / total : 0}));
    const label = id => (D.PLATFORM_BY_ID[id] || {label: id}).label;
    return {
      range: R, period: R.period, total, prevTotal, delta: total - prevTotal, series, maxSec: Math.max(0, ...series.map(s => s.sec)),
      activeDays, avgPerDay: activeDays ? total / activeDays : 0, sessions, avgSession: sessions ? sessSec / sessions : 0,
      topGame: games[0] || null, games, completed: completed.sort((a, b) => b.finished.localeCompare(a.finished)),
      platforms: top(plat, 3, (id, sec) => ({id, label: label(id), sec, pct: total ? sec / total : 0})),
      emulators: top(emu, 3, (id, sec) => ({id, label: (require_emu(id) || {name: id}).name, sec})),
      genres: top(genre, 3, (n, sec) => ({name: (D.GENRE_RU && D.GENRE_RU[n]) || n, sec, pct: total ? sec / total : 0}))
    };
  }
  // названия эмуляторов нужны и в браузере, где lib/emulators.js нет: короткий справочник
  const EMU_NAMES = {duckstation: 'DuckStation', pcsx2: 'PCSX2', rpcs3: 'RPCS3', shadps4: 'shadPS4', ppsspp: 'PPSSPP', vita3k: 'Vita3K', cemu: 'Cemu', dolphin: 'Dolphin', ryujinx: 'Ryujinx', yuzu: 'yuzu / Eden', citra: 'Citra / Azahar',
    melonds: 'melonDS', desmume: 'DeSmuME', mgba: 'mGBA', vbam: 'VisualBoyAdvance-M', snes9x: 'Snes9x', bsnes: 'bsnes', mesen: 'Mesen', fceux: 'FCEUX', nestopia: 'Nestopia', project64: 'Project64', xenia: 'Xenia', xemu: 'xemu', retroarch: 'RetroArch'};
  function require_emu(id) { return EMU_NAMES[id] ? {name: EMU_NAMES[id]} : null; }

  // «3 ч 25 мин», «45 мин», «0 мин»
  function dur(sec) { const t = Math.round((+sec || 0) / 60), h = Math.floor(t / 60), m = t % 60; return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`; }
  // сравнение с прошлым периодом: «+2 ч 10 мин» / «−45 мин»
  function deltaText(sec) { const a = Math.abs(sec); return (sec > 0 ? '+' : sec < 0 ? '−' : '') + dur(a); }
  const PREV_WORD = {week: 'прошлой неделей', month: 'прошлым месяцем', year: 'прошлым годом'};
  const GAME_OF = {week: 'Игра недели', month: 'Игра месяца', year: 'Игра года'};

  // ---------- карточка (SVG 1080×1350, тёмная, только векторные значки) ----------
  const ICONS = {
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', calendar: '<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>', pad: '<path d="M6 12h4M8 10v4"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.3 5H6.7a4 4 0 0 0-3.9 3.2l-1.6 7.5A3 3 0 0 0 4 19c1 0 1.9-.5 2.4-1.3L8 15h8l1.6 2.7c.5.8 1.4 1.3 2.4 1.3a3 3 0 0 0 2.8-3.3l-1.6-7.5A4 4 0 0 0 17.3 5Z"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/>',
    up: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>', flat: '<path d="M5 12h14"/>'
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const icon = (n, x, y, size, color) => `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</g>`;

  function cardSvg(d) {
    const W = 1080, H = 1350, F = "font-family=\"Inter, 'Segoe UI', Arial, sans-serif\"", W1 = '#ffffff', M = '#8f8f8f', L = '#262626', P = 56;
    const o = [];
    const text = (x, y, s, size, o2 = {}) => o.push(`<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${o2.w || 500}" fill="${o2.c || W1}"${o2.a ? ` text-anchor="${o2.a}"` : ''}${o2.ls ? ` letter-spacing="${o2.ls}"` : ''}>${esc(s)}</text>`);
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="NEXUS Rewind: ${esc(d.range.label)}">`);
    o.push(`<rect width="${W}" height="${H}" fill="#000"/><rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="44" fill="#0a0a0a" stroke="${L}" stroke-width="2"/>`);
    // шапка: знак NEXUS (векторная «N»), название и период
    o.push(`<rect x="${P}" y="${P}" width="64" height="64" rx="18" fill="#000" stroke="#fff" stroke-width="3"/><path d="M${P + 18} ${P + 46} V${P + 18} H${P + 26} L${P + 38} ${P + 36} V${P + 18} H${P + 46} V${P + 46} H${P + 38} L${P + 26} ${P + 28} V${P + 46} Z" fill="#fff"/>`);
    text(P + 84, P + 30, 'NEXUS', 30, {w: 700, ls: 6}); text(P + 84, P + 60, 'Rewind · ' + PERIODS[d.period], 22, {c: M});
    text(W - P, P + 30, d.range.label, 26, {a: 'end', w: 600});
    // главное число
    text(P, 214, 'Всего наиграно', 24, {c: M}); text(P, 300, dur(d.total), 88, {w: 700});
    const up = d.delta > 0, down = d.delta < 0, dc = up ? '#d4d4d4' : down ? '#a3a3a3' : M;
    o.push(icon(up ? 'up' : down ? 'down' : 'flat', P, 326, 30, dc)); text(P + 44, 351, `${deltaText(d.delta)} по сравнению с ${PREV_WORD[d.period]}`, 24, {c: dc, w: 600});
    // гистограмма
    const cx = P, cy = 392, cw = W - 2 * P, ch = 300, n = d.series.length, gap = n > 12 ? 5 : 14, inner = cw - 48, w2 = (inner - gap * (n - 1)) / n, max = d.maxSec || 1;
    o.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch + 70}" rx="28" fill="#111" stroke="${L}" stroke-width="2"/>`);
    d.series.forEach((s, i) => {
      const h = s.sec ? Math.max(8, Math.round((ch - 70) * s.sec / max)) : 4, x = cx + 24 + i * (w2 + gap), y = cy + ch - 30 - h;
      o.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${w2.toFixed(1)}" height="${h}" rx="${Math.min(10, w2 / 2).toFixed(1)}" fill="${s.sec ? (s.today ? '#fff' : '#d4d4d4') : '#262626'}"/>`);
      if (n <= 12 || i % 5 === 0 || i === n - 1) text((x + w2 / 2).toFixed(1), cy + ch + 20, s.label, n > 12 ? 18 : 22, {a: 'middle', c: M});
      if (n <= 7 && s.sec) text((x + w2 / 2).toFixed(1), y - 12, dur(s.sec).replace(' мин', 'м').replace(' ч ', 'ч '), 18, {a: 'middle', c: '#d4d4d4'});
    });
    // три показателя
    const tw = (cw - 28) / 3, stat = (i, ic2, label, value) => { const x = P + i * (tw + 14); o.push(`<rect x="${x.toFixed(1)}" y="794" width="${tw.toFixed(1)}" height="124" rx="24" fill="#111" stroke="${L}" stroke-width="2"/>`, icon(ic2, x + 22, 814, 26, M)); text(x + 60, 834, label, 19, {c: M}); text(x + 22, 892, value, 34, {w: 700}); };
    stat(0, 'clock', 'Средняя сессия', d.sessions ? dur(d.avgSession) : '—'); stat(1, 'calendar', 'За день игры', d.activeDays ? dur(d.avgPerDay) : '—'); stat(2, 'trophy', 'Пройдено игр', String(d.completed.length));
    // игра периода
    o.push(`<rect x="${P}" y="942" width="${cw}" height="108" rx="24" fill="#111" stroke="${L}" stroke-width="2"/>`, icon('trophy', P + 28, 968, 30, '#fff'));
    text(P + 76, 984, GAME_OF[d.period], 20, {c: M});
    text(P + 76, 1028, d.topGame ? cut(d.topGame.name, 28) : 'Пока нет данных', 34, {w: 700}); if (d.topGame) text(W - P - 28, 1028, dur(d.topGame.sec), 30, {a: 'end', w: 600});
    // платформы/эмуляторы и жанры
    const colW = (cw - 14) / 2, col = (x, title, ic2, rows) => {
      o.push(`<rect x="${x}" y="1074" width="${colW}" height="224" rx="24" fill="#111" stroke="${L}" stroke-width="2"/>`, icon(ic2, x + 24, 1098, 24, M)); text(x + 60, 1117, title, 20, {c: M});
      rows.slice(0, 3).forEach((r, i) => { const y = 1168 + i * 42; text(x + 24, y, cut(r.label || r.name, 21), 24, {w: 600}); text(x + colW - 24, y, r.pct != null && !r.label ? Math.round(r.pct * 100) + '%' : dur(r.sec), 22, {a: 'end', c: M}); });
      if (!rows.length) text(x + 24, 1168, 'Нет данных', 22, {c: M});
    };
    col(P, d.emulators.length ? 'Платформы и эмуляторы' : 'Топ платформ', 'pad', d.emulators.length ? [...d.platforms.slice(0, 2), ...d.emulators.slice(0, 1).map(e => ({label: e.label + ' (эм.)', sec: e.sec}))] : d.platforms);
    col(P + colW + 14, 'Топ жанров', 'tag', d.genres.map(g => ({name: g.name, sec: g.sec, pct: g.pct})));
    text(W / 2, H - 24, 'Создано в NEXUS', 20, {a: 'middle', c: '#525252', ls: 2});
    o.push('</svg>');
    return o.join('');
  }
  return {PERIODS, range, compute, dur, deltaText, cardSvg, ymd, EMU_NAMES, PREV_WORD, GAME_OF};
});
