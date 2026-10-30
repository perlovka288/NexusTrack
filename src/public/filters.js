'use strict';
// NEXUS: фильтры, сортировка и вспомогательные расчёты для библиотеки. Работает и в браузере, и в Node (тесты).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog-data.js'), require('./search.js'));
  else root.NexusFilters = factory(root.NexusData, root.NexusSearch);
})(typeof self !== 'undefined' ? self : this, function (D, S) {

  const yearOf = s => { const m = String(s || '').match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/); return m ? +m[1] : 0; };
  const uniq = a => [...new Set(a.filter(Boolean))];
  // «Добавлены вручную»: свои карточки, пользовательские записи и игры, найденные через эмуляторы.
  const isManual = g => !!(g && (g.manual || g.src === 'custom' || g.emu));

  // всё, что известно об игре для фильтров: жанры, теги, платформы, год выхода (свои данные важнее данных RAWG)
  function info(id, g, m) {
    g = g || {}; m = m || {};
    const genres = uniq((g.genres && g.genres.length ? g.genres : m.genres) || []);
    const tags = uniq([...(g.tags || []), ...(m.tags || [])]).filter(t => !D.TAG_NOISE.has(t) && !D.TAG_HIDE.has(t));
    const platforms = uniq([...(g.playedOn || []).map(D.migratePlat), ...(m.v === 2 ? (m.platforms || []).map(D.platId) : [])]);
    const released = g.released || m.released || '';
    return {genres, tags, platforms, released, year: yearOf(released), played: g.playedOn || []};
  }

  // подходит ли игра под фильтры f; пустой фильтр = без ограничений, внутри одной группы работает «любой из выбранных»
  function matches(f, inf, g) {
    g = g || {};
    if (f.manual && !isManual(g)) return false;                                  // ручные и эмуляторные игры можно сочетать со статусом и «На устройстве»
    if (f.status === 'manual') { if (!isManual(g)) return false; }              // совместимость со старым значением вкладки
    else if (f.status === 'dev') { if (!g.installed) return false; }            // «На устройстве»: ставится автоматически
    else if (f.status && f.status !== 'all' && g.status !== f.status) return false;
    if (f.folder === 'fav') { if (!g.fav) return false; } else if (f.folder && !(g.folders || []).includes(f.folder)) return false;
    if (f.platforms && f.platforms.length && !f.platforms.some(p => inf.platforms.includes(p))) return false;
    if (f.genres && f.genres.length && !f.genres.some(x => inf.genres.includes(x))) return false;
    if (f.tags && f.tags.length && !D.tagMatches(f.tags, inf.tags)) return false;
    const from = +f.from || 0, to = +f.to || 0;
    if ((from || to) && !inf.year) return false;
    if (from && inf.year < from) return false;
    if (to && inf.year > to) return false;
    return true;
  }

  const ts = s => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };
  const num = v => +v || 0;
  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name, 'ru'),
    hours: (a, b) => num(b.g.hours) - num(a.g.hours),
    rating: (a, b) => num(b.g.rating) - num(a.g.rating),
    new: (a, b) => (b.inf.year || 0) - (a.inf.year || 0) || (a.inf.released < b.inf.released ? 1 : -1),
    old: (a, b) => (a.inf.year || 9999) - (b.inf.year || 9999),
    played: (a, b) => ts(b.g.last) - ts(a.g.last),
    added: (a, b) => ts(b.g.added) - ts(a.g.added),
    finished: (a, b) => (b.g.finished || '').localeCompare(a.g.finished || ''),
    platform: (a, b) => D.platRank(a.inf.platforms) - D.platRank(b.inf.platforms) || a.name.localeCompare(b.name, 'ru')
  };

  // список библиотеки: фильтры → поиск (если задан) → сортировка. Возвращает [[id, name], …]
  function filterLibrary(lib, meta, f) {
    f = f || {}; meta = meta || {};
    const rows = [];
    for (const [id, g] of Object.entries(lib)) {
      const inf = info(id, g, meta[id]);
      if (matches(f, inf, g)) rows.push({id, name: g.name || '', g, inf, alt: (meta[id] && meta[id].name) || ''});
    }
    const q = String(f.q || '').trim();
    if (q) {
      const ranked = S.rank(q, rows, {get: r => r.name, names: r => [r.alt], pop: r => r.g.fav ? 1 : Math.min(1, num(r.g.hours) / 100)});
      return ranked.map(r => [r.id, r.name]);                           // при поиске порядок задаёт релевантность: точное название первым
    }
    rows.sort(SORTS[f.sort] || SORTS.name);
    return rows.map(r => [r.id, r.name]);
  }

  // доступные значения для панелей фильтров: что реально есть в библиотеке, с количеством
  function facets(lib, meta) {
    meta = meta || {};
    const genres = {}, tags = {}, platforms = {}; let minY = 0, maxY = 0;
    for (const [id, g] of Object.entries(lib)) {
      const inf = info(id, g, meta[id]);
      for (const x of inf.genres) genres[x] = (genres[x] || 0) + 1;
      for (const x of inf.tags) { const k = D.tagKeyOf(x); tags[k] = (tags[k] || 0) + 1; }
      for (const x of inf.platforms) platforms[x] = (platforms[x] || 0) + 1;
      if (inf.year) { minY = minY ? Math.min(minY, inf.year) : inf.year; maxY = Math.max(maxY, inf.year); }
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
    return {genres: top(genres, 40), tags: top(tags, 60), platforms: Object.entries(platforms).sort((a, b) => D.platRank([a[0]]) - D.platRank([b[0]])), minYear: minY, maxYear: maxY};
  }

  // --- время: часы + минуты ---
  const totalMin = h => Math.max(0, Math.round((+h || 0) * 60));
  const hm = h => { const t = totalMin(h); return {h: Math.floor(t / 60), m: t % 60, total: t}; };
  // «3 ч 25 мин», «45 мин», «12 ч»; пусто, если времени нет
  function fmtHM(h, empty) {
    const {h: H, m: M, total} = hm(h);
    if (!total) return empty == null ? '' : empty;
    return H && M ? `${H} ч ${M} мин` : H ? `${H} ч` : `${M} мин`;
  }
  // часы из пары полей «часы» + «минуты»
  const fromHM = (h, m) => Math.round((Math.max(0, +h || 0) + Math.max(0, +m || 0) / 60) * 10000) / 10000;

  // прохождения: пройденные игры по годам и платформам (для профиля)
  function completed(lib, meta) {
    const out = [];
    for (const [id, g] of Object.entries(lib)) {
      if (g.status !== 'done') continue;
      const inf = info(id, g, (meta || {})[id]);
      out.push({id, name: g.name, g, year: yearOf(g.finished), finished: g.finished || '', platforms: inf.played.length ? inf.played : [], hours: num(g.hours)});
    }
    out.sort((a, b) => (b.finished || '').localeCompare(a.finished || '') || a.name.localeCompare(b.name, 'ru'));
    const byYear = {}, byPlat = {};
    for (const c of out) {
      const y = c.year || 0; (byYear[y] = byYear[y] || []).push(c);
      for (const p of c.platforms.length ? c.platforms : ['']) byPlat[p] = (byPlat[p] || 0) + 1;
    }
    return {list: out, byYear, byPlat, years: Object.keys(byYear).map(Number).sort((a, b) => (b || -1) - (a || -1))};
  }

  return {yearOf, info, matches, isManual, filterLibrary, facets, SORTS, totalMin, hm, fmtHM, fromHM, completed};
});
