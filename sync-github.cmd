@echo off
setlocal

cd /d "%~dp0"

set "SAFE_DIR=%CD%"

for /f "delims=" %%i in ('git -c safe.directory^="%SAFE_DIR%" rev-parse --is-inside-work-tree 2^>nul') do set "IS_GIT=%%i"
if /i not "%IS_GIT%"=="true" (
  echo [ERROR] Current directory is not a Git repository.
  exit /b 1
)

for /f "delims=" %%i in ('git -c safe.directory^="%SAFE_DIR%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%i"
if /i not "%BRANCH%"=="main" (
  echo [ERROR] Current branch is "%BRANCH%". Expected "main".
  exit /b 1
)

set "STATUS_FILE=%TEMP%\gallery-sync-status-%RANDOM%.txt"
git -c safe.directory="%SAFE_DIR%" status --porcelain > "%STATUS_FILE%"
for %%A in ("%STATUS_FILE%") do set "STATUS_SIZE=%%~zA"
if not "%STATUS_SIZE%"=="0" (
  echo [ERROR] Working tree is not clean. Commit or stash changes first.
  type "%STATUS_FILE%"
  del "%STATUS_FILE%" >nul 2>nul
  exit /b 1
)
del "%STATUS_FILE%" >nul 2>nul

echo.
echo Repository: %CD%
echo Branch: %BRANCH%
echo.
echo Remote:
git -c safe.directory="%SAFE_DIR%" remote -v
echo.
echo Latest commits:
git -c safe.directory="%SAFE_DIR%" log --oneline -3
echo.
echo This command will REPLACE origin/main with this standalone gallery repository:
echo   git push -u origin main --force
echo.
set /p "CONFIRM=Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled.
  exit /b 1
)

git -c safe.directory="%SAFE_DIR%" push -u origin main --force
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Check GitHub authentication or network access, then try again.
  exit /b 1
)

echo.
echo [OK] Push completed.
