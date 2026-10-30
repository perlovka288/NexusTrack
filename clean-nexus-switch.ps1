# Удаляет из библиотеки NEXUS игры, которые были добавлены автоматически из журнала консоли.
# Сначала закройте NEXUS (в том числе в трее). Резервная копия: library.json.before-clean
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'NEXUS' -ErrorAction SilentlyContinue) { Write-Host 'Закройте NEXUS полностью (и в трее), потом запустите скрипт снова.'; exit 1 }
$f = Get-ChildItem -Path $env:APPDATA -Filter library.json -Recurse -Depth 3 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'data\\library\.json$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $f) { Write-Host 'library.json не найден в %APPDATA%'; exit 1 }
Write-Host "Файл: $($f.FullName)"
Copy-Item $f.FullName "$($f.FullName).before-clean" -Force
$lib = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$del = @()
foreach ($p in @($lib.PSObject.Properties)) {
  $g = $p.Value
  # автодобавленные: id вида sw0100XXXXXXXXXXXX или sw + 12 hex, есть данные консоли
  if ($p.Name -match '^sw(0100[0-9a-fA-F]{12}|[0-9a-f]{12})(-\d+)?$' -and $g.switchPlay) { $del += $p.Name }
}
foreach ($n in $del) { $lib.PSObject.Properties.Remove($n) }
$json = $lib | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($f.FullName, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Удалено игр: $($del.Count). Остальное не тронуто."
Write-Host "Если что-то пошло не так, верните файл library.json.before-clean на место library.json."
