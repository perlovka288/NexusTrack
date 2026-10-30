'use strict';
// NEXUS: локальный бэкап сохранений игры в «backups/Игра_ГГГГ-ММ-ДД.zip»
const fs = require('fs'), path = require('path');
const {createZip} = require('./zip');

const LIMIT_FILES = 20000, LIMIT_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// имя файла: «Elden Ring: Nightreign» → «Elden_Ring_Nightreign»
const safeName = s => String(s || 'Game').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 80) || 'Game';

function walk(root, skip) {
  const out = []; let bytes = 0; const stack = [''];
  while (stack.length) {
    const rel = stack.pop(); let items = [];
    try { items = fs.readdirSync(path.join(root, rel), {withFileTypes: true}); } catch { continue; }
    for (const it of items) {
      const r = rel ? rel + '/' + it.name : it.name, abs = path.join(root, r);
      if (skip && (abs === skip || abs.startsWith(skip + path.sep))) continue;
      if (it.isSymbolicLink()) continue;
      if (it.isDirectory()) stack.push(r);
      else if (it.isFile()) {
        let size = 0; try { size = fs.statSync(abs).size; } catch { continue; }
        out.push({abs, name: r, size}); bytes += size;
        if (out.length > LIMIT_FILES) throw new Error(`В папке больше ${LIMIT_FILES} файлов: выберите папку именно с сохранениями`);
        if (bytes > LIMIT_BYTES) throw new Error('Папка слишком большая (больше 4 ГБ): выберите папку именно с сохранениями');
      }
    }
  }
  return {entries: out.sort((a, b) => a.name.localeCompare(b.name)), bytes};
}

// копирует файлы из папки сохранений в zip. Возвращает {file, name, files, bytes, size, at}
async function backupSaves({game, srcDir, outDir, now = new Date()}) {
  const src = path.resolve(String(srcDir || ''));
  let st; try { st = fs.statSync(src); } catch { throw new Error('Папка с сохранениями не найдена'); }
  if (!st.isDirectory()) throw new Error('Укажите папку с сохранениями, а не файл');
  if (path.parse(src).root === src) throw new Error('Нельзя делать бэкап целого диска: выберите папку с сохранениями');
  fs.mkdirSync(outDir, {recursive: true});
  const out = path.resolve(outDir), {entries, bytes} = walk(src, out);
  if (!entries.length) throw new Error('В папке нет файлов');
  let name = `${safeName(game)}_${stamp(now)}.zip`;
  if (fs.existsSync(path.join(out, name))) name = name.replace(/\.zip$/, `_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.zip`);
  const file = path.join(out, name), r = await createZip(file, entries);
  return {file, name, files: r.files, bytes: r.bytes, size: r.size, at: now.toISOString()};
}
// список бэкапов игры (для интерфейса)
function listBackups(outDir, game) {
  const pre = safeName(game) + '_'; let names = [];
  try { names = fs.readdirSync(outDir); } catch { return []; }
  return names.filter(n => n.startsWith(pre) && n.endsWith('.zip')).map(n => { const st = fs.statSync(path.join(outDir, n)); return {name: n, size: st.size, at: st.mtime.toISOString()}; }).sort((a, b) => b.at.localeCompare(a.at));
}
module.exports = {backupSaves, listBackups, safeName, stamp};
