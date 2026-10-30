'use strict';
// NEXUS: автопоиск файла запуска и папок с сохранениями на этом компьютере.
// Шаблоны: Steam (userdata, steamapps/common, Documents, My Games, Saved Games, AppData), репаки и эмуляторы Steam
// (Goldberg, CODEX, RUNE, Public\\Documents), эмуляторы консолей (RPCS3, Yuzu/Ryujinx, PCSX2, Dolphin, PPSSPP и др.).
const fs = require('fs'), path = require('path'), os = require('os');
const S = require('../public/search.js'), Emu = require('./emulators.js');

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const ls = p => { try { return fs.readdirSync(p, {withFileTypes: true}); } catch { return []; } };
const dirs = p => ls(p).filter(d => d.isDirectory() || (d.isSymbolicLink && d.isSymbolicLink() && isDir(path.join(p, d.name)))).map(d => d.name);

// стандартные каталоги пользователя; env можно подменить (тесты, другая ОС)
function locations(env = process.env, home = os.homedir()) {
  const j = (...a) => path.join(...a);
  const appdata = env.APPDATA || j(home, 'AppData', 'Roaming'), local = env.LOCALAPPDATA || j(home, 'AppData', 'Local');
  const docsAll = [j(home, 'Documents'), env.OneDrive && j(env.OneDrive, 'Documents'), j(home, 'OneDrive', 'Documents'), j(home, 'OneDrive', 'Документы'), j(home, 'Документы')].filter(Boolean);
  const pub = env.PUBLIC || (process.platform === 'win32' ? 'C:\\Users\\Public' : '/tmp/public');
  return {home, appdata, local, locallow: j(path.dirname(local), 'LocalLow'), docs: [...new Set(docsAll)], savedGames: j(home, 'Saved Games'), pubDocs: j(pub, 'Documents'),
    xdgData: env.XDG_DATA_HOME || j(home, '.local', 'share'), xdgConfig: env.XDG_CONFIG_HOME || j(home, '.config')};
}

