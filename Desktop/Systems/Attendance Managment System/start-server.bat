@echo off
rem Double-click to start the Attendance System. Keep this window open; closing it stops the app.
rem To start it automatically when you sign in: press Win+R, type  shell:startup , and put a shortcut to this file there.
cd /d "%~dp0"
title Attendance System
echo Starting the Attendance System...
echo.
node server\index.js
echo.
echo The server stopped. Press any key to close this window.
pause >nul
