'use strict';
// NEXUS: Nintendo Switch — сейвы эмуляторов, бэкапы JKSV/Checkpoint, консоль по MTP и FTP.
// Платформа одна: Nintendo Switch. Названия эмуляторов и Atmosphere в интерфейс не попадают.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const {execFile} = require('child_process');
const S = require('../public/search.js');

const TID_RE = /\b(0100[0-9a-f]{12})\b/i;
const TID_ONLY = /^0100[0-9a-f]{12}$/i;
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ls = p => { try { return fs.readdirSync(p, {withFileTypes: true}); } catch { return []; } };
const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'game';
const iso = d => new Date(d || Date.now()).toISOString();
const day = d => { const x = new Date(d || Date.now()); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

// ---------- сейвы ПК-эмуляторов ----------
function emulatorRoots(env = process.env, home = os.homedir()) {
  const a = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const list = [
    {id: 'yuzu', name: 'Yuzu', dir: path.join(a, 'yuzu', 'nand', 'user', 'save')},
    {id: 'sudachi', name: 'Sudachi', dir: path.join(a, 'sudachi', 'nand', 'user', 'save')},
    {id: 'suyu', name: 'Suyu', dir: path.join(a, 'suyu', 'nand', 'user', 'save')},
    {id: 'eden', name: 'Eden', dir: path.join(a, 'eden', 'nand', 'user', 'save')},
    {id: 'citron', name: 'Citron', dir: path.join(a, 'citron', 'nand', 'user', 'save')},
    {id: 'ryujinx', name: 'Ryujinx', dir: path.join(a, 'Ryujinx', 'bis', 'user', 'save')},
    {id: 'ryujinx-portable', name: 'Ryujinx portable', dir: path.join(a, 'Ryujinx', 'portable', 'bis', 'user', 'save')}
  ];
  return list.filter(r => isDir(r.dir));
}

// размер, число файлов и самая свежая дата внутри папки сейва
function measure(dir, limit = 4000) {
  let files = 0, bytes = 0, mtime = 0; const stack = [dir];
  while (stack.length && files < limit) {
    const d = stack.pop();
    for (const e of ls(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { files++; try { const st = fs.statSync(p); bytes += st.size; if (st.mtimeMs > mtime) mtime = st.mtimeMs; } catch {} }
    }
  }
  return {files, bytes, mtime, capped: files >= limit};
}

// папки сейвов: <root>/<uid>/<TitleID>/... и <root>/<TitleID>/...
function scanRoot(root, source) {
  const out = [];
  const visit = (dir, depth) => {
    for (const e of ls(dir)) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (TID_ONLY.test(e.name)) {
        const m = measure(p);
        if (m.files) out.push({titleId: e.name.toUpperCase(), name: '', path: p, source, mtime: m.mtime, files: m.files, bytes: m.bytes});
        continue;
      }
      if (depth < 2) visit(p, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function scanEmulators(cfg = {}) {
  const roots = emulatorRoots();
  const extra = (cfg.emulatorDirs || []).filter(Boolean).map((d, i) => ({id: 'custom' + i, name: 'Своя папка', dir: d}));
  const all = [...roots, ...extra.filter(r => isDir(r.dir))];
  const byId = new Map();
  for (const r of all) for (const s of scanRoot(r.dir, r.id)) {
    const prev = byId.get(s.titleId);
    if (!prev || s.mtime > prev.mtime) byId.set(s.titleId, {...s, sourceName: r.name});
  }
  return {roots: all.map(r => ({id: r.id, name: r.name, path: r.dir})), saves: [...byId.values()]};
}

// Title ID из названия, пути к образу или уже сохранённого поля
function titleIdOf(g) {
  for (const v of [g && g.titleId, g && g.switchTitleId, g && g.launch, g && g.dir, g && g.savePath, g && g.name]) {
    const m = String(v || '').match(TID_RE);
    if (m) return m[1].toUpperCase();
  }
  return '';
}

// название из папки бэкапа: «The Legend of Zelda [0100...]», «0100... The Legend of Zelda»
function cleanBackupName(n) {
  return String(n || '').replace(TID_RE, ' ').replace(/[_]+/g, ' ').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchGame(lib, save) {
  const tid = save.titleId || '';
  if (tid) for (const [id, g] of Object.entries(lib)) if (titleIdOf(g) === tid) return id;
  const name = cleanBackupName(save.name || '');
  if (!name) return null;
  let best = null;
  for (const [id, g] of Object.entries(lib)) {
    if (!g || !g.name) continue;
    const sc = Math.max(S.score(name, g.name), S.score(S.cleanName(name), S.cleanName(g.name)));
    if (sc >= 900 && (!best || sc > best.sc)) best = {id, sc};
  }
  return best ? best.id : null;
}

// отметить активность в библиотеке; первый скан только запоминает состояние
function applySave(store, id, save, opts = {}) {
  const g = store.data.library[id]; if (!g) return false;
  const prev = g.switchSave || null;
  const changed = !!opts.force || (!!prev && ((save.hash && save.hash !== prev.hash) || (!save.hash && save.mtime && prev.mtime && save.mtime > prev.mtime + 1000)));
  const stamp = save.mtime || Date.now();
  g.switchSave = {source: save.source || 'emulator', titleId: save.titleId || titleIdOf(g), path: save.path || '', mtime: save.mtime || 0, files: save.files || 0, bytes: save.bytes || 0, hash: save.hash || '', at: iso()};
  if (save.titleId) g.titleId = save.titleId;
  if (!Array.isArray(g.playedOn)) g.playedOn = [];
  if (!g.playedOn.includes('switch')) g.playedOn.push('switch');
  if (changed) {
    g.last = iso(stamp);
    if (!g.firstPlayed) g.firstPlayed = iso(stamp);
    if (store.data.config.tracker?.autoStatus && (!g.status || g.status === 'planned' || g.status === 'dropped')) g.status = 'playing';
  }
  store.save('library');
  return changed;
}

// ---------- приложение NEXUS Switch: время из системного журнала консоли ----------
// Данные приходят по Wi-Fi: суммарное время по игре, дни и сессии. Повторная синхронизация
// не удваивает часы: храним предыдущий итог в g.switchPlay и добавляем только разницу.
const tsIso = v => {
  if (!v) return '';
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return n && !isNaN(n) ? iso(n) : '';
};
const msTs = v => { const n = +v || 0; return n && n < 1e12 ? n * 1000 : n; };

function applyCompanion(store, payload = {}) {
  const lib = store.data.library || {};
  const titles = Array.isArray(payload.titles) ? payload.titles : [];
  const at = tsIso(payload.at) || iso();
  const result = {ok: true, at, matched: 0, updated: 0, added: 0, games: [], unmatched: []};
  const autoAdd = store.data.config?.switch?.companion?.autoAdd !== false;
  let changed = false;
  for (const t of titles) {
    if (!t || typeof t !== 'object') continue;
    const tid = String(t.titleId || '').trim().toUpperCase();
    const name = String(t.name || '').trim();
    const total = Math.max(0, Math.round(+t.seconds || 0));
    if (!tid && !name) continue;
    let id = matchGame(lib, {titleId: TID_ONLY.test(tid) ? tid : '', name});
    if (!id && autoAdd && name && total > 0 && t.installed === true) {   // добавляем только игры, помеченные приложением как установленные
      // игры нет в библиотеке: создаём её автоматически из журнала консоли
      const clean = name.replace(/[\u00ae\u2122]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || name;
      const base = 'sw' + (TID_ONLY.test(tid) ? tid.toLowerCase() : crypto.createHash('md5').update(clean.toLowerCase()).digest('hex').slice(0, 12));
      id = base; let n = 1;
      while (lib[id]) id = base + '-' + (n++);
      lib[id] = {name: clean, status: 'planned', hours: '', rating: '', note: '', added: iso(), playedOn: ['switch'], ...(TID_ONLY.test(tid) ? {titleId: tid} : {})};
      result.added++; changed = true;
    }
    if (!id) { result.unmatched.push({titleId: tid, name, seconds: total}); continue; }
    const g = lib[id], prev = g.switchPlay || {};
    const prevTotal = Math.max(0, Math.round(+prev.totalSeconds || 0));
    const delta = Math.max(0, total - prevTotal);
    const first = tsIso(t.first) || prev.first || '';
    const last = tsIso(t.last) || prev.last || '';
    const prevDays = prev.days && typeof prev.days === 'object' ? prev.days : {};
    const mergedDays = {...prevDays};
    const days = t.days && typeof t.days === 'object' ? t.days : {};
    let dayChanged = false;
    for (const [d, s] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const val = Math.max(0, Math.round(+s || 0));
      const old = Math.max(0, Math.round(+prevDays[d] || 0));
      mergedDays[d] = Math.max(old, val);
      const dd = Math.max(0, val - old);
      if (!dd) continue;
      g.days = g.days || {};
      g.days[d] = Math.round(((+g.days[d] || 0) + dd) * 10) / 10;
      g.dp = g.dp || {};
      const dpd = g.dp[d] || (g.dp[d] = {p: {}});
      dpd.p = dpd.p || {};
      dpd.p.switch = Math.round(((+dpd.p.switch || 0) + dd) * 1000) / 1000;
      dayChanged = true;
    }
    // если приложение прислало только итог, относим разницу к дню последнего запуска
    if (!Object.keys(days).length && delta > 0) {
      const d = last ? day(last) : day();
      g.days = g.days || {};
      g.days[d] = Math.round(((+g.days[d] || 0) + delta) * 10) / 10;
      g.dp = g.dp || {};
      const dpd = g.dp[d] || (g.dp[d] = {p: {}});
      dpd.p = dpd.p || {};
      dpd.p.switch = Math.round(((+dpd.p.switch || 0) + delta) * 1000) / 1000;
      dayChanged = true;
    }
    if (delta > 0) {
      g.hours = Math.round(((+g.hours || 0) + delta / 3600) * 1e6) / 1e6;
      changed = true;
    }
    if (Array.isArray(t.sessions)) {
      const have = new Set((g.sessions || []).map(s => `${s.s}|${s.e}|${s.plat || ''}`));
      for (const s of t.sessions) {
        const st = msTs(s.s), en = msTs(s.e);
        const sec = Math.max(0, Math.round(+s.sec || (en > st ? (en - st) / 1000 : 0)));
        if (!st || sec < 30) continue;
        const key = `${st}|${en}|switch`;
        if (have.has(key)) continue;
        have.add(key);
        (g.sessions = g.sessions || []).push({s: st, e: en, sec, plat: 'switch'});
        if (g.sessions.length > 500) g.sessions.shift();
        changed = true;
      }
    }
    g.switchPlay = {titleId: tid || prev.titleId || '', name: name || prev.name || '', totalSeconds: Math.max(prevTotal, total), days: mergedDays, first, last, at};
    if (tid && !g.titleId) { g.titleId = tid; changed = true; }
    if (!Array.isArray(g.playedOn)) g.playedOn = [];
    if (!g.playedOn.includes('switch')) { g.playedOn.push('switch'); changed = true; }
    if (last && (!g.last || Date.parse(last) > Date.parse(g.last))) { g.last = last; changed = true; }
    if (first && !g.firstPlayed) { g.firstPlayed = first; changed = true; }
    // «Играю» ставим только недавним играм: при первой синхронизации приходят все исторические часы,
    // иначе вся библиотека разом стала бы «Играю».
    const recent = !!last && Date.now() - Date.parse(last) < 7 * 864e5;
    if (total > 0 && recent && store.data.config.tracker?.autoStatus !== false && (!g.status || g.status === 'planned' || g.status === 'dropped')) { g.status = 'playing'; changed = true; }
    result.matched++;
    if (delta || dayChanged) result.updated++;
    result.games.push({id, name: g.name, titleId: tid, seconds: total, delta});
  }
  if (changed) store.save('library');
  return result;
}

// ---------- JKSV / Checkpoint ----------
function findBackupRoots(dir) {
  const out = [];
  const add = d => { if (isDir(d) && !out.includes(d)) out.push(d); };
  add(dir);
  for (const sub of ['saves', 'save', 'JKSV', 'Checkpoint', 'backups']) add(path.join(dir, sub));
  return out;
}

function importBackups(store, dir) {
  if (!isDir(dir)) throw new Error('Папка не найдена');
  const lib = store.data.library, result = {found: 0, matched: 0, updated: 0, items: []};
  const seen = new Set();
  for (const root of findBackupRoots(dir)) {
    for (const e of ls(root)) {
      if (!e.isDirectory()) continue;
      const p = path.join(root, e.name);
      if (seen.has(p)) continue; seen.add(p);
      const tid = (e.name.match(TID_RE) || [])[1]?.toUpperCase() || '';
      const name = cleanBackupName(e.name);
      const m = measure(p);
      if (!m.files) continue;
      result.found++;
      const id = matchGame(lib, {titleId: tid, name});
      if (!id) { result.items.push({name: e.name, titleId: tid, matched: false}); continue; }
      result.matched++;
      const changed = applySave(store, id, {titleId: tid, name, path: p, source: 'backup', mtime: m.mtime, files: m.files, bytes: m.bytes}, {force: true});
      if (changed) result.updated++;
      result.items.push({name: lib[id].name, titleId: tid, matched: true, id, updated: changed});
    }
  }
  return result;
}

// ---------- MTP (консоль подключена по USB) ----------
const MTP_PS = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$names=@(__NAMES__)
$pairs=@(__PAIRS__)
$dest=__DEST__
$shell=New-Object -ComObject Shell.Application
$pc=$shell.NameSpace(17)
$dev=$pc.Items() | Where-Object { $_.Name -eq 'Switch' }
if(-not $dev){ @{ok=$false;error='not-connected'}|ConvertTo-Json -Compress; exit }
$root=$shell.NameSpace($dev.Path)
$sv=$root.Items() | Where-Object { $_.Name -like '7:*' } | Select-Object -First 1
if(-not $sv){ @{ok=$false;error='no-saves'}|ConvertTo-Json -Compress; exit }
$saves=$sv.GetFolder
$inst=($saves.Items() | Where-Object { $_.Name -eq 'Installed games' }).GetFolder
if(-not $inst){ @{ok=$false;error='no-games'}|ConvertTo-Json -Compress; exit }
$items=@()
foreach($g in $inst.Items()){
  if($names.Count -gt 0 -and $names -notcontains $g.Name){ continue }
  $gf=$g.GetFolder
  $profiles=@()
  foreach($p in $gf.Items()){
    if(-not $p.IsFolder){ continue }
    $pf=$p.GetFolder
    $files=@()
    foreach($f in $pf.Items()){
      if($f.IsFolder){ continue }
      $files += @{n=$f.Name}
    }
    $profiles += @{name=$p.Name; files=$files}
  }
  $items += @{name=$g.Name; profiles=$profiles}
}
$copied=@()
if($pairs.Count -gt 0){
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $destNs=$shell.NameSpace($dest)
  foreach($pair in $pairs){
    $g=$inst.Items() | Where-Object { $_.Name -eq $pair.n } | Select-Object -First 1
    if(-not $g){ continue }
    $target=Join-Path $dest $pair.id
    if(Test-Path -LiteralPath $target){ Remove-Item -LiteralPath $target -Recurse -Force }
    $src=Join-Path $dest $g.Name
    if(Test-Path -LiteralPath $src){ Remove-Item -LiteralPath $src -Recurse -Force }
    $destNs.CopyHere($g, 0x414)
    $t0=Get-Date
    while(-not (Test-Path -LiteralPath $src) -and ((Get-Date)-$t0).TotalSeconds -lt 90){ Start-Sleep -Milliseconds 400 }
    if(-not (Test-Path -LiteralPath $src)){ $copied += @{id=$pair.id;ok=$false}; continue }
    $prev=-1; $stable=0; $t1=Get-Date
    while($stable -lt 4 -and ((Get-Date)-$t1).TotalSeconds -lt 120){
      $n=(Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
      if($n -eq $prev -and $n -gt 0){ $stable++ } else { $stable=0 }
      $prev=$n; Start-Sleep -Milliseconds 400
    }
    Rename-Item -LiteralPath $src -NewName $pair.id -Force
    $copied += @{id=$pair.id;ok=$true;files=$prev}
  }
}
@{ok=$true;games=$items;copied=$copied}|ConvertTo-Json -Depth 6 -Compress
`;

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function runMtp(names, pairs, dest) {
  const namesPs = names.map(psQuote).join(',');
  const pairsPs = pairs.map(p => `@{n=${psQuote(p.name)};id=${psQuote(p.id)}}`).join(',');
  const script = MTP_PS.replace('__NAMES__', namesPs).replace('__PAIRS__', pairsPs).replace('__DEST__', psQuote(dest || ''));
  return runPs(script);
}

function runPs(script) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024}, (e, out) => {
        const text = String(out || '').replace(/^\uFEFF/, '').trim();
        try { resolve(JSON.parse(text || '{}')); }
        catch { resolve({ok: false, error: e ? String(e.message).slice(0, 300) : 'bad-json', raw: text.slice(0, 200)}); }
      });
  });
}

const MTP_PRESENT_PS = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$shell=New-Object -ComObject Shell.Application
$pc=$shell.NameSpace(17)
$dev=$pc.Items() | Where-Object { $_.Name -eq 'Switch' }
if(-not $dev){ @{ok=$false;error='not-connected'}|ConvertTo-Json -Compress; exit }
$root=$shell.NameSpace($dev.Path)
$sv=$root.Items() | Where-Object { $_.Name -like '7:*' } | Select-Object -First 1
@{ok=[bool]$sv;name=$(if($dev){$dev.Name}else{''})}|ConvertTo-Json -Compress
`;

const MTP_LIST_PS = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$shell=New-Object -ComObject Shell.Application
$pc=$shell.NameSpace(17)
$dev=$pc.Items() | Where-Object { $_.Name -eq 'Switch' }
if(-not $dev){ @{ok=$false;error='not-connected'}|ConvertTo-Json -Compress; exit }
$root=$shell.NameSpace($dev.Path)
$sv=$root.Items() | Where-Object { $_.Name -like '7:*' } | Select-Object -First 1
if(-not $sv){ @{ok=$false;error='no-saves'}|ConvertTo-Json -Compress; exit }
$saves=$sv.GetFolder
$games=@()
foreach($grp in @('Installed games','Uninstalled games')){
  $g=($saves.Items() | Where-Object { $_.Name -eq $grp }).GetFolder
  if(-not $g){ continue }
  foreach($it in $g.Items()){ if($it.IsFolder){ $games += @{name=$it.Name; group=$grp} } }
}
@{ok=$true;games=$games}|ConvertTo-Json -Depth 4 -Compress
`;

function hashDir(dir) {
  const h = crypto.createHash('sha1'), files = [];
  const walk = d => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p); } };
  walk(dir); files.sort();
  for (const f of files) {
    const rel = path.relative(dir, f).replace(/\\/g, '/');
    h.update(rel + '\0');
    try { const st = fs.statSync(f); h.update(String(st.size) + '\0'); h.update(fs.readFileSync(f)); } catch {}
  }
  return {hash: h.digest('hex'), files: files.length, bytes: files.reduce((n, f) => { try { return n + fs.statSync(f).size; } catch { return n; } }, 0), mtime: files.reduce((n, f) => { try { return Math.max(n, fs.statSync(f).mtimeMs); } catch { return n; } }, 0)};
}

// имена игр консоли, которые есть в библиотеке
function consoleMatches(lib, games) {
  const out = [];
  for (const g of games) {
    const id = matchGame(lib, {name: g.name});
    if (id) out.push({id, name: g.name});
  }
  return out;
}

async function mtpSync(store, dataDir) {
  const lib = store.data.library;
  const probe = await runPs(MTP_LIST_PS);
  if (!probe.ok) return probe;
  const games = (probe.games || []).filter(g => g && g.name);
  const matches = [];
  for (const g of games) {
    const id = matchGame(lib, {name: g.name});
    if (id && !matches.some(m => m.id === id)) matches.push({id, name: g.name, group: g.group});
  }
  const dest = path.join(dataDir, 'switch-saves', 'console');
  const copied = matches.length ? await runMtp([], matches.map(m => ({name: m.name, id: m.id})), dest) : {ok: true, copied: []};
  if (!copied.ok) return copied;
  let updated = 0;
  for (const m of matches) {
    const dir = path.join(dest, m.id);
    if (!isDir(dir)) continue;
    const h = hashDir(dir);
    if (applySave(store, m.id, {source: 'console', path: dir, hash: h.hash, files: h.files, bytes: h.bytes, mtime: h.mtime})) updated++;
  }
  return {ok: true, found: games.length, matched: matches.length, updated, copied: (copied.copied || []).length};
}

let presence = {at: 0, ok: false};
async function mtpPresent(force) {
  if (!force && presence.at && Date.now() - presence.at < 15000) return presence.ok;
  const r = await runPs(MTP_PRESENT_PS);
  presence = {at: Date.now(), ok: !!r.ok};
  return presence.ok;
}

// ---------- FTP (sys-ftpd) ----------
async function ftpSync(store, dataDir, opts = {}) {
  const {Ftp} = require('./ftp.js');
  const c = new Ftp(opts);
  await c.connect(); await c.login(); await c.typeI();
  try {
    let base = String(opts.path || 'nand/user/save').replace(/\/+$/, ''), files = null, lastErr = null;
    for (const b of [...new Set([base, 'nand/user/save', 'saves', 'save'])]) {
      try { const f = await c.walk(b); if (f.length) { files = f; base = b; break; } }
      catch (e) { lastErr = e; }
    }
    if (!files) throw lastErr || new Error('FTP: сейвы не найдены');
    const groups = new Map();
    for (const f of files) {
      let rel = f.path.startsWith(base) ? f.path.slice(base.length) : f.path;
      rel = rel.replace(/^\/+/, '');
      const segs = rel.split('/').filter(Boolean);
      const tid = segs.find(s => TID_ONLY.test(s)) || '';
      const key = tid || segs[0] || 'saves';
      if (!groups.has(key)) groups.set(key, {key, titleId: tid, name: tid ? '' : cleanBackupName(key), files: []});
      groups.get(key).files.push({...f, rel});
    }
    let matched = 0, updated = 0, downloaded = 0;
    for (const g of groups.values()) {
      const id = matchGame(store.data.library, g);
      if (!id) continue;
      matched++;
      const dir = path.join(dataDir, 'switch-saves', 'ftp', id);
      for (const f of g.files) {
        const rel = f.rel.split('/').filter(s => s && s !== '.' && s !== '..').join('/');
        if (!rel) continue;
        try { await c.download(f.path, path.join(dir, rel)); downloaded++; } catch {}
      }
      const h = hashDir(dir);
      if (applySave(store, id, {titleId: g.titleId, source: 'ftp', path: dir, hash: h.hash, files: h.files, bytes: h.bytes, mtime: h.mtime})) updated++;
    }
    return {ok: true, base, found: groups.size, matched, updated, files: downloaded};
  } finally { c.close(); }
}

// ---------- статус ----------
let cache = {at: 0, scan: null};
function scanStatus(store, cfg, force) {
  if (!force && cache.scan && Date.now() - cache.at < 30000) return cache.scan;
  const sc = scanEmulators(cfg || {});
  const lib = store.data.library;
  const saves = sc.saves.map(s => { const id = matchGame(lib, s); return {...s, gameId: id || '', gameName: id ? lib[id].name : ''}; });
  const result = {roots: sc.roots, saves, matched: saves.filter(s => s.gameId).length, unmatched: saves.filter(s => !s.gameId).map(s => s.titleId), at: iso()};
  cache = {at: Date.now(), scan: result};
  return result;
}

function create(deps) {
  const {store, dataDir, emit} = deps;
  const cfg = () => store.data.config;
  const swCfg = () => (cfg().switch = cfg().switch || {});
  const saveCfg = () => store.save('config');
  const notify = () => { try { emit({type: 'lib'}); } catch {} };

  function scanNow(apply = true) {
    const st = scanStatus(store, swCfg(), true);
    let updated = 0;
    if (apply) for (const s of st.saves) {
      if (!s.gameId) continue;
      if (applySave(store, s.gameId, {titleId: s.titleId, source: 'emulator', path: s.path, mtime: s.mtime, files: s.files, bytes: s.bytes})) updated++;
    }
    swCfg().lastScan = iso(); saveCfg();
    if (updated) notify();
    return {...st, updated};
  }

  async function sync() {
    const s = swCfg();
    const present = await mtpPresent(true);
    let r;
    if (present) r = {via: 'console', ...(await mtpSync(store, dataDir))};
    else {
      const f = s.ftp || {};
      if (!f.host) return {ok: false, error: 'no-source', message: 'Подключите консоль по USB или укажите FTP в настройках.'};
      r = {via: 'ftp', ...(await ftpSync(store, dataDir, f))};
    }
    if (r.ok) { s.lastSync = iso(); saveCfg(); }
    return r;
  }

  return {
    cfg: swCfg, saveCfg, scanNow, sync,
    scanStatus: force => scanStatus(store, swCfg(), force),
    importBackups: dir => importBackups(store, dir),
    mtpSync: () => mtpSync(store, dataDir),
    ftpSyncNow: opts => ftpSync(store, dataDir, opts),
    applyCompanion: payload => applyCompanion(store, payload),
    mtpPresent,
    status: async () => {
      const st = scanStatus(store, swCfg(), false);
      let present = false;
      try { present = await mtpPresent(); } catch {}
      const f = swCfg().ftp || {};
      const linked = Object.values(store.data.library || {}).filter(g => g && g.switchSave).length;
      return {...st, linked, enabled: swCfg().enabled !== false, lastScan: swCfg().lastScan || '', lastSync: swCfg().lastSync || '', mtp: {present},
        ftp: {host: f.host || '', port: +f.port || 21, user: f.user || '', path: f.path || 'nand/user/save', set: !!f.host, passSet: !!f.pass}};
    }
  };
}

module.exports = {create, emulatorRoots, scanEmulators, scanStatus, importBackups, mtpSync, mtpPresent, ftpSync, applyCompanion, titleIdOf, matchGame, applySave, hashDir, cleanBackupName, safeName};
