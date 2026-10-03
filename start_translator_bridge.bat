@echo off
setlocal
cd /d "%~dp0"
title Patent Overlap Evaluator - Translation Bridge
set PYTHONUNBUFFERED=1

echo ============================================================
echo Patent Overlap Evaluator - Translation Bridge
echo Visible Chrome + Google Translate Images + sequential PDF build
echo ============================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set PY=py
) else (
  set PY=python
)

if not exist ".translator-venv\Scripts\python.exe" (
  echo [SETUP] Creating local Python environment...
  %PY% -m venv .translator-venv
  if errorlevel 1 goto :fail
)

call ".translator-venv\Scripts\activate.bat"
if errorlevel 1 goto :fail

echo [SETUP] Updating required packages...
python -m pip install --upgrade pip
if errorlevel 1 goto :fail
pip install -r translator_bridge_requirements.txt
if errorlevel 1 goto :fail

echo.
echo [START] Starting local bridge at http://127.0.0.1:8765
echo [START] A visible Chrome window will open automatically when a translation job begins.
echo [LOG]   Detailed events are written to translator_bridge.log
echo [NOTE]  Keep this command window open while translating.
echo.
python -u translator_bridge.py
goto :end

:fail
echo.
echo ERROR: Bridge setup/start failed.
echo Check the messages above. Also verify that Python 3.11+ and Google Chrome are installed.
echo.

:end
pause
