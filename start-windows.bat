@echo off
REM GHCountdown Launcher for Windows
REM This script starts the local server and opens GHCountdown in your default browser

title GHCountdown Launcher

echo.
echo ========================================
echo        GHCountdown - Starting...
echo ========================================
echo.

REM Change to the script directory
cd /d "%~dp0"

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [SETUP] Installing dependencies (first-time setup)...
    call npm install
    echo.
)

REM Check if dist folder exists
if not exist "dist\" (
    echo [BUILD] Building the app (first-time setup)...
    call npm run build
    echo.
)

REM Start the preview server
echo [START] Starting local server...
echo.

REM Open browser after a delay
start "" timeout /t 3 /nobreak ^>nul ^& start http://localhost:4173

REM Start the server (this will keep the window open)
echo.
echo ========================================
echo   GHCountdown is running!
echo   URL: http://localhost:4173
echo   Keep this window open while using the app
echo   Press Ctrl+C to stop
echo ========================================
echo.

call npm run preview

pause
