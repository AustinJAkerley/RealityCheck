@echo off
REM RealityCheck — Windows build helper
REM Usage:  scripts\build.bat [all | core | chrome | edge | firefox | test | clean]
REM Requires: Node.js 18+ and npm 9+ on PATH

setlocal

set TARGET=%1
if "%TARGET%"=="" set TARGET=all

if "%TARGET%"=="clean" goto clean
if "%TARGET%"=="test"  goto test
if "%TARGET%"=="core"  goto core
if "%TARGET%"=="chrome"  goto chrome
if "%TARGET%"=="edge"    goto edge
if "%TARGET%"=="firefox" goto firefox
if "%TARGET%"=="all"   goto all

echo Unknown target: %TARGET%
echo Usage: scripts\build.bat [all ^| core ^| chrome ^| edge ^| firefox ^| test ^| clean]
exit /b 1

:all
call :core_build
if errorlevel 1 exit /b 1
node extensions\chrome\build.js
if errorlevel 1 exit /b 1
node extensions\edge\build.js
if errorlevel 1 exit /b 1
node extensions\firefox\build.js
if errorlevel 1 exit /b 1
echo.
echo All extensions built successfully.
goto :eof

:core
call :core_build
goto :eof

:chrome
call :core_build
if errorlevel 1 exit /b 1
node extensions\chrome\build.js
goto :eof

:edge
call :core_build
if errorlevel 1 exit /b 1
node extensions\edge\build.js
goto :eof

:firefox
call :core_build
if errorlevel 1 exit /b 1
node extensions\firefox\build.js
goto :eof

:test
cd packages\core
npm test
cd ..\..
goto :eof

:clean
echo Removing dist folders...
if exist packages\core\dist        rmdir /s /q packages\core\dist
if exist extensions\chrome\dist   rmdir /s /q extensions\chrome\dist
if exist extensions\edge\dist     rmdir /s /q extensions\edge\dist
if exist extensions\firefox\dist  rmdir /s /q extensions\firefox\dist
echo Clean complete.
goto :eof

:core_build
echo Building @reality-check/core...
cd packages\core
npm run build
if errorlevel 1 (
  cd ..\..
  echo Core build failed.
  exit /b 1
)
cd ..\..
exit /b 0
