'use strict';
// NEXUS: автоматический поиск игры (exe или образа), эмулятора и папки сохранений на этом ПК.
// Все пути берутся из контекста ctx (defaultCtx() для Windows), поэтому модуль проверяется тестами на любой системе.
const fs = require('fs'), path = require('path'), os = require('os');
const S = require('../public/search.js'), Emu = require('./emulators.js');

const J = path.join;
const ok = (f, d) => { try { return f(); } catch { return d; } };
const isDir = p => !!p && ok(() => fs.statSync(p).isDirectory(), false);
const isFile = p => !!p && ok(() => fs.statSync(p).isFile(), false);
const ents = p => ok(() => fs.readdirSync(p, {withFileTypes: true}), []);
const dirNames = p => ents(p).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name);
const uniq = a => [...new Set(a.filter(Boolean))];
const low = p => String(p).replace(/\\/g, '/').toLowerCase();
const mtime = p => ok(() => fs.statSync(p).mtimeMs, 0);

// ---------- контекст: где что лежит на этом компьютере ----------
function defaultCtx(o = {}) {
  const env = o.env || process.env, win = (o.platform || process.platform) === 'win32';
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const od = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean);
  return {
    win, home,
    roaming: env.APPDATA || J(home, 'AppData', 'Roaming'), local: env.LOCALAPPDATA || J(home, 'AppData', 'Local'), locallow: J(home, 'AppData', 'LocalLow'),
    docs: uniq([J(home, 'Documents'), ...od.flatMap(d => [J(d, 'Documents'), J(d, 'Документы')])]).filter(isDir),
    savedGames: J(home, 'Saved Games'), downloads: J(home, 'Downloads'), desktop: J(home, 'Desktop'),
    pub: env.PUBLIC || (win ? 'C:\\Users\\Public' : ''), programData: env.ProgramData || (win ? 'C:\\ProgramData' : ''),
    pf: uniq([env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432]),
    drives: win ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => l + ':\\').filter(isDir) : [],
    extra: {steam: [], games: [], roms: [], emus: [], saves: [], ...(o.extra || {})}
  };
}
const withExtra = (ctx, cfg = {}) => ({...ctx, extra: {steam: [...(ctx.extra?.steam || [])], games: [...(ctx.extra?.games || []), ...(cfg.gameDirs || [])], roms: [...(ctx.extra?.roms || []), ...(cfg.romDirs || [])], emus: [...(ctx.extra?.emus || [])], saves: [...(ctx.extra?.saves || []), ...(cfg.saveDirs || [])]}});

// ---------- обход папок с ограничениями ----------
const SKIPWALK = /^(windows|\$recycle\.bin|system volume information|node_modules|\.git|microsoft|packages|temp|cache|crashdumps|d3dscache|appdata|programdata|winsxs)$/i;
function walk(root, maxDepth, visit, cap = 5000) {
  let n = 0; const q = [[root, 0]];
  while (q.length) {
    const [d, k] = q.shift();
    for (const e of ents(d)) {
      if (++n > cap) return;
      const p = J(d, e.name);
      if (e.isDirectory()) { if (visit(p, e.name, k, true) === false) return; if (k < maxDepth && !SKIPWALK.test(e.name)) q.push([p, k + 1]); }
      else if (visit(p, e.name, k, false) === false) return;
    }
  }
}
function hasContent(dir, depth = 3) {
  let found = false; walk(dir, depth - 1, (p, n, k, isD) => { if (!isD) { found = true; return false; } }, 300); return found;
}

