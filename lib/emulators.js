'use strict';
// NEXUS: эмуляторы. Определяет запущенный эмулятор, образ/ROM (по командной строке или заголовку окна),
// название игры и платформу, а также собирает команду запуска образа.
const fs = require('fs'), path = require('path');
const S = require('../public/search.js');

const PS_EXT = ['iso', 'bin', 'cue', 'chd', 'img', 'mdf', 'cso', 'pbp', 'elf', 'ecm', 'm3u', 'gz', 'isz', 'dump'];
// ps: имя процесса (начало), exe: точное имя файла, ext: расширения образов, args(rom): аргументы запуска образа,
// dirGame: игра запускается из папки (PS3/PS4/Vita), plat(ctx): платформа, если эмулятор поддерживает несколько систем
const EMUS = [
  {id: 'duckstation', name: 'DuckStation', platform: 'ps1', ps: 'duckstation', ext: ['cue', 'bin', 'iso', 'chd', 'pbp', 'img', 'mdf', 'ecm', 'm3u', 'exe'], args: (r, o) => ['-batch', ...(o.fs ? ['-fullscreen'] : []), '--', r]},
  {id: 'pcsx2', name: 'PCSX2', platform: 'ps2', ps: 'pcsx2', ext: ['iso', 'chd', 'cso', 'gz', 'bin', 'mdf', 'elf', 'isz', 'dump'], args: (r, o) => ['-batch', ...(o.fs ? ['-fullscreen'] : []), '--', r]},
  {id: 'rpcs3', name: 'RPCS3', platform: 'ps3', ps: 'rpcs3', ext: ['iso', 'pkg', 'bin', 'self', 'elf'], dirGame: true, args: r => ['--no-gui', r]},                       // RPCS3: без главного окна, сразу игра
  {id: 'shadps4', name: 'shadPS4', platform: 'ps4', ps: 'shadps4', ext: ['bin', 'elf'], dirGame: true, args: (r, o) => ['-g', r, ...(o.fs ? ['-f', 'true'] : [])]},
  {id: 'ppsspp', name: 'PPSSPP', platform: 'psp', ps: 'ppsspp', ext: ['iso', 'cso', 'pbp', 'elf', 'prx'], args: (r, o) => [...(o.fs ? ['--fullscreen'] : []), r]},
  {id: 'vita3k', name: 'Vita3K', platform: 'vita', ps: 'vita3k', ext: ['vpk', 'zip'], dirGame: true, args: r => [r]},
  {id: 'cemu', name: 'Cemu', platform: 'wiiu', ps: 'cemu', ext: ['wud', 'wux', 'wua', 'rpx', 'iso', 'wup'], args: (r, o) => [...(o.fs ? ['-f'] : []), '-g', r]},
  {id: 'dolphin', name: 'Dolphin', platform: 'wii', ps: 'dolphin', ext: ['iso', 'gcm', 'rvz', 'wbfs', 'ciso', 'gcz', 'wad', 'dol', 'elf', 'tgc'], args: r => ['-b', '-e', r],                                              // Dolphin: -b закрывает окно выбора, -e запускает образ
    plat: c => /\.(gcm|tgc)$/i.test(c.rom || '') ? 'gc' : (c.gameId && /^[GDPU]/.test(c.gameId) ? 'gc' : 'wii')},
  {id: 'ryujinx', name: 'Ryujinx', platform: 'switch', ps: 'ryujinx', ext: ['nsp', 'xci', 'nca', 'nro', 'nso', 'pfs0'], args: (r, o) => [...(o.fs ? ['-f'] : []), r]},
  {id: 'yuzu', name: 'yuzu / Eden / Suyu', platform: 'switch', ps: 'yuzu|suyu|eden|sudachi|citron', ext: ['nsp', 'xci', 'nca', 'nro', 'nso'], args: (r, o) => [...(o.fs ? ['-f'] : []), '-g', r]},
  {id: 'citra', name: 'Citra / Azahar / Lime3DS', platform: 'ds', ps: 'citra|lime3ds|azahar|mandarine', ext: ['3ds', 'cci', 'cxi', 'cia', '3dsx', 'app'], args: r => [r]},
  {id: 'melonds', name: 'melonDS', platform: 'ds', ps: 'melonds', ext: ['nds', 'dsi', 'srl'], args: r => [r]},
  {id: 'desmume', name: 'DeSmuME', platform: 'ds', ps: 'desmume', ext: ['nds'], args: r => [r]},
  {id: 'mgba', name: 'mGBA', platform: 'gb', ps: 'mgba', ext: ['gba', 'gb', 'gbc', 'sgb', 'zip', '7z'], args: (r, o) => [...(o.fs ? ['-f'] : []), r]},
  {id: 'vbam', name: 'VisualBoyAdvance-M', platform: 'gb', ps: 'visualboyadvance', ext: ['gba', 'gb', 'gbc', 'zip'], args: r => [r]},
  {id: 'snes9x', name: 'Snes9x', platform: 'snes', ps: 'snes9x', ext: ['sfc', 'smc', 'fig', 'swc', 'bs', 'st', 'zip'], args: r => [r]},
  {id: 'bsnes', name: 'bsnes', platform: 'snes', ps: 'bsnes', ext: ['sfc', 'smc', 'zip'], args: r => [r]},
  {id: 'mesen', name: 'Mesen', platform: 'nes', ps: 'mesen', ext: ['nes', 'fds', 'unf', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'zip'], args: r => [r],
    plat: c => /\.(sfc|smc)$/i.test(c.rom || '') ? 'snes' : /\.(gb|gbc|gba)$/i.test(c.rom || '') ? 'gb' : 'nes'},
  {id: 'fceux', name: 'FCEUX', platform: 'nes', ps: 'fceux', ext: ['nes', 'fds', 'unf', 'nsf', 'zip'], args: r => [r]},
  {id: 'nestopia', name: 'Nestopia', platform: 'nes', ps: 'nestopia', ext: ['nes', 'fds', 'unf', 'zip'], args: r => [r]},
  {id: 'project64', name: 'Project64', platform: 'n64', ps: 'project64', ext: ['z64', 'n64', 'v64', 'zip', '7z'], args: r => [r]},
  {id: 'xenia', name: 'Xenia', platform: 'x360', ps: 'xenia', ext: ['iso', 'xex', 'zar', 'xbla', 'god'], args: r => [r]},
  {id: 'xemu', name: 'xemu', platform: 'xog', ps: 'xemu', ext: ['iso', 'xiso'], args: r => ['-dvd_path', r]},
  {id: 'retroarch', name: 'RetroArch', platform: 'other', ps: 'retroarch', ext: [], args: null}   // платформа зависит от ядра: только отслеживание
];
const byId = Object.fromEntries(EMUS.map(e => [e.id, e]));
const exeRe = e => new RegExp('^(' + e.ps + ')[\\w.\\- ]*\\.exe$', 'i');
for (const e of EMUS) e.exe = exeRe(e);
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();

