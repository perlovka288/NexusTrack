'use strict';
// NEXUS: проверка локального пути и прямой запуск игры (exe или образ через эмулятор)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const Emu = require('./emulators');

const IMAGE_EXT = new Set(Emu.EMUS.flatMap(e => e.ext).filter(x => x !== 'exe'));
const RUN_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'lnk', 'url', 'sh', 'appimage']);
// вспомогательные exe Steam-игр (настройки, конфиг, установщик): их запуск выглядит как «игра не стартует»
const HELPER_EXE = /(?:^|[\\/])(?:dota2cfg|config|settings|setup|install(?:er)?|unins\d*|crash(?:handler|report(?:er)?)?|dxsetup|vcredist(?:_x\d+)?|dotnet)[^\\/]*\.exe$/i;
const cleanPath = p => String(p == null ? '' : p).trim().replace(/^"(.*)"$/, '$1');

// {exists, kind: file|dir|none, type: exe|image|folder|other, ext, error?}
function checkPath(raw) {
  const p = cleanPath(raw);
  if (!p) return {path: '', exists: false, kind: 'none', type: '', error: 'empty'};
  if (p.length > 500 || /[\0\r\n]/.test(p)) return {path: p.slice(0, 500), exists: false, kind: 'none', type: '', error: 'invalid'};
  if (!path.isAbsolute(p) && !/^[a-z]:[\\/]/i.test(p) && !p.startsWith('\\\\')) return {path: p, exists: false, kind: 'none', type: '', error: 'relative'};
  let st; try { st = fs.statSync(p); } catch { return {path: p, exists: false, kind: 'none', type: '', error: 'missing'}; }
  const ext = Emu.extOf(p);
  if (st.isDirectory()) return {path: p, exists: true, kind: 'dir', type: 'folder', ext: ''};
  return {path: p, exists: st.isFile(), kind: 'file', type: RUN_EXT.has(ext) ? 'exe' : IMAGE_EXT.has(ext) ? 'image' : 'other', ext, size: st.size};
}

// запуск: возвращает {ok, how, emu?} или {ok:false, error, message}
function launchGame(g, o = {}) {
  const spawn = o.spawn || cp.spawn, emus = o.emulators || {}, p = cleanPath(g && g.launch), c = checkPath(p), win0 = (o.platform || process.platform) === 'win32';
  // игра из Steam: если файл не указан или это вспомогательный exe (например dota2cfg), запускаем через Steam
  if (o.steamAppId && (!c.exists || HELPER_EXE.test(p))) {
    try { const ch = spawn(win0 ? 'explorer.exe' : (o.platform || process.platform) === 'darwin' ? 'open' : 'xdg-open', ['steam://rungameid/' + o.steamAppId], {detached: true, stdio: 'ignore'}); if (ch && ch.on) ch.on('error', () => {}); if (ch && ch.unref) ch.unref(); return {ok: true, how: 'steam'}; } catch { return {ok: false, error: 'spawn', message: 'Не удалось запустить через Steam'}; }
  }
  if (!c.exists) return {ok: false, error: 'missing', message: 'Укажите корректный путь к файлу'};
  const run = (cmd, args, cwd) => {
    try { const ch = spawn(cmd, args, {cwd, detached: true, stdio: 'ignore', windowsHide: false}); if (ch && ch.on) ch.on('error', () => {}); if (ch && ch.unref) ch.unref(); return true; } catch { return false; }
  };
  const platform = (g.playedOn || []).filter(x => x !== 'pc' && x !== 'mac' && x !== 'linux')[0] || '';
  // образ или папка игры → эмулятор: заданный у игры, иначе по платформе и расширению
  if (c.type === 'image' || (c.type === 'folder' && g.emu)) {
    const emu = (g.emu && Emu.byId[g.emu]) || Emu.emuForRom(p, platform);
    if (!emu || !emu.args) return {ok: false, error: 'no-emulator', message: 'Не удалось подобрать эмулятор для этого образа'};
    let exe = emus[emu.id];
    if (!exe || !fs.existsSync(exe)) { exe = o.locate ? o.locate(emu) : ''; if (exe && o.onEmulator) o.onEmulator(emu.id, exe); }     // не указан: ищем в обычных папках
    if (!exe || !fs.existsSync(exe)) return {ok: false, error: 'emulator-missing', emu: emu.id, message: `Не найден ${emu.name}. Запустите его один раз (путь запомнится) или укажите в Настройках`};
    const l = Emu.launchCmd(emu, exe, p, {fullscreen: o.fullscreen !== false});
    return run(l.cmd, l.args, path.dirname(exe)) ? {ok: true, how: 'emulator', emu: emu.id} : {ok: false, error: 'spawn', message: 'Не удалось запустить эмулятор'};
  }
  const win = (o.platform || process.platform) === 'win32';
  if (c.type === 'exe') {
    if (win && /\.(bat|cmd)$/i.test(p)) return run(process.env.ComSpec || 'cmd.exe', ['/c', p], path.dirname(p)) ? {ok: true, how: 'exe'} : {ok: false, error: 'spawn', message: 'Не удалось запустить файл'};
    if (win && /\.(lnk|url)$/i.test(p)) return run('explorer.exe', [p], path.dirname(p)) ? {ok: true, how: 'shell'} : {ok: false, error: 'spawn', message: 'Не удалось открыть ярлык'};
    return run(p, [], path.dirname(p)) ? {ok: true, how: 'exe'} : {ok: false, error: 'spawn', message: 'Не удалось запустить файл'};
  }
  // остальное открываем программой по умолчанию
  const opener = win ? ['explorer.exe', [p]] : (o.platform || process.platform) === 'darwin' ? ['open', [p]] : ['xdg-open', [p]];
  return run(opener[0], opener[1], path.dirname(p)) ? {ok: true, how: 'shell'} : {ok: false, error: 'spawn', message: 'Не удалось открыть файл'};
}
module.exports = {checkPath, launchGame, cleanPath, IMAGE_EXT, RUN_EXT};
