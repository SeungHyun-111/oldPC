@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 4174,5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*local-rtdb-bridge-tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo oldPC local RTDB bridge stopped.
endlocal
