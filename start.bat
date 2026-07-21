@echo off
setlocal
cd /d "%~dp0"
REM Clear env vars that would make electron degrade into Node
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
REM Launch the widget
start "" "%~dp0node_modules\electron\dist\electron.exe" .
endlocal
