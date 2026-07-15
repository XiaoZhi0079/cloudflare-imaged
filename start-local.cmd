@echo off
setlocal

set "XDG_CONFIG_HOME=%~dp0.xdg"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "NO_PROXY=127.0.0.1,localhost"

if "%GALLERY_ADMIN_KEY%"=="" set "GALLERY_ADMIN_KEY=gallery-secret"
if "%GALLERY_PUBLIC_BASE_URL%"=="" set "GALLERY_PUBLIC_BASE_URL=http://127.0.0.1:8788/file"
if "%GALLERY_UPLOAD_NAME_TYPE%"=="" set "GALLERY_UPLOAD_NAME_TYPE=origin"
if "%GALLERY_UPLOAD_FOLDER%"=="" set "GALLERY_UPLOAD_FOLDER=gallery"
if "%R2_BUCKET_NAME%"=="" set "R2_BUCKET_NAME=gallery"
rem For local browser direct upload, keep R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .dev.vars.

cd /d "%~dp0"
call npx.cmd wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state
if errorlevel 1 exit /b 1

call npx.cmd wrangler pages dev ./public ^
  --d1 GALLERY_DB ^
  --r2 GALLERY_BUCKET ^
  --binding "GALLERY_ADMIN_KEY=%GALLERY_ADMIN_KEY%" ^
  --binding "GALLERY_PUBLIC_BASE_URL=%GALLERY_PUBLIC_BASE_URL%" ^
  --binding "GALLERY_UPLOAD_NAME_TYPE=%GALLERY_UPLOAD_NAME_TYPE%" ^
  --binding "GALLERY_UPLOAD_FOLDER=%GALLERY_UPLOAD_FOLDER%" ^
  --binding "R2_BUCKET_NAME=%R2_BUCKET_NAME%" ^
  --compatibility-date 2026-03-02 ^
  --ip 127.0.0.1 ^
  --port 8788 ^
  --persist-to ./.wrangler/state
