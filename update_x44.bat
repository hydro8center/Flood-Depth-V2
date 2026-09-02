@echo off
REM ====================================================================
REM  update_x44.bat - fetch X.44 water level and push to GitHub Pages
REM  Run every 15 minutes with Windows Task Scheduler.
REM
REM  Put this file in the SAME folder as index.html and publish_x44.py,
REM  and that folder must already be a GitHub repository clone.
REM
REM  EDIT THE THREE LINES BELOW BEFORE FIRST USE.
REM ====================================================================

set RID_KEY=PUT_CONSUMER_KEY_HERE
set RID_SECRET=PUT_CONSUMER_SECRET_HERE
set X44_STATION_ID=PUT_STATION_ID_HERE

REM If rid_connector.py is already running on this machine, remove the
REM REM below and you can leave RID_KEY / RID_SECRET blank.
REM set PROXY_ARG=--proxy http://127.0.0.1:8765

cd /d "%~dp0"

echo [%date% %time%] fetching X.44 ...
python publish_x44.py %PROXY_ARG% --out data\x44.json
if errorlevel 1 (
  echo [%date% %time%] FETCH FAILED - skip push
  exit /b 1
)

git add data/x44.json
git diff --staged --quiet
if not errorlevel 1 (
  echo [%date% %time%] no change - nothing to push
  exit /b 0
)

git commit -m "update X.44 telemetry"
git push
echo [%date% %time%] pushed to GitHub
exit /b 0
