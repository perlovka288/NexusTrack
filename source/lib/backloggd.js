'use strict';
// Backloggd: публичные страницы каталога. Официального API каталога нет, поэтому читаем HTML.
// Модуль только собирает названия, обложки, оценки и даты. Любая ошибка сети не критична:
// вызывающий код обязан уметь откатиться на RAWG.

const BASE = 'https://backloggd.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TTL = 6 * 60 * 60 * 1000;
const memo = new Map();
const T = ms => AbortSignal.timeout(ms);

const ENT = {'&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' '};
const decode = s => String(s == null ? '' : s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&(amp|quot|#39|#x27|lt|gt|nbsp);/g, m => ENT[m] || m)
  .replace(/\s+/g, ' ')
  .trim();

async function page(path, ttl = TTL) {
  const url = BASE + path;
  const hit = memo.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.text;
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9'
    },
    signal: T(15000)
  });
  if (!r.ok) throw new Error('Backloggd HTTP ' + r.status);
  const text = await r.text();
  if (!text || text.length < 200) throw new Error('Backloggd: пустой ответ');
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  memo.set(url, {t: Date.now(), text});
  return text;
}

// карточка каталога: game_id, slug, название, обложка, оценка (0–5), дата релиза
function parseCards(html) {
  const out = [], parts = String(html || '').split(/class="card mx-auto game-cover/).slice(1);
  for (const block of parts) {
    const id = (block.match(/game_id="(\d+)"/) || [])[1];
    if (!id) continue;
    const title = decode(
      (block.match(/class="game-text-centered"[^>]*>([^<]+)</) || [])[1] ||
      (block.match(/<img[^>]*\balt="([^"]*)"/) || [])[1] || ''
    );
    if (!title) continue;
    const cover = decode((block.match(/<img[^>]*\bsrc="([^"]+)"/) || [])[1] || '');
    const rating = +(block.match(/avg-rating[^>]*>\s*([\d.]+)/) || [])[1] || 0;
    const release = decode((block.match(/release-below"[^>]*>([^<]+)</) || [])[1] || '');
    const slug = (block.match(/href="\/games\/([^"/]+)\//) || [])[1] || '';
    out.push({id, slug, name: title, cover, rating, release});
  }
  return out;
}

// подсказки поиска: id, название, год, обложка
function parseAutocomplete(html) {
  const out = [];
  const re = /href="\/native\/log\/edit\/(\d+)\/"/g;
  const marks = [...String(html || '').matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const block = html.slice(marks[i].index, marks[i + 1] ? marks[i + 1].index : undefined);
    const name = decode((block.match(/class="[^"]*game-title[^"]*"[^>]*>([^<]+)</) || [])[1] || (block.match(/<img[^>]*\balt="([^"]*)"/) || [])[1] || '');
    if (!name) continue;
    const cover = decode((block.match(/<img[^>]*\bsrc="([^"]+)"/) || [])[1] || '');
    const year = +(block.match(/class="[^"]*subtitle-text[^"]*"[^>]*>(\d{4})</) || [])[1] || 0;
    out.push({id: marks[i][1], name, cover, year});
  }
  return out;
}

const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
function parseDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m = t.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return new Date(Date.UTC(+m[3], mon - 1, +m[2]));
  }
  m = t.match(/^(\d{4})$/); if (m) return new Date(Date.UTC(+m[1], 0, 1));
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return new Date(Date.UTC(+m[3], mon - 1, +m[1]));
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function list(kind, pageNo = 1) {
  const k = ['popular', 'rating', 'release', 'trending'].includes(kind) ? kind : 'popular';
  const path = `/games/lib/${k}/` + (pageNo > 1 ? `?page=${pageNo}` : '');
  return parseCards(await page(path));
}

async function autocomplete(query) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return [];
  return parseAutocomplete(await page('/search/autocomplete?query=' + encodeURIComponent(q), 30 * 60 * 1000));
}

module.exports = {list, autocomplete, parseCards, parseAutocomplete, parseDate, decode, BASE};
