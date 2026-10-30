'use strict';
// Детектор запущенных игр и подсчёт времени
const fs = require('fs'), path = require('path'), os = require('os'), {spawn, execFile} = require('child_process'), EventEmitter = require('events');
const S = require('../public/search.js'), Emu = require('./emulators.js');

const NOISE = /(unins|crash|report|redist|dxsetup|setup|installer|easyanticheat|^eac|beclient|battleye|anticheat|cefsub|webhelper|overlay|helper|updater|service|dotnet|directx|ue4prereq)/i;
const SKIP_DIR = /^(launcher|epiconlineservices|directxredist|common|redist|_commonredist|\.egstore|installer)$/i;
const norm = p => String(p).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const base = n => n.slice(n.lastIndexOf('/') + 1);
// папка exe, указанного как «Файл запуска», тоже привязывает процесс к игре (если это не корень диска и не общая папка «Games»)
const launchDir = g => { const l = String(g.launch || ''); if (!/\.(exe|bat|cmd)$/i.test(l)) return ''; const d = path.dirname(l); return d.split(/[\\/]+/).filter(Boolean).length >= 3 ? d : ''; };
const dirsOf = g => [g.dir, ...(Array.isArray(g.dirs) ? g.dirs : []), launchDir(g)].filter(Boolean);
// имена, которые ничего не говорят об игре: папки с бинарниками и универсальные имена exe
const GENERIC = /^(game|games|launcher|start|run|play|main|bin|bin32|bin64|binaries|app|client|win32|win64|x64|x86|shipping|release|retail|data|system|windows|program files|programs|common|steamapps|steam|app|application|engine|unitycrashhandler\w*|launch|server)$/i;
const SHIPPING = /[-_ ](win(32|64)?|windowsnoeditor|shipping|steam|gog|epic|x64|x86|dx\d+|vulkan)\b/gi;
// Программы, которые работают сутками и не являются играми: никогда не считаем их время (Wallpaper Engine и служебные компоненты Steam)
const HARD_IGNORE_EXE = /^(wallpaper(32|64|_engine|service32|service)?|webwallpaper(32|64)?|applicationwallpaperengine(32|64)?)\.exe$/i;
const HARD_IGNORE_DIR = /\/(wallpaper_engine|steamworks shared|steam linux runtime[^/]*)(\/|$)/i;
const HARD_IGNORE_APPIDS = new Set(['431960', '228980', '1070560', '1391110', '1628350', '480']); // Wallpaper Engine, Steamworks Redist, Steam Linux Runtime, Spacewar (тестовый appid 480: его подставляют эмуляторы Steam в пиратских версиях)
const HARD_IGNORE_NAME = /^wallpaper engine$/i;
const pcPlat = () => process.platform === 'win32' ? 'pc' : process.platform === 'darwin' ? 'mac' : 'linux';
const isHardIgnored = (n, b) => HARD_IGNORE_EXE.test(b) || HARD_IGNORE_DIR.test(n + '/');
// локальная дата YYYY-MM-DD
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Скрипт для Windows: раз в 5 секунд печатает «ID_запущенной_игры_Steam|путь1<TAB>путь2…|эмулятор1<TAB>эмулятор2…».
// Для эмуляторов добавляются командная строка (в ней лежит образ/ROM) и заголовок окна (в нём часто название игры), поля разделены символом 31.
const PS = `$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$emu='${Emu.psPattern()}'
$f=[string][char]31
while($true){
 $rid=(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam').RunningAppID
 $all=@(Get-Process | Where-Object {$_.Path})
 $p=($all | ForEach-Object {$_.Path} | Sort-Object -Unique) -join "\`t"
 $e=(@($all | Where-Object {$_.ProcessName -match $emu} | ForEach-Object { $c=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.Id)).CommandLine; $_.Path+$f+($c -replace '[\\x00-\\x1f|]',' ')+$f+($_.MainWindowTitle -replace '[\\x00-\\x1f|]',' ') }) -join "\`t")
 [Console]::Out.WriteLine("$rid|$p|$e"); [Console]::Out.Flush()
 Start-Sleep -Seconds 5
}`;

