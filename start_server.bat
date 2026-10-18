@echo off
chcp 65001 >nul
title Chinese Platform - Local Server
echo =======================================================
echo   Запуск локального сервера для платформы...
echo =======================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js не найден в системе. Открываю index.html напрямую...
    start index.html
    pause
    exit /b
)

node start_server.js
pause
