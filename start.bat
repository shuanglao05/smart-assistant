@echo off
chcp 65001 >nul
title IPAS Launcher
cd /d "%~dp0backend"
start "IPAS-Backend" cmd /k "venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
cd /d "%~dp0frontend"
start "IPAS-Frontend" cmd /k "npm run dev"
echo.
echo  后端: http://127.0.0.1:8000
echo  前端: http://localhost:5173
echo.
echo  已启动两个窗口，稍等几秒后浏览器打开 http://localhost:5173
echo  关闭时直接关掉那两个窗口即可。
echo.
pause