// имена папок, под которыми игра может хранить данные: «The Witcher 3: Wild Hunt» → «The Witcher 3», «Witcher 3», «witcher3»
function nameVariants(name) {
  const clean = String(name || '').replace(/[™®©]/g, '').replace(/[:\\/*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set([clean, clean.replace(/^the\s+/i, ''), clean.split(/\s[-–—:]\s|:\s/)[0], S.cleanName ? S.cleanName(clean) : clean].filter(x => x && x.length > 1));
  return [...out];
}
const dirMatches = (variants, dirName) => variants.some(v => { const sc = S.score(v, dirName); return sc >= 940; });

// размер и число файлов с ограничением, чтобы поиск не зависал на огромных папках
function measure(dir, limit = 3000) {
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

const SAVE_DIR = /^(saves?|savedata|save[ _-]?games?|saved|profiles?|appdata|userdata|savegame|slots?|saved games)$/i;
function addCand(out, seen, p, kind, why, base, extra = {}) {
  if (!isDir(p) || seen.has(p.toLowerCase())) return; seen.add(p.toLowerCase());
  const m = measure(p); if (!m.files) return;
  out.push({path: p, kind, why, score: base, files: m.files, bytes: m.bytes, mtime: m.mtime, capped: m.capped, ...extra});
}

// g: {name, dir, dirs}; ctx: {appid, steamLibs:[...], steamRoots:[...], emulators:{id:exePath}, env, home}
function findSaves(g, ctx = {}) {
  const L = locations(ctx.env, ctx.home), out = [], seen = new Set(), V = nameVariants(g.name), appid = /^\d+$/.test(String(ctx.appid || '')) ? String(ctx.appid) : '';

  // 1) официальный Steam: userdata\<ID_пользователя>\<AppID>
  for (const root of ctx.steamRoots || []) {
    if (appid) for (const uid of dirs(path.join(root, 'userdata'))) addCand(out, seen, path.join(root, 'userdata', uid, appid), 'steam', 'Steam Cloud: userdata', 95);
  }
  // 2) папка игры: save, Savedata, Saves, profile, AppData (в т.ч. рядом с репаком и эмулятором Goldberg)
  const gdirs = [g.dir, ...(Array.isArray(g.dirs) ? g.dirs : [])].filter(Boolean);
  for (const d of gdirs) {
    for (const n of dirs(d)) if (SAVE_DIR.test(n)) addCand(out, seen, path.join(d, n), 'game-dir', 'Внутри папки игры', 88);
    for (const n of dirs(d)) for (const m of dirs(path.join(d, n))) if (SAVE_DIR.test(m)) addCand(out, seen, path.join(d, n, m), 'game-dir', 'Внутри папки игры', 80);   // …\Game\Saved\SaveGames
  }
  // 3) Documents, My Games, Saved Games, AppData (Local, Roaming, LocalLow), включая «Издатель\Игра»
  const bases = [['documents', L.docs], ['my-games', L.docs.map(d => path.join(d, 'My Games'))], ['saved-games', [L.savedGames]], ['appdata', [L.local, L.appdata, L.locallow]]];
  for (const [kind, list] of bases) for (const b of list) for (const n of dirs(b)) {
    if (dirMatches(V, n)) addCand(out, seen, path.join(b, n), kind, kind === 'appdata' ? 'AppData' : kind === 'saved-games' ? 'Saved Games' : kind === 'my-games' ? 'My Games' : 'Документы', 84);
    else if (kind !== 'documents' && kind !== 'saved-games') for (const m of dirs(path.join(b, n))) if (dirMatches(V, m)) addCand(out, seen, path.join(b, n, m), kind, kind === 'appdata' ? 'AppData (издатель\\игра)' : 'My Games', 76);
  }
  // 4) репаки и эмуляторы Steam: Goldberg, CODEX, RUNE, OnlineFix, Steam в Public\Documents
  if (appid) {
    const emuRoots = [[L.appdata, ['Goldberg SteamEmu Saves', 'GSE Saves', 'CODEX', 'RUNE', 'EMPRESS', 'SmartSteamEmu', 'Steam']], [L.pubDocs, ['Steam\\CODEX', 'Steam\\RUNE', 'Steam\\CODEX\\Saves', 'OnlineFix', 'CODEX', 'RUNE', 'EMPRESS']], [L.local, ['CODEX', 'RUNE']]];
    for (const [base, names] of emuRoots) for (const n of names) for (const sub of [path.join(base, n, appid), path.join(base, n, appid, 'remote'), path.join(base, n, 'Saves', appid)]) addCand(out, seen, sub, 'repack', 'Репак / эмулятор Steam', 90);
  }
  // 5) эмуляторы консолей
  for (const [id, exe] of Object.entries(ctx.emulators || {})) emuSaves(out, seen, g, V, id, exe, L);
  // типичные места для эмуляторов, у которых путь неизвестен (установка по умолчанию)
  emuSaves(out, seen, g, V, 'dolphin', null, L); emuSaves(out, seen, g, V, 'ppsspp', null, L); emuSaves(out, seen, g, V, 'pcsx2', null, L);
  emuSaves(out, seen, g, V, 'ryujinx', null, L); emuSaves(out, seen, g, V, 'yuzu', null, L); emuSaves(out, seen, g, V, 'rpcs3', null, L);

  out.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return out.slice(0, 12);
}

// папка сохранений игры внутри эмулятора: если в сохранении есть PARAM.SFO, сверяем название игры
function emuSaves(out, seen, g, V, id, exe, L) {
  const root = exe ? path.dirname(exe) : null, add = (p, why, sc, extra) => addCand(out, seen, p, 'emulator', why, sc, {emu: id, ...extra});
  const matchSfo = base => { for (const n of dirs(base)) { const t = Emu.sfoTitle(path.join(base, n)); if (t && dirMatches(V, t.title)) add(path.join(base, n), (Emu.byId[id] || {name: id}).name + ': сохранение игры', 92); } };
  if (id === 'rpcs3') for (const r of [root, path.join(L.appdata, 'RPCS3'), path.join(L.xdgConfig, 'rpcs3')].filter(Boolean)) {
    for (const prof of dirs(path.join(r, 'dev_hdd0', 'home'))) { const sd = path.join(r, 'dev_hdd0', 'home', prof, 'savedata'); matchSfo(sd); }
    matchSfo(path.join(r, 'dev_hdd0', 'game'));
  }
  if (id === 'ppsspp') for (const r of [root && path.join(root, 'memstick'), ...L.docs.map(d => path.join(d, 'PPSSPP')), path.join(L.appdata, 'PPSSPP')].filter(Boolean)) matchSfo(path.join(r, 'PSP', 'SAVEDATA'));
  if (id === 'pcsx2') for (const r of [root, ...L.docs.map(d => path.join(d, 'PCSX2')), path.join(L.appdata, 'PCSX2')].filter(Boolean)) add(path.join(r, 'memcards'), 'PCSX2: карты памяти (*.ps2), все игры', 55);
  if (id === 'duckstation') for (const r of [root, ...L.docs.map(d => path.join(d, 'DuckStation')), path.join(L.appdata, 'DuckStation')].filter(Boolean)) add(path.join(r, 'memcards'), 'DuckStation: карты памяти, все игры', 55);
  if (id === 'dolphin') for (const r of [root && path.join(root, 'User'), ...L.docs.map(d => path.join(d, 'Dolphin Emulator')), path.join(L.appdata, 'Dolphin Emulator'), path.join(L.xdgData, 'dolphin-emu')].filter(Boolean)) { add(path.join(r, 'GC'), 'Dolphin: GameCube, все игры', 55); add(path.join(r, 'Wii', 'title'), 'Dolphin: Wii, все игры', 55); }
  if (id === 'ryujinx') for (const r of [root && path.join(root, 'portable'), path.join(L.appdata, 'Ryujinx')].filter(Boolean)) add(path.join(r, 'bis', 'user', 'save'), 'Ryujinx: сохранения Switch, все игры', 55);
  if (id === 'yuzu') for (const r of [root && path.join(root, 'user'), path.join(L.appdata, 'yuzu'), path.join(L.appdata, 'eden'), path.join(L.appdata, 'suyu')].filter(Boolean)) add(path.join(r, 'nand', 'user', 'save'), 'yuzu / Eden: сохранения Switch, все игры', 55);
  if (id === 'cemu' && root) add(path.join(root, 'mlc01', 'usr', 'save'), 'Cemu: сохранения Wii U, все игры', 55);
  if (id === 'shadps4' && root) add(path.join(root, 'user', 'savedata'), 'shadPS4: сохранения PS4, все игры', 55);
  if (id === 'xenia' && root) add(path.join(root, 'content'), 'Xenia: контент и сохранения, все игры', 50);
}

// файл запуска: ищем .exe в папке игры (глубина до 2), пропуская установщики и служебные
const EXE_SKIP = /(unins|setup|redist|vcredist|vc_redist|dxsetup|dotnet|crash|helper|report|eac|easyanticheat|beservice|battleye|cefsub|uninstall|installer|updater|patcher|config|benchmark|webhelper|7z|activat)/i;
function findExes(dirPath, name) {
  if (!isDir(dirPath)) return [];
  const found = [], walk = (d, depth) => {
    for (const e of ls(d)) {
      const p = path.join(d, e.name);
      if (e.isFile() && /\.exe$/i.test(e.name) && !EXE_SKIP.test(e.name)) { let size = 0; try { size = fs.statSync(p).size; } catch {} found.push({path: p, name: e.name, size, depth}); }
      else if (e.isDirectory() && depth < 2 && !/^(redist|_commonredist|directx|vcredist|__installer|engine|\.git)$/i.test(e.name)) walk(p, depth + 1);
    }
  };
  walk(dirPath, 0);
  const V = nameVariants(name || path.basename(dirPath));
  for (const f of found) {
    const base = f.name.replace(/\.exe$/i, ''); let sc = Math.max(...V.map(v => S.score(v, base)), S.score(path.basename(dirPath), base));
    if (/shipping|win64/i.test(f.path)) sc += 20;
    f.score = Math.round(sc + Math.min(150, f.size / (1024 * 1024)) - f.depth * 25);
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 6);
}
module.exports = {findSaves, findExes, locations, nameVariants, measure};