// эмулятор по пути к exe (null, если это не эмулятор)
function detect(exePath) { const b = baseName(exePath); if (!b) return null; return EMUS.find(e => e.exe.test(b)) || null; }
// шаблон для PowerShell: какие процессы опрашивать подробно (командная строка и заголовок окна)
const psPattern = () => '^(' + EMUS.map(e => e.ps).join('|') + ')';

// разбор командной строки Windows с кавычками → массив аргументов
function parseCmd(cmd) {
  const out = []; let cur = '', q = false, any = false;
  for (const ch of String(cmd || '')) {
    if (ch === '"') { q = !q; any = true; continue; }
    if (/\s/.test(ch) && !q) { if (any || cur) out.push(cur); cur = ''; any = false; continue; }
    cur += ch; any = true;
  }
  if (any || cur) out.push(cur);
  return out;
}
const extOf = p => { const m = String(p || '').match(/\.([a-z0-9]{1,5})$/i); return m ? m[1].toLowerCase() : ''; };
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };

// образ/ROM из командной строки: первый аргумент с подходящим расширением (или существующая папка игры)
function romFromCmd(emu, cmd) {
  if (!emu || !cmd) return '';
  const args = parseCmd(cmd).slice(1);
  const exts = new Set(emu.ext || []);
  for (const a of args) {
    if (!a || a.startsWith('-') && !/[\\/]/.test(a)) continue;
    if (/^[a-z]:[\\/]|^\\\\|^\//i.test(a) || /[\\/]/.test(a)) {
      if (exts.has(extOf(a))) return a;
      if (emu.dirGame && exists(a)) return a;
    }
  }
  return '';
}

