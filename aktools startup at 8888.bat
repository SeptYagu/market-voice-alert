@echo off
setlocal
title AKTools - 127.0.0.1:8888

REM 切换到本脚本所在目录，避免在任意工作目录下双击时路径错乱
cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8888"
set "PY="

echo ============================================
echo  AKTools Starting...
echo  Listen:    %HOST%:%PORT%
echo  API Docs:  http://%HOST%:%PORT%/docs
echo  Press Ctrl+C to stop
echo ============================================
echo.

REM ---------------------------------------------------------------
REM 自动探测可用的 Python 解释器。
REM 不要在这里写死绝对路径：本项目在多台机器间切换开发，
REM 每台机器的 Python 安装位置不同（微软商店版 / 官方安装版 / py 启动器）。
REM ---------------------------------------------------------------
call :find_python

if not defined PY goto :no_python
goto :run

:find_python
REM 1) py 启动器（官方安装版自带，最可靠）
py -3 -c "import sys" >nul 2>&1 && (set "PY=py -3" & goto :eof)
py    -c "import sys" >nul 2>&1 && (set "PY=py"     & goto :eof)
REM 2) PATH 里的 python
python -c "import sys" >nul 2>&1 && (set "PY=python" & goto :eof)
REM 3) 常见安装位置兜底
if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe" & goto :eof)
if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe" & goto :eof)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe" & goto :eof)
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (set "PY=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" & goto :eof)
if exist "%LOCALAPPDATA%\Python\pythoncore-3.13-64\python.exe" (set "PY=%LOCALAPPDATA%\Python\pythoncore-3.13-64\python.exe" & goto :eof)
if exist "C:\Python314\python.exe" (set "PY=C:\Python314\python.exe" & goto :eof)
if exist "C:\Python313\python.exe" (set "PY=C:\Python313\python.exe" & goto :eof)
if exist "C:\Python312\python.exe" (set "PY=C:\Python312\python.exe" & goto :eof)
goto :eof

:no_python
echo [ERROR] Python not found.
echo         Install Python 3.9+ first, or add it to PATH, then run this script again.
echo.
pause
exit /b 1

:run
echo Using Python: %PY%

REM 缺依赖时自动补装，避免「服务起不来但看不出原因」
%PY% -c "import aktools" >nul 2>&1
if errorlevel 1 (
    echo [WARN] aktools is not installed for this interpreter, installing now...
    %PY% -m pip install aktools
    if errorlevel 1 (
        echo [ERROR] Failed to install aktools.
        echo         Try manually:  %PY% -m pip install aktools
        echo.
        pause
        exit /b 1
    )
)

echo.
%PY% -m aktools --host %HOST% --port %PORT%

echo.
echo ============================================
echo  Service stopped.
echo ============================================
pause