// ---------- сопоставление названий ----------
const mk = (dir, name, parent) => ({dir, name, parent: parent || '', p: S.prep(name), w: new Set(S.words(name)), c: S.fold(name).replace(/[^a-z0-9а-я]/g, '')});
const STOP = new Set(['the', 'of', 'and', 'game', 'edition', 'a', 'an']);
function prefilter(entries, q) {
  const qw = S.words(q).filter(w => w.length > 2 && !STOP.has(w)); if (!qw.length) return entries;
  return entries.filter(e => qw.some(w => e.w.has(w) || e.c.includes(w)));
}
// лучшее совпадение названия игры среди папок; «Half-Life» не склеивается с «Half-Life 2»
function pick(q, entries) {
  entries = prefilter(entries, q); if (!entries.length) return null;
  // «The Elder Scrolls V: Skyrim Special Edition» находится и по папке «Skyrim Special Edition», «Uncharted 3: Drake's Deception» по «Uncharted 3»
  const parts = [[q, 1], ...q.split(/\s*[:\u2013\u2014]\s+|\s+-\s+/).filter(x => x !== q && x.length >= 8 && S.words(x).length >= 2).map(x => [x, .9])];
  const vs = parts.map(([x, w]) => [x, w, S.variants(x)]), qw = new Set(S.words(q));
  const sc = entries.map(e => ({e, s: Math.max(...vs.map(([x, w, v]) => w * S.score(x, e.name, {variants: v, candidate: e.p})), S.score(e.name, q) * .97)})).sort((a, b) => b.s - a.s);
  const a = sc[0], b = sc[1];
  if (a.s >= 975) return a.e;
  if (a.s >= 850 && (!b || b.s <= a.s - 60)) { const extra = S.words(a.e.name).filter(w => !qw.has(w)); if (!extra.some(w => /^\d{1,2}$/.test(w))) return a.e; }
  return null;
}
const SKIPTOP = /^(microsoft|packages|temp|programs|google|mozilla|nvidia( corporation)?|adobe|discord|crashdumps|d3dscache|connecteddevices|comms|history|code|slack|spotify|steam|squirrel|pip|npm|yarn|jetbrains|opera|opera software|brave|chrome|vivaldi|telegram desktop|whatsapp|zoom|onedrive|electron|nexus|game tracker|\.\w+)$/i;
function listDirs(st, base, deep) {
  const key = low(base) + '|' + (deep ? 2 : 1); if (st.idx[key]) return st.idx[key];
  const out = [];
  for (const n of dirNames(base)) {
    if (SKIPTOP.test(n)) continue; out.push(mk(J(base, n), n));
    if (deep) { let k = 0; for (const m of dirNames(J(base, n))) { if (++k > 80) break; out.push(mk(J(base, n, m), m, n)); } }
    if (out.length > 6000) break;
  }
  return st.idx[key] = out;
}

// ---------- Steam ----------
const ACF = (t, k) => (t.match(new RegExp('"' + k + '"\\s+"([^"]*)"', 'i')) || [])[1] || '';
function steamInfo(ctx) {
  const roots = new Set(), libs = new Set(), games = [];
  const cand = [...ctx.pf.map(p => J(p, 'Steam')), ...(ctx.extra.steam || []), ...ctx.drives.flatMap(d => ['Steam', 'Program Files (x86)\\Steam', 'Program Files\\Steam', 'Games\\Steam', 'SteamLibrary', 'Games\\SteamLibrary', 'Steam Library', 'Games\\Steam Library'].map(s => d + s))];
  for (const c of uniq(cand)) {
    if (isDir(J(c, 'steamapps'))) libs.add(J(c, 'steamapps'));
    if (isDir(J(c, 'userdata')) || isFile(J(c, 'steam.exe'))) roots.add(c);
    const vdf = ok(() => fs.readFileSync(J(c, 'steamapps', 'libraryfolders.vdf'), 'utf8'), '');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) { const p = J(m[1].replace(/\\\\/g, '\\'), 'steamapps'); if (isDir(p)) libs.add(p); }
  }
  const users = [...roots].flatMap(r => dirNames(J(r, 'userdata')).filter(i => /^\d+$/.test(i) && i !== '0').map(i => J(r, 'userdata', i)));
  for (const lib of libs) for (const f of ents(lib).map(e => e.name)) {
    if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
    const t = ok(() => fs.readFileSync(J(lib, f), 'utf8'), ''), id = ACF(t, 'appid'), name = ACF(t, 'name'), inst = ACF(t, 'installdir');
    const dir = J(lib, 'common', inst); if (id && name && inst && isDir(dir)) games.push({appid: id, name, dir});
  }
  return {roots: [...roots], libs: [...libs], users, games, commons: [...libs].map(l => J(l, 'common')).filter(isDir)};
}