// --- PARAM.SFO (PS3/PS4/Vita): в нём лежит настоящее название игры ---
function readSfo(buf) {
  try {
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46535000) return null;
    const keyOff = buf.readUInt32LE(8), dataOff = buf.readUInt32LE(12), n = Math.min(buf.readUInt32LE(16), 200), out = {};
    for (let i = 0; i < n; i++) {
      const e = 20 + i * 16, kOff = keyOff + buf.readUInt16LE(e), fmt = buf.readUInt16LE(e + 2), len = buf.readUInt32LE(e + 4), dOff = dataOff + buf.readUInt32LE(e + 12);
      const key = buf.toString('latin1', kOff, buf.indexOf(0, kOff));
      out[key] = fmt === 0x0404 ? buf.readUInt32LE(dOff) : buf.toString('utf8', dOff, dOff + len).replace(/\0[\s\S]*$/, '');
    }
    return out;
  } catch { return null; }
}
function sfoTitle(start) {
  let d = start; try { if (fs.statSync(d).isFile()) d = path.dirname(d); } catch { return null; }
  for (let up = 0; up < 5; up++, d = path.dirname(d)) {
    for (const sub of ['', 'sce_sys', 'PS3_GAME', path.join('PS3_GAME', 'sce_sys')]) {
      const dir = path.join(d, sub); let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
      const f = names.find(n => n.toLowerCase() === 'param.sfo');
      if (f) { const j = readSfo(fs.readFileSync(path.join(dir, f))); const t = j && (j.TITLE || j.STITLE); if (t) return {title: String(t).replace(/\s+/g, ' ').trim(), id: j.TITLE_ID || j.CONTENT_ID || ''}; }
    }
    if (path.dirname(d) === d) break;
  }
  return null;
}

