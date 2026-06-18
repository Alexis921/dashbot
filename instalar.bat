@echo off
title Dashbot - Instalacion
color 0A
chcp 65001 >nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║        DASHBOT - Instalacion de Dependencias        ║
echo  ║     Dashcont Technology System Automatizacion SAC   ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

REM ── Verificar Python ──────────────────────────────────────────────────────
echo [1/5] Verificando Python...
py --version >nul 2>&1
if errorlevel 1 (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python no encontrado.
        echo Instala Python desde: https://python.org/downloads
        echo Asegurate de marcar "Add Python to PATH" durante la instalacion.
        pause
        exit /b 1
    )
)
py --version 2>&1 || python --version 2>&1
echo [OK] Python encontrado.

REM ── Verificar Node.js ─────────────────────────────────────────────────────
echo.
echo [2/5] Verificando Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no encontrado.
    echo Instala Node.js desde: https://nodejs.org
    pause
    exit /b 1
)
node --version
echo [OK] Node.js encontrado.

REM ── Backend - Entorno virtual ──────────────────────────────────────────────
echo.
echo [3/5] Creando entorno virtual Python...
cd /d "%~dp0backend"
if not exist venv (
    py -m venv venv 2>nul || python -m venv venv
    echo [OK] Entorno virtual creado.
) else (
    echo [OK] Entorno virtual ya existe.
)

REM ── Backend - Dependencias ─────────────────────────────────────────────────
echo.
echo [4/5] Instalando dependencias Python (puede tardar 2-3 minutos)...
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
echo [OK] Dependencias Python instaladas.

REM ── Playwright - Chromium ─────────────────────────────────────────────────
echo.
echo [4b] Instalando Chromium para Playwright (puede tardar)...
playwright install chromium
echo [OK] Chromium instalado.

REM ── Frontend - Dependencias ───────────────────────────────────────────────
echo.
echo [5/5] Instalando dependencias Node.js...
cd /d "%~dp0frontend"
npm install --silent
echo [OK] Dependencias frontend instaladas.

REM ── .env ──────────────────────────────────────────────────────────────────
if not exist "%~dp0backend\.env" (
    copy "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
    echo.
    echo [INFO] Archivo .env creado. Editalo con tus datos SMTP si quieres email real.
)

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   Instalacion completada! Ahora ejecuta start.bat  ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
pause