// ---------- папки с играми ----------
function gameRoots(ctx, steam) {
  const L = steam.commons.map(dir => ({dir}));
  const sub = ['Games', 'Game', 'Игры', 'GOG Games', 'GOG Galaxy\\Games', 'Epic Games', 'XboxGames', 'Repack', 'Repacks', 'Games\\Repacks', 'Program Files\\Epic Games', 'Program Files (x86)\\GOG Galaxy\\Games', 'Program Files (x86)\\Origin Games', 'Program Files\\EA Games', 'Program Files\\Rockstar Games', 'Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games'];
  for (const d of ctx.drives) for (const s of sub) L.push({dir: d + s, deep: /^(games|game|игры|repacks?)$/i.test(s)});
  for (const p of ctx.pf) { L.push({dir: p}); for (const s of ['Epic Games', 'GOG Galaxy\\Games', 'Origin Games', 'EA Games', 'Rockstar Games', 'Ubisoft\\Ubisoft Game Launcher\\games']) L.push({dir: p + (p.endsWith('\\') || p.endsWith('/') ? '' : path.sep) + s.replace(/\\/g, path.sep)}); }
  for (const d of ctx.extra.games || []) L.push({dir: d, deep: true});
  const seen = new Set();
  return L.filter(r => { const k = low(r.dir); if (seen.has(k) || !isDir(r.dir)) return false; seen.add(k); return true; });
}
const BAD_EXE = /(unins|uninstall|setup|install|redist|vc_?redist|dxsetup|dotnet|crash|report|helper|updater|update|ue4prereq|prereq|easyanticheat|eac_|battleye|beservice|cef|notification|webhelper|oalinst|physx|7z|benchmark|bugsplat|sentry|launcher_?service|dxwebsetup|vcredist)/i;
function findExe(dir, name) {
  const qk = S.key(S.cleanName(name) || name), list = [];
  walk(dir, 3, (p, n, k, isD) => {
    if (isD || !/\.exe$/i.test(n) || BAD_EXE.test(n)) return;
    const size = ok(() => fs.statSync(p).size, 0), base = n.replace(/\.exe$/i, '');
    let sc = Math.log10(1 + size) * 4 - k * 6;
    const bk = S.key(S.cleanName(base) || base);
    if (bk && qk && (bk === qk || qk.includes(bk) || bk.includes(qk))) sc += 60;
    if (/shipping|win64|x64/i.test(p)) sc += 6;
    if (/launcher/i.test(n)) sc -= 15;
    list.push({p, sc});
  }, 1500);
  list.sort((a, b) => b.sc - a.sc); return list[0] ? list[0].p : '';
}
const appidIn = dir => {
  for (const rel of ['steam_appid.txt', 'steam_settings/steam_appid.txt']) { const t = ok(() => fs.readFileSync(J(dir, rel), 'utf8').trim(), ''); if (/^\d{3,8}$/.test(t)) return t; }
  let id = ''; walk(dir, 2, (p, n) => { if (!id && /^steam_appid\.txt$/i.test(n)) { const t = ok(() => fs.readFileSync(p, 'utf8').trim(), ''); if (/^\d{3,8}$/.test(t)) { id = t; return false; } } }, 600);
  return id;
};

// ---------- сохранения ПК-игр ----------
const INGAME = /^(saves?|savedata|save ?games?|savegames?|saved games|profiles?|appdata|userdata|player|goldberg steamemu saves|gse saves|steam_settings|slots?)$/i;
const PIRATE_BASES = c => [J(c.roaming, 'Goldberg SteamEmu Saves'), J(c.roaming, 'GSE Saves'), J(c.roaming, 'Steam'), c.pub && J(c.pub, 'Documents', 'Steam'), c.pub && J(c.pub, 'Documents'), c.programData && J(c.programData, 'Steam'), J(c.roaming, 'SmartSteamEmu')].filter(Boolean);
function pcSaves(g, ctx, st) {
  const out = [], add = (p, kind, label, rank) => { if (p && isDir(p) && !out.some(x => low(x.path) === low(p))) out.push({path: p, kind, label, rank}); };
  if (g.appid) {
    for (const u of st.steam.users) add(J(u, String(g.appid)), 'steam', 'Steam userdata', 10);
    for (const b of PIRATE_BASES(ctx)) {
      const lbl = /goldberg|gse/i.test(b) ? 'Goldberg' : 'Эмулятор Steam';
      add(J(b, String(g.appid)), 'emu-steam', lbl, 12);
      for (const grp of dirNames(b).slice(0, 40)) add(J(b, grp, String(g.appid)), 'emu-steam', /^(codex|rune|onlinefix|empress|skidrow|plaza|cpy|goldberg)/i.test(grp) ? grp.toUpperCase() : 'Эмулятор Steam: ' + grp, 12);
    }
  }
  const bases = [[ctx.savedGames, 'saved-games', 'Saved Games', 20, true], ...ctx.docs.flatMap(d => [[J(d, 'My Games'), 'my-games', 'Documents\\My Games', 25, false], [d, 'documents', 'Documents', 30, true]]),
    [ctx.locallow, 'locallow', 'AppData\\LocalLow', 40, true], [ctx.roaming, 'roaming', 'AppData\\Roaming', 50, true], [ctx.local, 'local', 'AppData\\Local', 60, true], ...(ctx.extra.saves || []).map(d => [d, 'custom', d, 35, true])];
  for (const [base, kind, label, rank, deep] of bases) {
    if (!isDir(base)) continue;
    const e = pick(g.name, listDirs(st, base, deep)); if (e && hasContent(e.dir)) add(e.dir, kind, label, rank);
  }
  const dirs = uniq([g.dir, ...(g.dirs || [])]).filter(isDir);
  for (const d of dirs) for (const n of dirNames(d)) {
    if (INGAME.test(n) && hasContent(J(d, n))) add(J(d, n), 'in-game', 'В папке игры', 70);
    else if (!SKIPWALK.test(n)) for (const m of dirNames(J(d, n)).slice(0, 60)) if (INGAME.test(m) && hasContent(J(d, n, m))) add(J(d, n, m), 'in-game', 'В папке игры', 72);
  }
  return out.sort((a, b) => a.rank - b.rank || mtime(b.path) - mtime(a.path));
}

