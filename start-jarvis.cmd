@echo off
cd /d "%~dp0"
if not exist "release\win-unpacked\JARVIS.exe" (
  echo JARVIS.exe was not found. Run npm run package first.
  pause
  exit /b 1
)
start "" "%~dp0release\win-unpacked\JARVIS.exe"
