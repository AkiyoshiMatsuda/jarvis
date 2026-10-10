@echo off
cd /d "%~dp0"
set "JARVIS_OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not exist "%JARVIS_OLLAMA%" (
  echo Install Ollama from https://ollama.com/download/windows and run this file again.
  pause
  exit /b 1
)
echo Open Ollama first. This downloads the local model; no questions or audio are uploaded.
"%JARVIS_OLLAMA%" pull qwen2.5:7b
if errorlevel 1 (
  echo Setup failed. Check that Ollama is running and the network is connected.
  pause
  exit /b 1
)
echo Local AI model is ready. Run start-jarvis.cmd to start JARVIS.
