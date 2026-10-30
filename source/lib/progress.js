'use strict';
// NEXUS: реальный прогресс прохождения из сохранений игры.
// Читаем только текстовые сохранения (JSON/XML/INI/CFG/TXT) и ищем явные ключи:
// progress, completion, percentComplete, completed: true, «открыто N из M достижений».
// Если уверенности нет — возвращаем null, и интерфейс не показывает выдуманный процент.
const fs = require('fs'), path = require('path');

const TEXT_EXT = new Set(['.json', '.xml', '.ini', '.cfg', '.txt', '.conf', '.properties', '.yaml', '.yml', '.lua', '.sav', '.dat', '.profile']);
const SKIP_DIR = new Set(['cache', 'caches', 'logs', 'log', 'crash', 'crashes', 'temp', 'tmp', 'shadercache', 'screenshots', 'movies', 'backup', 'backups', 'node_modules', 'steamapps']);
const MAX_FILES = 400, MAX_SIZE = 1.5 * 1024 * 1024, MAX_DEPTH = 4;

const PCT_KEYS = ['progress', 'completion', 'percentcomplete', 'completionpercent', 'progresspercent', 'percent_complete', 'percent_completed', 'completionpercentage', 'progress_percent', 'completion_percentage', 'gameprogress', 'gamecompletion', 'storyprogress', 'campaignprogress'];
const DONE_KEYS = ['completed', 'iscompleted', 'gamecompleted', 'storycompleted', 'campaigncompleted', 'finished'];
const UNLOCKED_KEYS = ['achievementsunlocked', 'unlockedachievements', 'achievementsunlockedcount', 'unlockedachievementcount'];
const TOTAL_KEYS = ['achievementstotal', 'totalachievements', 'achievementscount', 'totalachievementcount'];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = list => list.map(esc).join('|');
const PCT_RX = new RegExp(`["']?(${alt(PCT_KEYS)})["']?\\s*[:=]\\s*["']?(-?\\d+(?:\\.\\d+)?)|<(${alt(PCT_KEYS)})>\\s*(-?\\d+(?:\\.\\d+)?)`, 'gi');
const DONE_RX = new RegExp(`["']?(${alt(DONE_KEYS)})["']?\\s*[:=]\\s*["']?(true|1)\\b|<(${alt(DONE_KEYS)})>\\s*(true|1)\\s*<`, 'gi');
const NUM_RX = list => new RegExp(`["']?(?:${alt(list)})["']?\\s*[:=]\\s*["']?(-?\\d+)`, 'i');

const isText = p => TEXT_EXT.has(path.extname(p).toLowerCase()) || /\.(sav|dat|profile)\.[a-z0-9]+$/i.test(p);
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));

// проценты в сохранении: 0..100, дробь 0..1 или шкала 0..1000
function pctOf(key, raw) {
  const v = +raw;
  if (!isFinite(v)) return null;
  if (v > 0 && v < 1) return v * 100;
  if (v >= 0 && v <= 100) return v;
  if (v > 100 && v <= 1000 && /percent|completion/.test(key)) return v / 10;
  return null;
}

function scanText(text) {
  let best = null;
  const take = (pct, conf, key) => {
    if (pct == null || !isFinite(pct)) return;
    pct = clamp(pct);
    if (!best || conf > best.conf || (conf === best.conf && pct > best.pct)) best = {pct, conf, key};
  };
  PCT_RX.lastIndex = 0;
  for (let m; (m = PCT_RX.exec(text));) {
    const key = (m[1] || m[3] || '').toLowerCase(), raw = m[2] ?? m[4];
    take(pctOf(key, raw), /percent|completion/.test(key) ? 9 : 7, key);
  }
  DONE_RX.lastIndex = 0;
  for (let m; (m = DONE_RX.exec(text));) {
    const key = (m[1] || m[3] || '').toLowerCase();
    if (m[2] === 'true' || m[2] === '1' || m[4] === 'true' || m[4] === '1') take(100, 4, key);
  }
  const un = (text.match(NUM_RX(UNLOCKED_KEYS)) || [])[1], tot = (text.match(NUM_RX(TOTAL_KEYS)) || [])[1];
  if (un != null && +tot > 0) take(+un / +tot * 100, 8, 'achievements');
  return best;
}

function readText(file) {
  let fd;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size < 12 || st.size > MAX_SIZE) return '';
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(st.size, MAX_SIZE));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n < 12) return '';
    // бинарные файлы отсеиваем: много нулевых байтов или «мусорных» символов
    const head = buf.subarray(0, Math.min(n, 4096));
    let bad = 0; for (const b of head) if (b === 0) bad++;
    if (bad > 4) return '';
    const s = buf.subarray(0, n).toString('utf8');
    const repl = (s.match(/\uFFFD/g) || []).length;
    return repl > s.length * 0.02 ? '' : s;
  } catch { return ''; }
  finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
}

function collect(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let list; try { list = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const d of list) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (!SKIP_DIR.has(d.name.toLowerCase()) && !d.name.startsWith('.')) walk(p, depth + 1); }
      else if (d.isFile() && isText(p)) {
        try { const st = fs.statSync(p); if (st.size >= 12 && st.size <= MAX_SIZE) out.push({p, m: st.mtimeMs || 0}); } catch {}
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.m - a.m).slice(0, MAX_FILES);
}

// сканирует папку (или один файл) и возвращает {pct, file, key} либо null
function scan(savePath) {
  if (!savePath) return null;
  let root = String(savePath);
  try { root = path.resolve(root); } catch { return null; }
  let files;
  try { files = fs.statSync(root).isDirectory() ? collect(root) : [{p: root, m: 0}]; } catch { return null; }
  let best = null;
  for (const f of files) {
    const r = scanText(readText(f.p));
    if (r && (!best || r.conf > best.conf || (r.conf === best.conf && r.pct > best.pct))) best = {...r, file: path.basename(f.p)};
  }
  return best ? {pct: best.pct, file: best.file, key: best.key} : null;
}

module.exports = {scan, scanText, pctOf};
