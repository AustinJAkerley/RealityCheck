@echo off
REM RealityCheck — Windows CMD build helper
REM NOTE: PowerShell users should prefer .\scripts\build.ps1 instead.
REM Usage:  scripts\build.bat [all | core | chrome | edge | firefox | safari | test | clean]
REM Requires: Node.js 18+ and npm 9+ on PATH

setlocal

set TARGET=%1
if "%TARGET%"=="" set TARGET=all

if /i "%TARGET%"=="clean"   goto do_clean
if /i "%TARGET%"=="test"    goto do_test
if /i "%TARGET%"=="core"    goto do_core
if /i "%TARGET%"=="chrome"  goto do_chrome
if /i "%TARGET%"=="edge"    goto do_edge
if /i "%TARGET%"=="firefox" goto do_firefox
if /i "%TARGET%"=="safari"  goto do_safari
if /i "%TARGET%"=="all"     goto do_all

echo Unknown target: %TARGET%
echo Usage: scripts\build.bat [all ^| core ^| chrome ^| edge ^| firefox ^| safari ^| test ^| clean]
exit /b 1

:do_all
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
node extensions\chrome\build.js
if errorlevel 1 exit /b 1
node extensions\edge\build.js
if errorlevel 1 exit /b 1
node extensions\firefox\build.js
if errorlevel 1 exit /b 1
node extensions\safari\build.js
if errorlevel 1 exit /b 1
echo.
echo All extensions built successfully.
goto end

:do_core
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
goto end

:do_chrome
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
node extensions\chrome\build.js
goto end

:do_edge
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
node extensions\edge\build.js
goto end

:do_firefox
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
node extensions\firefox\build.js
goto end

:do_safari
echo Building @reality-check/core...
cd packages\core && npm run build && cd ..\..
if errorlevel 1 ( echo Core build failed. & exit /b 1 )
node extensions\safari\build.js
goto end

:do_test
cd packages\core && npm test && cd ..\..
goto end

:do_clean
echo Removing dist folders...
if exist packages\core\dist       rmdir /s /q packages\core\dist
if exist extensions\chrome\dist   rmdir /s /q extensions\chrome\dist
if exist extensions\edge\dist     rmdir /s /q extensions\edge\dist
if exist extensions\firefox\dist  rmdir /s /q extensions\firefox\dist
if exist extensions\safari\dist   rmdir /s /q extensions\safari\dist
echo Clean complete.
goto end

:end
endlocal
