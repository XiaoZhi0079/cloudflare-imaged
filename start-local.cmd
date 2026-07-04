@echo off
setlocal
set "XDG_CONFIG_HOME=%~dp0.xdg"
set "CI=1"
cd /d "%~dp0"
call npm.cmd run start
