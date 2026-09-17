@echo off
setlocal

cd /d "%~dp0"

start "oldPC API 4174" cmd /k "npm run api"
start "oldPC Frontend" cmd /k "npm run dev -- --host 127.0.0.1"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo oldPC local RTDB bridge started.
echo Keep the browser tab open while this PC is publishing to RTDB.
endlocal
