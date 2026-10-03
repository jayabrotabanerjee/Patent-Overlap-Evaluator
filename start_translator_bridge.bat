@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  set PY=py
) else (
  set PY=python
)
if not exist ".translator-venv\Scripts\python.exe" (
  echo Creating local translator environment...
  %PY% -m venv .translator-venv
)
call ".translator-venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r translator_bridge_requirements.txt
echo.
echo Starting Patent Overlap Evaluator Translation Bridge...
echo Keep this window open while using Document Translation in the website.
python translator_bridge.py
pause
