@echo off
REM ============================================================
REM AutoSimulation - Backend + Frontend Başlatıcı
REM ============================================================
REM Bu dosya backend ve frontend'i aynı anda başlatır
REM ============================================================

setlocal enabledelayedexpansion
set "PROJECT_ROOT=%~dp0"

echo.
echo ============================================================
echo AutoSimulation - Başlatılıyor...
echo ============================================================
echo.

REM Backend başlat (yeni pencerede)
echo [1/2] Backend başlatılıyor... (http://localhost:8000)
start "AutoSimulation - Backend" cmd /k ^
    cd /d "%PROJECT_ROOT%backend" ^& ^
    call venv\Scripts\activate.bat ^& ^
    python api/main.py

REM Frontend başlat (yeni pencerede)
timeout /t 2 /nobreak >nul
echo [2/2] Frontend başlatılıyor... (http://localhost:5173)
start "AutoSimulation - Frontend" cmd /k ^
    cd /d "%PROJECT_ROOT%frontend" ^& ^
    call npm run dev

echo.
echo ============================================================
echo ✓ Backend ve Frontend başlatıldı!
echo ============================================================
echo.
echo 🌐 Tarayıcınızda aç: http://localhost:5173
echo 📡 Backend: http://localhost:8000
echo.
echo Kapatmak için her bir terminal penceresinde Ctrl+C basın
echo ============================================================
echo.

timeout /t 3 /nobreak >nul
