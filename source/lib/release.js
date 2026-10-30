'use strict';
// Подготовка релиза из админки: сборка app.asar из папки с файлами приложения, чтение готового .asar,
// самопроверка (чтобы не разослать всем сломанную версию) и SHA-256.
// Без внешних библиотек: формат asar простой (заголовок JSON + склеенные файлы).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');

const BLOCK = 4 * 1024 * 1024;
// Файлы, без которых обновлённое приложение не запустится или потеряет возможность обновляться дальше.
const REQUIRED = ['package.json', 'main.js', 'server.js', 'lib/cloud.js', 'lib/updater.js', 'lib/preload.js', 'public/index.html',
  'node_modules/@supabase/supabase-js/package.json', 'node_modules/electron-store/package.json'];
const SKIP_NAMES = new Set(['.git', '.github', '.vscode', '.idea', 'dist', 'out', 'node_modules', '.DS_Store', 'Thumbs.db']);
const VER_RE = /^\d+\.\d+\.\d+$/;

// ---------- SHA-256 файла (потоком) ----------
function sha256File(file) {
  return new Promise((ok, no) => {
    const h = crypto.createHash('sha256'), s = fs.createReadStream(file);
    s.on('data', c => h.update(c)); s.on('error', no); s.on('end', () => ok(h.digest('hex')));
  });
}

// ---------- чтение .asar ----------
function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const a = Buffer.alloc(16);
    if (fs.readSync(fd, a, 0, 16, 0) < 16 || a.readUInt32LE(0) !== 4) throw new Error('Это не .asar файл.');
    const pickleSize = a.readUInt32LE(4), jsonLen = a.readUInt32LE(12);
    if (!jsonLen || jsonLen > 64 * 1024 * 1024) throw new Error('Повреждённый заголовок .asar.');
    const j = Buffer.alloc(jsonLen);
    fs.readSync(fd, j, 0, jsonLen, 16);
    return {header: JSON.parse(j.toString('utf8')), base: 8 + pickleSize};
  } finally { fs.closeSync(fd); }
}
function nodeAt(header, rel) {
  let n = header;
  for (const part of rel.split('/')) { if (!n || !n.files || !n.files[part]) return null; n = n.files[part]; }
  return n;
}
function readFromAsar(file, rel, hdr) {
  hdr = hdr || readHeader(file);
  const n = nodeAt(hdr.header, rel);
  if (!n || n.files || n.link) return null;
  const buf = Buffer.alloc(n.size), fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, n.size, hdr.base + Number(n.offset)); } finally { fs.closeSync(fd); }
  return buf;
}

