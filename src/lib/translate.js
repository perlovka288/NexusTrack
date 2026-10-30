'use strict';
// NEXUS: автоперевод описаний игр на русский. Порядок: DeepL (если есть ключ) → LibreTranslate (если указан адрес) → MyMemory (без ключа, но с дневным лимитом).
// Переведённые тексты кэшируются на диске, повторно один и тот же текст никуда не отправляется.
const crypto = require('crypto');

const cyr = s => (String(s).match(/[а-яё]/gi) || []).length;
const isRussian = s => { s = String(s || ''); const letters = (s.match(/[a-zа-яё]/gi) || []).length; return !letters || cyr(s) / letters > 0.4; };
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex');
// режем длинный текст по предложениям: у бесплатных переводчиков ограничен размер запроса
function chunks(text, max) {
  const out = []; let cur = '';
  for (const sent of String(text).replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/)) {
    if ((cur + ' ' + sent).trim().length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (sent.length > max) { for (let i = 0; i < sent.length; i += max) out.push(sent.slice(i, i + max)); continue; }
    cur += ' ' + sent;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
async function post(fetchFn, url, o, ms = 9000) { const r = await fetchFn(url, {...o, signal: AbortSignal.timeout(ms)}); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }

const providers = {
  async deepl(text, cfg, f) {
    const key = cfg.deepl; if (!key) throw new Error('no key');
    const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const j = await post(f, `https://${host}/v2/translate`, {method: 'POST', headers: {authorization: 'DeepL-Auth-Key ' + key, 'content-type': 'application/json'}, body: JSON.stringify({text: [text], target_lang: 'RU', source_lang: 'EN'})});
    const t = j.translations && j.translations[0] && j.translations[0].text; if (!t) throw new Error('empty'); return t;
  },
  async libre(text, cfg, f) {
    if (!cfg.libreUrl) throw new Error('no url');
    const j = await post(f, cfg.libreUrl.replace(/\/+$/, '') + '/translate', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({q: text, source: 'en', target: 'ru', format: 'text', api_key: cfg.libreKey || undefined})});
    if (!j.translatedText) throw new Error('empty'); return j.translatedText;
  },
  async mymemory(text, cfg, f) {
    const out = [];
    for (const c of chunks(text, 450)) {
      const j = await post(f, 'https://api.mymemory.translated.net/get?langpair=en|ru&q=' + encodeURIComponent(c) + (cfg.email ? '&de=' + encodeURIComponent(cfg.email) : ''), {});
      const t = j.responseData && j.responseData.translatedText;
      if (!t || +j.responseStatus !== 200 || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t)) throw new Error('limit');
      out.push(t);
    }
    return out.join(' ');
  }
};

// translate(text, {cfg: {deepl, libreUrl, libreKey, email}, cache: {}, fetch}) → {text, translated, via}
async function translate(text, o = {}) {
  text = String(text || '').trim(); const cache = o.cache || {}, f = o.fetch || fetch, cfg = o.cfg || {};
  if (!text || isRussian(text)) return {text, translated: false};
  const key = hash(text.slice(0, 4000)); if (cache[key]) return {text: cache[key], translated: true, via: 'cache'};
  const body = text.slice(0, 4000);
  for (const name of ['deepl', 'libre', 'mymemory']) {
    try {
      const t = String(await providers[name](body, cfg, f) || '').trim();
      if (t && cyr(t) > 0) { const keys = Object.keys(cache); if (keys.length > 1500) delete cache[keys[0]]; cache[key] = t; if (o.onSave) o.onSave(); return {text: t, translated: true, via: name}; }
    } catch { /* пробуем следующий */ }
  }
  return {text, translated: false};     // перевести не удалось: показываем оригинал
}
module.exports = {translate, isRussian, chunks};
