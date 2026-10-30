'use strict';
// OTA-обновление: скачивание файла релиза, проверка и замена файлов приложения.
// Форматы download_url: .asar (заменяет resources/app.asar), .zip (файлы поверх папки приложения), .exe (установщик NSIS).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {spawn} = require('child_process');
const {Readable} = require('stream'), {pipeline} = require('stream/promises');

const MAX_BYTES = 1024 * 1024 * 1024;   // 1 ГБ: защита от бесконечной загрузки

function kindOf(url) {
  let p = ''; try { p = new URL(url).pathname.toLowerCase(); } catch {}
  return p.endsWith('.asar') ? 'asar' : p.endsWith('.zip') ? 'zip' : p.endsWith('.exe') ? 'exe' : '';
}

async function download(url, dir, onProgress, sha256) {
  if (!/^https:\/\//i.test(url)) throw new Error('Ссылка на обновление должна быть https.');
  if (!/^[0-9a-f]{64}$/i.test(String(sha256 || ''))) throw new Error('У релиза нет контрольной суммы SHA-256: установка отменена.');
  const kind = kindOf(url); if (!kind) throw new Error('Неподдерживаемый формат файла обновления (нужен .asar, .zip или .exe).');
  fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'update.' + kind);
  const res = await fetch(url, {redirect: 'follow', headers: {'user-agent': 'NEXUS-Updater'}});
  if (!res.ok || !res.body) throw new Error('Сервер обновлений ответил ошибкой ' + res.status);
  if (!/^https:\/\//i.test(res.url || url)) throw new Error('Небезопасное перенаправление при загрузке.');
  const total = +res.headers.get('content-length') || 0;
  if (total > MAX_BYTES) throw new Error('Файл обновления слишком большой.');
  let got = 0, last = 0; const hash = crypto.createHash('sha256');
  const src = Readable.fromWeb(res.body);
  src.on('data', c => {
    got += c.length; hash.update(c);
    if (got > MAX_BYTES) src.destroy(new Error('Файл обновления слишком большой.'));
    const now = Date.now(); if (onProgress && now - last > 120) { last = now; onProgress({received: got, total}); }
  });
  await pipeline(src, fs.createWriteStream(file));
  if (onProgress) onProgress({received: got, total: total || got});
  if (!got) throw new Error('Скачан пустой файл.');
  if (sha256 && hash.digest('hex').toLowerCase() !== String(sha256).toLowerCase()) { fs.rmSync(file, {force: true}); throw new Error('Контрольная сумма файла не совпала. Обновление отменено.'); }
  return {file, kind};
}

// Скрипт-помощник: ждёт выхода NEXUS, заменяет файлы и сам запускает приложение.
// Передаётся параметрами (без подстановки в текст), в UTF-8 с BOM: пути с кириллицей работают.
const PS = String.raw`param([int]$ProcId,[string]$Kind,[string]$Source,[string]$AppDir,[string]$Exe,[string]$Log)
$ErrorActionPreference = 'Stop'
function Log($m) { try { Add-Content -LiteralPath $Log -Value ('[{0}] {1}' -f (Get-Date -Format s), $m) -Encoding UTF8 } catch {} }
function Retry($what, [scriptblock]$act) {
  for ($i = 1; $i -le 40; $i++) { try { & $act; return } catch { Start-Sleep -Milliseconds 750; if ($i -eq 40) { throw } } }
}
try {
  try { $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue; if ($p) { $null = $p.WaitForExit(60000) } } catch {}
  Start-Sleep -Milliseconds 700
  if ($Kind -eq 'asar') {
    $target = Join-Path $AppDir 'resources\app.asar'
    $bak = $target + '.bak'
    if (Test-Path -LiteralPath $target) { Retry 'backup' { Copy-Item -LiteralPath $target -Destination $bak -Force } }
    try { Retry 'replace' { Copy-Item -LiteralPath $Source -Destination $target -Force } }
    catch { if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak -Destination $target -Force }; throw }
  }
  elseif ($Kind -eq 'zip') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = [IO.Path]::GetFullPath($AppDir).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($Source)
    try {
      foreach ($e in $zip.Entries) {
        if ($e.FullName.EndsWith('/')) { continue }
        $dest = [IO.Path]::GetFullPath((Join-Path $AppDir $e.FullName))
        if (-not $dest.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw ('Недопустимый путь в архиве: ' + $e.FullName) }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
        Retry 'extract' { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true) }
      }
    } finally { $zip.Dispose() }
  }
  elseif ($Kind -eq 'exe') {
    $proc = Start-Process -FilePath $Source -ArgumentList '/S' -PassThru -Wait
    Log ('installer exit ' + $proc.ExitCode)
  }
  Log ('ok ' + $Kind)
} catch { Log ('ERROR ' + $_.Exception.Message) }
Start-Process -FilePath $Exe
`;

function apply({file, kind}, {app, quit}) {
  // Режим разработки (npm start): заменять нечего, просто перезапускаем.
  if (!app.isPackaged) { app.relaunch(); quit(); return {dev: true}; }
  if (process.platform !== 'win32') throw new Error('OTA-обновление поддерживается только в Windows.');
  const dir = path.dirname(file), script = path.join(dir, 'apply-update.ps1'), log = path.join(app.getPath('userData'), 'update.log');
  fs.writeFileSync(script, '\ufeff' + PS, 'utf8');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-ProcId', String(process.pid), '-Kind', kind, '-Source', file, '-AppDir', path.dirname(process.execPath), '-Exe', process.execPath, '-Log', log];
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(ps, args, {detached: true, stdio: 'ignore', windowsHide: true});
  child.unref();
  quit();   // → app.exit(0): файлы освобождаются, скрипт заменяет их и запускает NEXUS заново
  return {dev: false};
}

module.exports = {download, apply, kindOf};