// --- названия ---
const SERIAL = /^[A-Z]{4}[-_ ]?\d{5}$|^[A-Z]{3,4}-\d{3,5}$/;
function cleanRomName(file) {
  let s = String(file || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ');
  s = s.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ').replace(/\b(disc|disk|cd)\s*\d+\b/gi, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  return s;
}
// название игры по образу/ROM: PARAM.SFO → имя файла → имя папки
function gameFromRom(emu, rom) {
  if (!rom) return null;
  if (emu && (emu.dirGame || /\/(eboot\.bin|param\.sfo)$/i.test(rom.replace(/\\/g, '/')))) { const t = sfoTitle(rom); if (t) return {name: t.title, serial: t.id}; }
  const b = baseName(rom); let name = cleanRomName(b);
  if (!name || /^(eboot|main|default|game|boot|rom|image|disc|data)$/i.test(name) || SERIAL.test(name)) {
    const folder = baseName(String(rom).replace(/\\/g, '/').replace(/\/[^/]*$/, ''));
    const alt = cleanRomName(folder);
    if (alt && !/^(roms?|games?|isos?|images?|disc|discs|iso|downloads?|emulat\w*)$/i.test(alt) && !SERIAL.test(alt)) name = alt;
  }
  if (!name) return null;
  return {name, serial: SERIAL.test(name) ? name : ''};
}

const EMU_WORD = new RegExp('^(' + EMUS.map(e => e.ps).join('|') + '|retroarch|beetle|mednafen)\\b', 'i');
const STAT_WORD = /(\bfps\b|\bvps\b|\bvulkan\b|\bopengl\b|\bdirect3d\b|\bd3d1[12]\b|\bdx1[12]\b|\bmetal\b|\bsoftware\b|\bhardware\b|\bjit\w*\b|\binterpreter\b|\bcached\b|\bhle\b|\blle\b|\bresolution\b|\bspeed\b|\d+(\.\d+)?\s*%|\bgpu\b|\bcpu\b|\bframe ?time\b|\b\d+(\.\d+)?\s*ms\b|\bsc\b|\bdc\b)/i;
// «Dolphin 5.0-21460 | JIT64 DC | OpenGL | HLE | Super Mario Sunshine (GMSE01)» → «Super Mario Sunshine»
function titleToGame(emu, title) {
  let t = String(title || '').replace(/[\u200e\u200f]/g, '').trim(); if (!t) return null;
  const parts = t.split(/\s*\|\|\s*|\s+\|\s+|\s*\|\s*|\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
  let gameId = '';
  const clean = x => x.replace(/\[[^\]]*\]/g, ' ').replace(/\(([0-9A-Fa-f]{16}|[A-Z0-9]{4,9}|64-bit|32-bit|x64|x86)\)/g, (m, id) => { if (/^[A-Z0-9]{6}$/.test(id)) gameId = gameId || id; return ' '; })
    .replace(/\b[A-Z]{4}-?\d{5}\b/g, ' ').replace(/\bv?\d+(\.\d+){1,4}(-\w+)?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const cands = [];
  for (const p of parts) {
    if (STAT_WORD.test(p)) continue;
    const c = clean(p);
    if (!c || c.length < 2 || /^[\d\s.]+$/.test(c)) continue;
    if (EMU_WORD.test(p) && clean(p.replace(EMU_WORD, '')).length < 2) continue;    // «DuckStation 0.1-6000», «PCSX2» — это имя эмулятора
    if (EMU_WORD.test(c) && /^(\S+\s?){1,2}$/.test(c)) continue;
    cands.push(c);
  }
  if (!cands.length) return null;
  return {name: cands[0], gameId};
}

// платформа с учётом образа/заголовка (Dolphin: GameCube или Wii; Mesen: NES, SNES или Game Boy)
function platformFor(emu, ctx = {}) { return emu.plat ? emu.plat(ctx) : emu.platform; }

// команда запуска образа выбранным эмулятором: {cmd, args}
function launchCmd(emu, emuExe, rom, o = {}) { if (!emu || !emu.args) return null; return {cmd: emuExe, args: emu.args(rom, {fs: o.fullscreen !== false})}; }
// эмулятор для образа по расширению (когда платформа игры не указана): первый подходящий, но только однозначные расширения
const UNIQUE_EXT = {nsp: 'ryujinx', xci: 'ryujinx', wua: 'cemu', wux: 'cemu', wud: 'cemu', rpx: 'cemu', rvz: 'dolphin', wbfs: 'dolphin', gcm: 'dolphin', nds: 'melonds', '3ds': 'citra', cia: 'citra', gba: 'mgba', gbc: 'mgba', sfc: 'snes9x', smc: 'snes9x', z64: 'project64', n64: 'project64', xex: 'xenia', vpk: 'vita3k', pkg: 'rpcs3'};
const emuForRom = (rom, platform) => { const x = extOf(rom); return EMUS.find(e => e.args && (platform ? e.platform === platform || (e.plat && ['gc', 'wii'].includes(platform) && e.id === 'dolphin') : false) && e.ext.includes(x)) || byId[UNIQUE_EXT[x]] || null; };

// где обычно лежат эмуляторы: Program Files, C:\\Emulators, X:\\Games\\Emulators, профиль пользователя, Steam
function emulatorRoots(env = process.env, home = require('os').homedir()) {
  const r = new Set(), add = p => { if (p) r.add(p); };
  for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) add(env[k]);
  add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')); add(env.APPDATA); add(env.LOCALAPPDATA);
  for (const d of ['Desktop', 'Downloads', 'Documents', 'Emulators', 'Games']) add(path.join(home, d));
  if (process.platform === 'win32') for (let c = 67; c <= 90; c++) for (const n of ['Emulators', 'Emulator', 'Эмуляторы', 'Games\\Emulators', 'Games', 'Игры']) add(String.fromCharCode(c) + ':\\' + n);
  else { add('/opt'); add(path.join(home, 'Applications')); }
  return [...r].filter(exists);
}
// ищет exe эмулятора в корнях на глубину до 3 папок; возвращает путь или ''
function locate(emu, roots = emulatorRoots()) {
  if (!emu) return '';
  const walk = (d, depth) => {
    let items = []; try { items = fs.readdirSync(d, {withFileTypes: true}); } catch { return ''; }
    for (const it of items) if (it.isFile() && emu.exe.test(it.name)) return path.join(d, it.name);
    if (depth >= 3) return '';
    for (const it of items) if (it.isDirectory() && !/^(windows|system32|\$recycle\.bin|node_modules|\.git)$/i.test(it.name)) { const f = walk(path.join(d, it.name), depth + 1); if (f) return f; }
    return '';
  };
  for (const r of roots) { const f = walk(r, 0); if (f) return f; }
  return '';
}

module.exports = {emulatorRoots, locate, EMUS, byId, detect, psPattern, parseCmd, romFromCmd, readSfo, sfoTitle, cleanRomName, gameFromRom, titleToGame, platformFor, launchCmd, emuForRom, extOf};
