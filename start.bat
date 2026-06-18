@echo off
title Dashbot - Iniciando...
color 0A
chcp 65001 >nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║              DASHBOT - Iniciando...                 ║
echo  ║     Dashcont Technology System Automatizacion SAC   ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

REM ── Verificar que las dependencias esten instaladas ───────────────────────
if not exist "%~dp0backend\venv" (
    echo [!] Primera vez? Ejecuta primero: instalar.bat
    echo.
    set /p run="Ejecutar instalacion ahora? (s/n): "
    if /i "%run%"=="s" call "%~dp0instalar.bat"
)

REM ── Iniciar backend ───────────────────────────────────────────────────────
echo [1/2] Iniciando backend API en puerto 8000...
start "Dashbot - Backend" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate.bat && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

REM ── Esperar que backend arranque ──────────────────────────────────────────
timeout /t 3 /nobreak >nul

REM ── Iniciar frontend ──────────────────────────────────────────────────────
echo [2/2] Iniciando frontend en puerto 5173...
cd /d "%~dp0frontend"
start "Dashbot - Frontend" cmd /k "npm run dev"

REM ── Esperar y abrir navegador ─────────────────────────────────────────────
timeout /t 4 /nobreak >nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                     ║
echo  ║   Landing:  http://localhost:5173                   ║
echo  ║   Chat:     http://localhost:5173/app.html          ║
echo  ║   API:      http://localhost:8000/docs              ║
echo  ║                                                     ║
echo  ║   Cierra las ventanas del servidor para detener.    ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

start "" "http://localhost:5173"
pause
