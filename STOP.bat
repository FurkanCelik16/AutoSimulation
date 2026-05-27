@echo off
REM ============================================================
REM AutoSimulation - Durdurma Scripti
REM ============================================================

echo.
echo ============================================================
echo AutoSimulation - Durduruluyor...
echo ============================================================
echo.

REM Node.js (npm) processleri durdur
echo [*] Frontend processlerini durduruyor...
taskkill /F /IM node.exe /T 2>nul

REM Python processlerini durdur
echo [*] Backend processlerini durduruyor...
taskkill /F /IM python.exe /T 2>nul

echo.
echo ============================================================
echo ✓ Tüm procesler durduruldu!
echo ============================================================
echo.

timeout /t 2 /nobreak >nul