// ---------- эмуляторы: exe, образы, сохранения ----------
function findEmuExe(emu, ctx, cfgEmus) {
  const known = cfgEmus && cfgEmus[emu.id]; if (known && isFile(known)) return known;
  const roots = [];
  for (const d of ctx.drives) for (const n of ['Emulators', 'Emulator', 'Emu', 'Emulation', 'Games\\Emulators', 'Games\\Emulator', 'Эмуляторы']) roots.push([d + n, 4]);
  for (const p of ctx.pf) roots.push([p, 2]);
  roots.push([J(ctx.local, 'Programs'), 2], [ctx.downloads, 3], [ctx.desktop, 3], [ctx.roaming, 2], [ctx.local, 2], ...ctx.docs.map(d => [J(d, 'Emulators'), 3]), ...(ctx.extra.emus || []).map(d => [d, 4]));
  let hit = '';
  for (const [r, depth] of roots) {
    if (!isDir(r)) continue;
    walk(r, depth, (p, n, k, isD) => { if (!isD && emu.exe.test(n) && !/unins|crash|updater|setup|install/i.test(n)) { hit = p; return false; } }, 6000);
    if (hit) break;
  }
  return hit;
}
function emuSaves(emuId, exe, ctx, g = {}, serial = '') {
  const d = exe ? path.dirname(exe) : '', out = [], pl = new Set(g.playedOn || []);
  const add = (p, label, rank = 5) => { if (isDir(p) && !out.some(x => low(x.path) === low(p))) out.push({path: p, kind: 'emulator', label, rank}); };
  const bases = (...n) => uniq([d, d && J(d, 'portable'), d && J(d, 'user'), ...n.flatMap(x => [J(ctx.roaming, x), J(ctx.local, x), ...ctx.docs.map(dd => J(dd, x))])]);
  const bySerial = (dir, label) => { if (serial && isDir(dir)) for (const s of dirNames(dir)) if (s.toUpperCase().startsWith(serial.toUpperCase())) add(J(dir, s), label + ': сохранения этой игры', 4); };
  switch (emuId) {
    case 'rpcs3': for (const b of bases('rpcs3', 'RPCS3')) { const home = J(b, 'dev_hdd0', 'home'); for (const prof of dirNames(home)) { const sd = J(home, prof, 'savedata'); bySerial(sd, 'RPCS3'); add(sd, 'RPCS3 (PS3)'); } } break;
    case 'yuzu': for (const b of bases('yuzu', 'eden', 'suyu', 'sudachi', 'citron')) { add(J(b, 'nand', 'user', 'save'), 'yuzu / Eden (Switch)'); add(J(b, 'bis', 'user', 'save'), 'yuzu / Eden (Switch)'); } break;
    case 'ryujinx': for (const b of bases('Ryujinx')) { add(J(b, 'bis', 'user', 'save'), 'Ryujinx (Switch)'); add(J(b, 'nand', 'user', 'save'), 'Ryujinx (Switch)'); } break;
    case 'pcsx2': for (const b of bases('PCSX2', 'pcsx2')) add(J(b, 'memcards'), 'PCSX2: memory cards (*.ps2)'); break;
    case 'duckstation': for (const b of bases('DuckStation')) add(J(b, 'memcards'), 'DuckStation: memory cards'); break;
    case 'dolphin': for (const b of bases('Dolphin Emulator')) for (const u of [b, J(b, 'User')]) { if (!pl.size || !pl.has('wii') || pl.has('gc')) add(J(u, 'GC'), 'Dolphin (GameCube)'); if (!pl.size || pl.has('wii')) add(J(u, 'Wii', 'title'), 'Dolphin (Wii)'); } break;
    case 'ppsspp': for (const b of bases('PPSSPP')) for (const u of [b, J(b, 'memstick')]) { const sd = J(u, 'PSP', 'SAVEDATA'); bySerial(sd, 'PPSSPP'); add(sd, 'PPSSPP (PSP)'); } break;
    case 'vita3k': for (const b of bases('Vita3K', J('Vita3K', 'Vita3K'))) add(J(b, 'ux0', 'user', '00', 'savedata'), 'Vita3K (PS Vita)'); break;
    case 'cemu': for (const b of bases('Cemu')) add(J(b, 'mlc01', 'usr', 'save'), 'Cemu (Wii U)'); break;
    case 'citra': for (const b of bases('Citra', 'Azahar', 'Lime3DS', 'Mandarine')) add(J(b, 'sdmc', 'Nintendo 3DS'), 'Citra / Azahar (3DS)'); break;
    case 'shadps4': for (const b of bases('shadPS4')) add(J(b, 'user', 'savedata'), 'shadPS4 (PS4)'); break;
    case 'xenia': for (const b of bases('Xenia', 'xenia')) add(J(b, 'content'), 'Xenia (Xbox 360)'); break;
    default: for (const s of ['saves', 'Saves', 'save', 'Save', 'sav', 'battery', 'Battery', 'User/Saves']) add(J(d, s), 'Папка сохранений эмулятора');
  }
  return out;
}

