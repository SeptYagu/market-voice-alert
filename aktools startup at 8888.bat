@echo off
title AKTools - 127.0.0.1:8888
cd /d "D:\AiPrograms\project1"

echo ============================================
echo  AKTools Starting...
echo  Listen:    127.0.0.1:8888
echo  API Docs:  http://127.0.0.1:8888/docs
echo  Press Ctrl+C to stop
echo ============================================
echo.

"C:\Users\12915\AppData\Local\Python\pythoncore-3.14-64\python.exe" -m aktools --host 127.0.0.1 --port 8888

echo.
echo ============================================
echo  Service stopped.
echo ============================================
pause