class Tracker extends EventEmitter {
  constructor(store, opts = {}) {
    super();
    this.store = store; this.opts = opts;
    this.active = new Map(); this.alias = new Map(); this.resolving = new Set(); this.pend = new Map(); this.exeCache = new Map();
    this.steamGames = []; this.steamCommons = []; this.steamLibs = 0; this.rootsN = [];
    this.procs = []; this.lastTick = 0; this.lastEmit = 0; this.ps = null; this.timer = null; this.scanT = null; this.stopped = false;
  }
  get cfg() { return this.store.data.config.tracker; }
  get lib() { return this.store.data.library; }
  get supported() { return !!this.opts.provider || process.platform === 'win32' || process.platform === 'linux'; }

  // --- поиск установленных игр Steam и папок с играми ---
  async scanSteam() {
    const roots = new Set(this.opts.steamRoots || []);
    if (process.platform === 'win32') {
      try {
        const out = await new Promise(r => execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {windowsHide: true}, (e, o) => r(o || '')));
        const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i); if (m) roots.add(m[1].trim().replace(/\//g, '\\'));
      } catch {}
      roots.add('C:\\Program Files (x86)\\Steam'); roots.add('C:\\Program Files\\Steam');
    } else { roots.add(path.join(os.homedir(), '.steam/steam')); roots.add(path.join(os.homedir(), '.local/share/Steam')); }
    const libs = new Set();
    for (const r of roots) {
      if (!fs.existsSync(path.join(r, 'steamapps'))) continue;
      libs.add(r);
      try { for (const m of fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\')); } catch {}
    }
    const games = [], commons = [];
    for (const l of libs) {
      const apps = path.join(l, 'steamapps'); let files = [];
      try { files = fs.readdirSync(apps); } catch { continue; }
      commons.push(path.join(apps, 'common'));
      for (const f of files) {
        if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
        try {
          const t = fs.readFileSync(path.join(apps, f), 'utf8');
          const id = t.match(/"appid"\s+"(\d+)"/)?.[1], name = t.match(/"name"\s+"([^"]*)"/)?.[1], dir = t.match(/"installdir"\s+"([^"]*)"/)?.[1];
          if (id && dir) games.push({appid: id, name: name || dir, dir: norm(path.join(apps, 'common', dir))});
        } catch {}
      }
    }
    this.steamGames = games; this.steamCommons = commons; this.steamLibs = libs.size;
    this.buildRoots();
  }
  buildRoots() {
    const r = new Set(this.steamCommons);
    for (const p of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean))
      for (const s of ['Epic Games', 'GOG Galaxy\\Games', 'Ubisoft\\Ubisoft Game Launcher\\games', 'EA Games', 'Origin Games', 'Rockstar Games']) r.add(path.join(p, s));
    for (const s of ['GOG Games', 'Games', 'Game', 'Игры', 'Epic Games', 'XboxGames', 'Repacks', 'Steam Games', 'SteamLibrary\\steamapps\\common', 'Games\\Steam'])
      for (let c = 67; c <= 90; c++) r.add(String.fromCharCode(c) + ':\\' + s);
    for (const f of this.cfg.folders || []) if (f) r.add(f);
    this.rootsN = [...r].filter(x => { try { return fs.statSync(x).isDirectory(); } catch { return false; } }).map(norm);
  }
  rescan() { return this.scanSteam().catch(() => {}); }

  // --- сопоставление процесса с игрой ---
  // подсказки названия по пути: папки внутри корня (от верхней к нижней), название exe, ProductName из свойств файла (подтягивает сервер)
  hintsFor(root, parts, exeName) {
    const out = [], seen = new Set(), folders = parts.slice(0, -1);
    const add = (raw, dir) => { const name = S.cleanName(String(raw).replace(SHIPPING, ' ')); const k = S.key(name); if (name.length < 2 || GENERIC.test(name) || !k || seen.has(k)) return; seen.add(k); out.push({name, dir}); };
    folders.slice(0, 4).forEach((f, i) => add(f, root + '/' + folders.slice(0, i + 1).join('/')));
    add(exeName.replace(/\.[a-z0-9]+$/i, ''), root + '/' + folders.join('/'));
    return out;
  }
  match(p) {
    const n = norm(p), b = base(n);
    if (NOISE.test(b) || isHardIgnored(n, b) || Emu.detect(b)) return null;    // эмулятор — не игра: игры внутри него определяются по образу
    for (const [id, g] of Object.entries(this.lib)) {
      if (dirsOf(g).some(d => n.startsWith(norm(d) + '/'))) return {key: id, id, name: g.name};
      if (g.exe && g.exe.some(e => String(e).toLowerCase() === b)) return {key: id, id, name: g.name};
    }
    const ign = new Set((this.cfg.ignore || []).map(s => String(s).toLowerCase().trim()));
    if (ign.has(b)) return null;
    for (const g of this.steamGames) if (n.startsWith(g.dir + '/')) return HARD_IGNORE_APPIDS.has(g.appid) || HARD_IGNORE_NAME.test(g.name) || ign.has(g.appid) || ign.has(g.name.toLowerCase()) ? null : {key: g.appid, id: g.appid, name: g.name, dir: p.replace(/\\/g, '/').slice(0, g.dir.length)};
    for (const r of this.rootsN) {
      if (!n.startsWith(r + '/')) continue;
      const rest = n.slice(r.length + 1); if (!rest.includes('/')) continue;
      const seg = rest.split('/')[0]; if (SKIP_DIR.test(seg)) return null;
      const orig = p.replace(/\\/g, '/'), real = orig.slice(r.length + 1).split('/'), rootP = orig.slice(0, r.length);
      if (ign.has(real[0].toLowerCase())) return null;
      const hints = this.hintsFor(rootP, real, real[real.length - 1]);
      // ключ — первые две папки: так разные игры внутри одной общей папки (репаки, «Games\\Группа\\Игра») не сливаются в одну
      const key = 'dir:' + r + '/' + norm(real.slice(0, Math.min(2, real.length - 1)).join('/'));
      return {key, id: null, name: (hints[0] && hints[0].name) || S.cleanName(real[0]) || real[0], dir: rootP + '/' + real[0], exe: base(n), exePath: p, hints};
    }
    return null;
  }

  // эмулятор + образ → «игра» для сопоставления с каталогом; без образа и названия в заголовке игра не считается запущенной
  matchEmu(e) {
    const emu = Emu.detect(e.path); if (!emu) return null;
    this.emit('emulator', {id: emu.id, path: e.path});
    const rom = Emu.romFromCmd(emu, e.cmd);
    const info = rom ? Emu.gameFromRom(emu, rom) : null;
    let name = info && info.name, gameId = info && info.serial || '';
    if (!name) { const t = Emu.titleToGame(emu, e.title); if (t) { name = t.name; gameId = t.gameId || ''; } }
    if (!name) return null;
    const plat = Emu.platformFor(emu, {rom, gameId});
    const known = rom ? Object.entries(this.lib).find(([, g]) => g.launch && norm(g.launch) === norm(rom)) : null;   // образ уже привязан к игре
    return {key: 'emu:' + emu.id + ':' + (known ? known[0] : (S.key(name) || name.toLowerCase())), id: known ? known[0] : null, name: known ? known[1].name : name,
      emu: emu.id, emuName: emu.name, platform: plat, rom, fromEmu: true, hints: [{name: S.cleanName(name), dir: ''}]};
  }
  // --- один «тик» опроса ---
  tick(snap) {
    if (!this.cfg.enabled) { this.endAll(); return; }
    const now = Date.now(), dt = this.lastTick ? Math.min((now - this.lastTick) / 1000, 30) : 0;
    this.lastTick = now; this.procs = snap.paths || [];
    const seen = new Map();
    for (const p of this.procs) { const m = this.match(p); if (m && !seen.has(m.key)) seen.set(m.key, m); }
    for (const e of snap.emus || []) { const m = this.matchEmu(e); if (m && !seen.has(m.key)) seen.set(m.key, m); }   // игры в эмуляторах: образ из командной строки или название из заголовка окна
    const rid = String(snap.rid || '0').trim();
    if (/^\d+$/.test(rid) && rid !== '0' && !HARD_IGNORE_APPIDS.has(rid) && !this.cfg.ignore?.includes(rid) && ![...seen.values()].some(m => m.id === rid)) {
      const g = this.steamGames.find(x => x.appid === rid);
      seen.set(rid, {key: rid, id: rid, name: g?.name || this.lib[rid]?.name || null});   // не из Steam и не в библиотеке: имя спросит сервер, «Steam 123» больше не создаём
    }
    const credited = new Set();
    for (const m of seen.values()) {
      const id = m.id && this.lib[m.id] ? m.id : this.alias.get(m.key);
      if (!id || !this.lib[id]) { if (this.cfg.autoAdd && this.opts.resolve) this.waitResolve(m, now, dt); continue; }
      let a = this.active.get(id);
      if (credited.has(id)) { if (a) a.last = now; continue; }   // два процесса одной игры (лаунчер + игра) считаем один раз
      credited.add(id);
      if (!a) {
        const pd = this.pend.get(m.key);
        a = {id, name: this.lib[id].name, start: pd?.start || now, seconds: 0, last: now, plat: m.platform || '', emu: m.emu || '', rom: m.rom || ''}; this.active.set(id, a); this.begin(a);
        if (pd) { a.seconds += pd.seconds; this.addTime(id, pd.seconds, a.plat, a.emu); this.pend.delete(m.key); }   // время, пока игру опознавали, не теряется
      }
      a.last = now; if (m.platform) a.plat = m.platform; if (m.emu) a.emu = m.emu;
      if (dt) { a.seconds += dt; this.addTime(id, dt, a.plat, a.emu); }
    }
    for (const [k, a] of this.active) if (now - a.last > 20000) { this.active.delete(k); this.finish(a); }
    for (const [k, pd] of this.pend) if (now - pd.last > 20000) this.pend.delete(k);
  }
  // игра запущена, но в библиотеке её ещё нет: считаем время «в долг» и пробуем опознать (с растущей паузой между попытками)
  waitResolve(m, now, dt) {
    let pd = this.pend.get(m.key);
    if (!pd) { pd = {start: now, seconds: 0, last: now, tries: 0, next: 0}; this.pend.set(m.key, pd); }
    pd.last = now; pd.seconds += dt;
    if (this.resolving.has(m.key) || now < pd.next) return;
    this.resolving.add(m.key);
    const fail = () => { pd.tries++; pd.next = Date.now() + Math.min(600000, 15000 * 2 ** Math.min(pd.tries, 6)); };
    Promise.resolve(this.opts.resolve(m)).then(r => { if (r) this.alias.set(m.key, r); else fail(); }).catch(fail).finally(() => this.resolving.delete(m.key));
  }
  addTime(id, dt, plat, emu) {
    const g = this.lib[id]; if (!g) return;
    g.hours = Math.round(((+g.hours || 0) + dt / 3600) * 1e6) / 1e6;
    g.last = new Date().toISOString();
    const day = ymd(), dd = g.days || (g.days = {}); dd[day] = Math.round(((dd[day] || 0) + dt) * 10) / 10; // секунды по календарным дням
    // и по платформам/эмуляторам: из этого строится аналитика «NEXUS Rewind» (Топ платформ и эмуляторов за неделю, месяц, год)
    const dp = g.dp || (g.dp = {}), dpd = dp[day] || (dp[day] = {p: {}}), pl = plat || pcPlat();
    dpd.p[pl] = Math.round(((dpd.p[pl] || 0) + dt) * 1000) / 1000;
    if (emu) { dpd.e = dpd.e || {}; dpd.e[emu] = Math.round(((dpd.e[emu] || 0) + dt) * 1000) / 1000; }
    this.store.save('library');
    if (Date.now() - this.lastEmit > 30000) { this.lastEmit = Date.now(); this.emit('event', {type: 'lib'}); }
  }
  begin(a) {
    const g = this.lib[a.id];
    if (this.cfg.autoStatus && (!g.status || g.status === 'planned' || g.status === 'dropped')) g.status = 'playing';
    if (!g.firstPlayed) { g.firstPlayed = new Date().toISOString(); if (!g.started) g.started = ymd(); }
    // платформа определяется сама: обычная игра идёт на этом компьютере, игра в эмуляторе — на своей консоли
    const plat = a.plat || pcPlat();
    if (a.emu) g.emu = a.emu;
    if (!Array.isArray(g.playedOn)) g.playedOn = [];
    if (!g.playedOn.includes(plat)) g.playedOn.push(plat);
    g.last = new Date().toISOString();
    this.store.save('library');
    this.emit('event', {type: 'start', id: a.id, name: a.name}); this.emit('event', {type: 'lib'});
  }
  finish(a) {
    const g = this.lib[a.id];
    if (g && a.seconds >= 30) { (g.sessions = g.sessions || []).push({s: a.start, e: a.last, sec: Math.round(a.seconds), ...(a.plat ? {plat: a.plat} : {}), ...(a.emu ? {emu: a.emu} : {})}); if (g.sessions.length > 500) g.sessions.shift(); this.store.save('library'); }
    this.emit('event', {type: 'end', id: a.id, name: a.name, seconds: Math.round(a.seconds)}); this.emit('event', {type: 'lib'});
  }
  endAll() { for (const [k, a] of this.active) { this.active.delete(k); this.finish(a); } }

  // --- источники списка процессов ---
  linuxPaths() {
    const out = new Set();
    for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { out.add(fs.readlinkSync('/proc/' + d + '/exe')); } catch {} }
    return [...out];
  }
  // эмуляторы в Linux: командная строка из /proc (заголовка окна там нет)
  linuxEmus() {
    const out = [];
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try { const exe = fs.readlinkSync('/proc/' + d + '/exe'); if (Emu.detect(exe)) out.push({path: exe, cmd: fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').split('\0').map(a => /\s/.test(a) ? '"' + a + '"' : a).join(' '), title: ''}); } catch {}
    }
    return out;
  }
  startPS() {
    if (this.stopped) return;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')], {windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
    this.ps = ps; let buf = '';
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        const k = line.indexOf('|'); if (k < 0) continue;
        const parts = line.slice(k + 1).split('|'), emus = parts.slice(1).join('|').split('\t').filter(Boolean).map(x => { const [p, c, t] = x.split('\x1f'); return {path: p || '', cmd: c || '', title: t || ''}; });
        try { this.tick({rid: line.slice(0, k), paths: (parts[0] || '').split('\t').filter(Boolean), emus}); } catch (e) { console.error('tick', e.message); }
      }
    });
    ps.on('exit', () => { if (!this.stopped) setTimeout(() => this.startPS(), 5000); });
    ps.on('error', () => {});
  }
  async start() {
    this.stopped = false;
    await this.rescan();
    if (this.stopped) return;                         // закрыли приложение, пока шёл первый поиск игр: таймеры не создаём
    this.scanT = setInterval(() => this.rescan(), 10 * 60 * 1000);
    if (this.opts.provider) this.timer = setInterval(async () => { try { this.tick(await this.opts.provider()); } catch {} }, this.opts.interval || 5000);
    else if (process.platform === 'win32') this.startPS();
    else if (process.platform === 'linux') this.timer = setInterval(() => { try { this.tick({rid: 0, paths: this.linuxPaths(), emus: this.linuxEmus()}); } catch {} }, 5000);
  }
  stop() { this.stopped = true; clearInterval(this.timer); clearInterval(this.scanT); this.endAll(); try { this.ps?.kill(); } catch {} }

  status() {
    const now = Date.now();
    return {supported: this.supported, platform: process.platform, enabled: !!this.cfg.enabled, steamLibs: this.steamLibs, steamGames: this.steamGames.length, roots: this.rootsN.length,
      now: [...this.active.values()].map(a => ({id: a.id, name: a.name, since: a.start, seconds: Math.round(a.seconds), plat: a.plat || '', emu: a.emu || ''})), ts: now};
  }
  // свойства exe (ProductName, описание): у многих пиратских версий они содержат настоящее название игры. Только Windows, результат кэшируется
  exeInfo(p) {
    if (this.opts.exeInfo) return Promise.resolve(this.opts.exeInfo(p));
    if (process.platform !== 'win32' || !p) return Promise.resolve(null);
    if (this.exeCache.has(p)) return this.exeCache.get(p);
    const lit = String(p).replace(/'/g, "''");
    const script = `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$v=(Get-Item -LiteralPath '${lit}').VersionInfo;@{p=$v.ProductName;d=$v.FileDescription;c=$v.CompanyName}|ConvertTo-Json -Compress`;
    const pr = new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {windowsHide: true, timeout: 10000}, (e, out) => {
      try { const j = JSON.parse(out); res({product: String(j.p || '').trim(), description: String(j.d || '').trim(), company: String(j.c || '').trim()}); } catch { res(null); }
    }));
    this.exeCache.set(p, pr); return pr;
  }
  // запущенные программы для ручной привязки (без системных)
  processes() {
    const seen = new Map();
    for (const p of this.procs) {
      const n = norm(p);
      if (/^[a-z]:\/windows\//.test(n) || /\/(microsoft|windowsapps|common files)\//.test(n) || NOISE.test(base(n))) continue;
      const dir = p.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
      if (!seen.has(dir)) seen.set(dir, {path: p, name: base(p.replace(/\\/g, '/')), dir});
    }
    return [...seen.values()].slice(0, 80);
  }
}
module.exports = {Tracker, norm, ymd, pcPlat, dirsOf, GENERIC, HARD_IGNORE_APPIDS, HARD_IGNORE_NAME};