// ---------- образы и ROM ----------
const ROM_EXT = new Set(Emu.EMUS.flatMap(e => e.ext).filter(x => x !== 'exe' && x !== 'zip' && x !== '7z' && x !== 'gz'));
function romIndex(ctx, st, cfgEmus) {
  if (st.roms) return st.roms;
  const roots = [];
  for (const d of ctx.drives) for (const n of ['ROMs', 'Roms', 'roms', 'ROM', 'Games\\ROMs', 'Games\\Roms', 'Emulators\\ROMs', 'Emulation\\roms', 'Games\\Emulators\\ROMs', 'ISO', 'ISOs', 'Games\\ISO', 'Games\\Consoles']) roots.push([d + n, 5]);
  for (const d of ctx.docs) roots.push([J(d, 'ROMs'), 4]);
  for (const r of ctx.extra.roms || []) roots.push([r, 5]);
  roots.push([ctx.downloads, 3]);
  for (const exe of Object.values(cfgEmus || {})) { const dd = path.dirname(String(exe)); for (const n of ['roms', 'games', 'ROMs', 'Games']) roots.push([J(dd, n), 4]); }
  const list = [], seen = new Set(), dirGames = new Set();
  for (const [r, depth] of roots) {
    if (!isDir(r) || seen.has(low(r))) continue; seen.add(low(r));
    walk(r, depth, (p, n, k, isD) => {
      if (isD) return;
      const lower = n.toLowerCase(), ext = Emu.extOf(n);
      if (lower === 'param.sfo') {                                                   // игра в папке: PS3 (PS3_GAME), PS4 / Vita (sce_sys)
        const up = path.dirname(p), base = /^(sce_sys|ps3_game)$/i.test(path.basename(up)) ? path.dirname(up) : up;
        if (!dirGames.has(low(base))) { dirGames.add(low(base)); const t = Emu.sfoTitle(p); list.push({path: base, dir: true, name: t ? t.title : Emu.cleanRomName(path.basename(base)), serial: t ? t.id : ''}); }
        return;
      }
      if (ROM_EXT.has(ext)) list.push({path: p, dir: false, name: (Emu.gameFromRom(null, p) || {}).name || Emu.cleanRomName(n), ext});
    }, 20000);
  }
  // для пары .cue + .bin оставляем только .cue; ненужные .bin (eboot.bin и др.) не считаем образами
  const cues = new Set(list.filter(x => x.ext === 'cue').map(x => low(x.path).replace(/\.cue$/, '')));
  st.roms = list.filter(x => x.dir || !(x.ext === 'bin' && (cues.has(low(x.path).replace(/\.bin$/, '')) || /eboot\.bin$/i.test(x.path)))).map(x => ({...x, e: mk(x.path, x.name)}));
  return st.roms;
}
function findRom(g, platform, ctx, st, cfgEmus) {
  const all = romIndex(ctx, st, cfgEmus).filter(r => r.dir ? true : !!Emu.emuForRom(r.path, platform));
  const e = pick(g.name, all.map(r => r.e)); if (!e) return null;
  return all.find(r => r.e === e) || null;
}