// ---------- самопроверка собранного/выбранного .asar ----------
// Возвращает {version, notes[]}; бросает понятную ошибку, если файл нельзя раздавать.
function inspectAsar(file) {
  let hdr; try { hdr = readHeader(file); } catch (e) { throw new Error(e.message || 'Не удалось прочитать .asar'); }
  const missing = REQUIRED.filter(r => { const n = nodeAt(hdr.header, r); return !n || n.files; });
  if (missing.length) throw new Error('В файле нет обязательных частей приложения: ' + missing.join(', ') + '. Раздавать такую версию нельзя: приложение у всех перестанет запускаться.');
  let pkg; try { pkg = JSON.parse(readFromAsar(file, 'package.json', hdr).toString('utf8')); } catch { throw new Error('package.json внутри файла повреждён.'); }
  if (!VER_RE.test(String(pkg.version || ''))) throw new Error('В package.json версия должна быть вида 1.2.3, сейчас: ' + (pkg.version || 'не указана'));
  if (pkg.main !== 'main.js') throw new Error('В package.json поле "main" должно быть "main.js".');
  // синтаксис ключевых файлов: ошибка в main.js убила бы приложение у всех пользователей
  const bad = [];
  for (const rel of ['main.js', 'server.js', 'lib/cloud.js', 'lib/updater.js', 'lib/preload.js']) {
    try { new vm.Script(readFromAsar(file, rel, hdr).toString('utf8'), {filename: rel}); } catch (e) { bad.push(rel + ': ' + e.message); }
  }
  if (bad.length) throw new Error('Синтаксическая ошибка в файле: ' + bad.join('; '));
  // у каждой библиотеки внутри файла должны быть все её обязательные зависимости (иначе приложение упадёт при запуске с «Cannot find module»)
  const missingDeps = [];
  (function scan(node, rel) {
    if (!node || !node.files) return;
    const parts = rel.split('/'), par = parts[parts.length - 2], isPkgDir = par === 'node_modules' || (par && par.startsWith('@') && parts[parts.length - 3] === 'node_modules');
    if (isPkgDir && node.files['package.json'] && !node.files['package.json'].files) {
      let pj; try { pj = JSON.parse(readFromAsar(file, rel + '/package.json', hdr).toString('utf8')); } catch { pj = null; }
      if (pj) for (const d of Object.keys(pj.dependencies || {})) {
        const f = findDep(path.posix, 'node_modules', rel, d, p => { const n = nodeAt(hdr.header, p + '/package.json'); return !!(n && !n.files); });
        if (!f) missingDeps.push(d + ' (для ' + rel.replace(/^node_modules\//, '') + ')');
      }
    }
    for (const [k, v] of Object.entries(node.files)) if (v.files && (rel || k === 'node_modules')) scan(v, rel ? rel + '/' + k : k);
  })(nodeAt(hdr.header, 'node_modules'), 'node_modules');
  if (missingDeps.length) throw new Error('В файле не хватает библиотек: ' + [...new Set(missingDeps)].slice(0, 6).join('; ') + '. Раздавать такую версию нельзя: приложение у всех не запустится.');
  const notes = [];
  const upd = readFromAsar(file, 'lib/updater.js', hdr).toString('utf8');
  if (!/apply/.test(upd) || !/download/.test(upd)) notes.push('В updater.js не нашёл apply/download: проверьте, что обновления дальше будут работать.');
  return {version: pkg.version, notes};
}

// ---------- запись .asar ----------
function walk(dir, rel, out, skip) {
  let ents; try { ents = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of ents) {
    if (skip && skip(e.name, rel)) continue;
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(abs, r, out, skip);
    else if (e.isFile()) out.push({abs, rel: r});
  }
}
function writeAsar(outFile, entries) {
  const root = {files: {}}; let offset = 0;
  const bufs = [];
  for (const e of entries) {
    const data = fs.readFileSync(e.abs), parts = e.rel.split('/'); let n = root;
    for (let i = 0; i < parts.length - 1; i++) n = n.files[parts[i]] = n.files[parts[i]] || {files: {}};
    const blocks = []; for (let o = 0; o < data.length; o += BLOCK) blocks.push(crypto.createHash('sha256').update(data.subarray(o, o + BLOCK)).digest('hex'));
    if (!blocks.length) blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
    n.files[parts[parts.length - 1]] = {size: data.length, offset: String(offset),
      integrity: {algorithm: 'SHA256', hash: crypto.createHash('sha256').update(data).digest('hex'), blockSize: BLOCK, blocks}};
    offset += data.length; bufs.push(data);
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8'), pad = (4 - (json.length % 4)) % 4;
  const payload = 4 + json.length + pad;               // длина строки (4) + строка + выравнивание
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0); head.writeUInt32LE(payload + 4, 4); head.writeUInt32LE(payload, 8); head.writeUInt32LE(json.length, 12);
  const fd = fs.openSync(outFile, 'w');
  try {
    fs.writeSync(fd, head); fs.writeSync(fd, json); if (pad) fs.writeSync(fd, Buffer.alloc(pad));
    for (const b of bufs) { let o = 0; while (o < b.length) o += fs.writeSync(fd, b, o, b.length - o); }
  } finally { fs.closeSync(fd); }
}

// ---------- сборка app.asar из папки с проектом ----------
// folder: папка, где лежат package.json и main.js. Берём то, что перечислено в build.files (main.js, server.js, lib, public, assets…),
// а node_modules: из этой папки, а если её там нет, то из установленного приложения (fallbackModules).
// Поиск зависимости так же, как это делает Node: сначала node_modules самого пакета, затем соседние пакеты и выше до корня node_modules.
// P: модуль path (path для диска, path.posix для путей внутри asar); isPkg(p): есть ли пакет по этому пути.
function findDep(P, nmRoot, pkgDir, name, isPkg) {
  let dir = pkgDir;
  for (let i = 0; i < 60; i++) {
    const own = P.join(dir, 'node_modules', name);
    if (isPkg(own)) return own;
    let up = P.dirname(dir);
    if (P.basename(up).startsWith('@')) up = P.dirname(up);
    const atRoot = P.resolve(up) === P.resolve(nmRoot);
    if (!atRoot && P.basename(up) !== 'node_modules') return null;
    const sib = P.join(up, name);
    if (isPkg(sib)) return sib;
    if (atRoot) return null;
    dir = P.dirname(up);
  }
  return null;
}
// Все нужные папки пакетов вместе с вложенными (p-locate/node_modules/p-limit и т.п.). Возвращает Map: папка → путь внутри node_modules.
// Если обязательной зависимости нет, бросает понятную ошибку: такую сборку нельзя раздавать.
function depClosure(nmRoot, names) {
  const isPkg = d => { try { return fs.statSync(path.join(d, 'package.json')).isFile(); } catch { return false; } };
  const seen = new Map(), queue = [], missing = [];
  for (const n of names) queue.push({dir: path.join(nmRoot, ...n.split('/')), need: true, from: 'проект'});
  while (queue.length) {
    const {dir, need, from} = queue.shift();
    if (seen.has(dir)) continue;
    if (!isPkg(dir)) { if (need) missing.push(path.relative(nmRoot, dir).split(path.sep).join('/') + ' (нужна для ' + from + ')'); continue; }
    seen.set(dir, path.relative(nmRoot, dir).split(path.sep).join('/'));
    let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const rel = path.relative(nmRoot, dir).split(path.sep).join('/');
    for (const d of Object.keys(pj.dependencies || {})) {
      const f = findDep(path, nmRoot, dir, d, isPkg);
      if (f) queue.push({dir: f, need: true, from: rel}); else missing.push(d + ' (нужна для ' + rel + ')');
    }
    for (const d of Object.keys(pj.optionalDependencies || {})) { const f = findDep(path, nmRoot, dir, d, isPkg); if (f) queue.push({dir: f, need: false, from: rel}); }
  }
  if (missing.length) throw new Error('В node_modules не хватает библиотек: ' + [...new Set(missing)].slice(0, 6).join('; ') + '. Выполните npm install в папке проекта.');
  return seen;
}
function buildFromFolder(folder, outFile, {fallbackModules} = {}) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); }
  catch { throw new Error('В выбранной папке нет package.json. Выберите папку, где лежат package.json и main.js (например, source).'); }
  if (!fs.existsSync(path.join(folder, 'main.js'))) throw new Error('В выбранной папке нет main.js. Выберите папку проекта (где package.json и main.js).');
  if (!VER_RE.test(String(pkg.version || ''))) throw new Error('В package.json версия должна быть вида 1.2.3');
  const patterns = (pkg.build && Array.isArray(pkg.build.files) ? pkg.build.files : ['main.js', 'server.js', 'lib/**', 'public/**', 'assets/**', 'package.json']);
  const tops = new Set(patterns.map(p => String(p).replace(/^\.?\//, '').split('/')[0]).filter(t => t && !t.startsWith('!') && !t.includes('*')));
  tops.add('package.json');
  const entries = [];
  for (const t of tops) {
    const abs = path.join(folder, t); let st; try { st = fs.statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, t, entries, name => SKIP_NAMES.has(name)); else if (st.isFile()) entries.push({abs, rel: t});
  }
  if (!entries.some(e => e.rel === 'main.js')) throw new Error('main.js не попал в сборку: проверьте build.files в package.json.');
  // зависимости
  const own = path.join(folder, 'node_modules'), src = fs.existsSync(own) ? own : fallbackModules;
  const names = Object.keys(pkg.dependencies || {});
  let usedFallback = !fs.existsSync(own);
  if (names.length) {
    if (!src || !fs.existsSync(src)) throw new Error('Не нашёл node_modules с зависимостями (' + names.join(', ') + '). Выполните npm install в папке проекта.');
    const mods = depClosure(src, names);
    for (const [dir, rel] of mods) walk(dir, 'node_modules/' + rel, entries, n => n === '.bin' || n === '.DS_Store' || n === 'node_modules');
  }
  writeAsar(outFile, entries);
  return {version: pkg.version, files: entries.length, usedFallback};
}

module.exports = {sha256File, inspectAsar, readHeader, readFromAsar, buildFromFolder, writeAsar, VER_RE};
