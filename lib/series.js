'use strict';
// «Серия игр»: название франшизы по названиям её частей и порядок частей
const ROMAN = /^(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const norm = s => String(s).toLowerCase().replace(/[:;,.!?\-–—]+$/g, '');
const toks = n => String(n || '').replace(/\s*\((?:19|20)\d\d\)\s*/g, ' ').trim().split(/\s+/).filter(Boolean);
const trimTail = t => { t = t.slice(); while (t.length > 1 && (/^\d+$/.test(norm(t[t.length - 1])) || ROMAN.test(norm(t[t.length - 1])))) t.pop(); return t; };
const clean = t => t.join(' ').replace(/[:;,.\-–—\s]+$/, '');

// Название серии = самое длинное начало названий, общее хотя бы для половины частей
// (God of War, God of War II, God of War: Ascension → «God of War»)
function seriesName(names) {
  const lists = (names || []).map(toks).filter(l => l.length);
  if (!lists.length) return '';
  const need = Math.max(2, Math.ceil(lists.length / 2)), count = new Map(), keyOf = (l, k) => l.slice(0, k).map(norm).join(' ');
  for (const l of lists) { const seen = new Set(); for (let k = 1; k <= l.length; k++) { const key = keyOf(l, k); if (!seen.has(key)) { seen.add(key); count.set(key, (count.get(key) || 0) + 1); } } }
  let best = null;
  for (const l of lists) for (let k = 1; k <= l.length; k++) {
    const c = count.get(keyOf(l, k));
    if (c >= need && (!best || k > best.k || (k === best.k && c > best.c))) best = {k, c, t: l.slice(0, k)};
  }
  if (best) { const r = clean(trimTail(best.t)); if (r) return r; }
  const short = lists.slice().sort((a, b) => a.join(' ').length - b.join(' ').length)[0];
  return clean(trimTail(short.join(' ').split(/\s*[:–—]\s*/)[0].split(/\s+/)));
}

// части по порядку выхода; без даты — в конец
const sortParts = a => a.slice().sort((x, y) => {
  const dx = x.released || '9999', dy = y.released || '9999';
  return dx < dy ? -1 : dx > dy ? 1 : String(x.name).localeCompare(String(y.name), 'en', {numeric: true});
});

module.exports = {seriesName, sortParts};