const PC_PLAT = new Set(['pc', 'mac', 'linux', '']);
const consolePlat = g => (g.playedOn || []).find(x => !PC_PLAT.has(x)) || '';

// ---------- главная функция: всё о конкретной игре ----------
// g: {name, src, id, launch, dir, dirs, savePath, playedOn, emu, appid}; cfg: {emulators, finder}
// → {onDevice, launch, dir, appid, emuId, emuExe, serial, saves:[{path,kind,label,rank}], savePath}
function scanGame(g, ctx, st, cfg = {}) {
  const res = {onDevice: false, launch: '', dir: '', appid: g.appid || '', emuId: '', emuExe: '', serial: '', saves: [], savePath: ''};
  const emus = cfg.emulators || {}, plat = consolePlat(g);
  const launchOk = g.launch && ok(() => fs.existsSync(String(g.launch).replace(/^"(.*)"$/, '$1')), false);
  const ext = Emu.extOf(g.launch), imageLaunch = launchOk && (ext && ext !== 'exe' && Emu.emuForRom(g.launch, plat));
  if (plat || g.emu || imageLaunch) {                                        // эмуляторная игра: образ + эмулятор
    const plat2 = plat || (g.emu && Emu.byId[g.emu] ? Emu.byId[g.emu].platform : '');
    let rom = launchOk ? {path: String(g.launch).replace(/^"(.*)"$/, '$1'), dir: isDir(g.launch)} : findRom(g, plat2, ctx, st, emus);
    if (rom) { res.launch = rom.path; res.onDevice = true; res.serial = rom.serial || ''; if (rom.dir && !res.serial) res.serial = (Emu.sfoTitle(rom.path) || {}).id || ''; }
    const emu = (g.emu && Emu.byId[g.emu]) || (rom && Emu.emuForRom(rom.path, plat)) || (plat && Emu.EMUS.find(e => e.args && e.platform === plat)) || null;
    if (emu) { res.emuId = emu.id; st.emuExe = st.emuExe || {}; if (!(emu.id in st.emuExe)) st.emuExe[emu.id] = findEmuExe(emu, ctx, emus); res.emuExe = st.emuExe[emu.id]; res.saves = emuSaves(emu.id, res.emuExe, ctx, g, res.serial); }
    res.saves.sort((a, b) => a.rank - b.rank);
  } else {                                                                     // игра для ПК: папка, exe, appid, сохранения
    const numericId = g.src === 'steam' && /^\d+$/.test(String(g.id || '')) ? String(g.id) : '';
    let dir = uniq([g.dir, ...(g.dirs || [])]).find(isDir) || '', appid = g.appid || numericId;
    if (!dir) {
      const sg = (appid && st.steam.games.find(x => x.appid === String(appid))) || (() => { const e = pick(g.name, st.steam.games.map(x => ({...mk(x.dir, x.name), game: x}))); return e && e.game; })();
      if (sg) { dir = sg.dir; appid = appid || sg.appid; }
    }
    if (!dir) {
      if (!st.folders) st.folders = gameRoots(ctx, st.steam).flatMap(r => listDirs(st, r.dir, !!r.deep));
      const e = pick(g.name, st.folders); if (e) dir = e.dir;
    }
    if (dir) {
      res.dir = dir; res.onDevice = true;
      const l = launchOk && g.launch;
      res.launch = l || findExe(dir, g.name);
      if (!appid) appid = appidIn(dir);
    } else if (launchOk) { res.onDevice = true; res.launch = String(g.launch).replace(/^"(.*)"$/, '$1'); }
    res.appid = appid || '';
    res.saves = pcSaves({...g, dir: dir || g.dir, appid}, ctx, st);
  }
  res.savePath = (res.saves[0] || {}).path || '';
  return res;
}

const newState = (ctx) => ({idx: {}, steam: steamInfo(ctx), roms: null, folders: null, emuExe: {}});
module.exports = {defaultCtx, withExtra, newState, scanGame, steamInfo, gameRoots, findExe, findEmuExe, emuSaves, pcSaves, findRom, romIndex, pick, appidIn, hasContent, isDir};
