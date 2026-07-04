@echo off
setlocal

set "XDG_CONFIG_HOME=%~dp0..\.xdg"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "NO_PROXY=127.0.0.1,localhost"

if "%IMGBED_BASE_URL%"=="" set "IMGBED_BASE_URL=http://127.0.0.1:8080"
if "%IMGBED_API_TOKEN%"=="" set "IMGBED_API_TOKEN=local-dev-token"
if "%GALLERY_ADMIN_KEY%"=="" set "GALLERY_ADMIN_KEY=gallery-secret"
if "%GALLERY_UPLOAD_CHANNEL%"=="" set "GALLERY_UPLOAD_CHANNEL=cfr2"
if "%GALLERY_UPLOAD_NAME_TYPE%"=="" set "GALLERY_UPLOAD_NAME_TYPE=origin"
if "%GALLERY_UPLOAD_FOLDER%"=="" set "GALLERY_UPLOAD_FOLDER=gallery"

cd /d "%~dp0"
call npx.cmd wrangler pages dev ./public --d1 GALLERY_DB --compatibility-date 2026-03-02 --ip 0.0.0.0 --port 8788 --persist-to ./.wrangler/state
