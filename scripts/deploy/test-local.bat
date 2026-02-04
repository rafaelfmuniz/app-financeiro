@echo off
:: Teste Local do Instalador Controle Financeiro
:: Simula a estrutura de diretórios do servidor Linux

echo ========================================
echo TESTE LOCAL - ESTRUTURA DE DIRETÓRIOS
echo ========================================
echo.

set INSTALL_DIR=D:\temp\controle-financeiro-teste
set TEMP_DIR=D:\temp\financeiro-install-teste
set BACKUP_DIR=D:\temp\financeiro-backup-teste

echo [1/5] Simulando estrutura do servidor...
echo.

if exist "%INSTALL_DIR%\backend" (
    echo Diretorio backend existe
) else (
    mkdir "%INSTALL_DIR%\backend"
    echo Diretorio backend criado
)

if exist "%INSTALL_DIR%\frontend" (
    echo Diretorio frontend existe
) else (
    mkdir "%INSTALL_DIR%\frontend"
    echo Diretorio frontend criado
)

echo.
echo [2/5] Simulando estrutura backend/src...
echo.

if not exist "%INSTALL_DIR%\backend\src" (
    mkdir "%INSTALL_DIR%\backend\src"
    echo Criado: backend\src
)

:: Criar arquivos de exemplo em backend/src/
echo const express = require('express'); > "%INSTALL_DIR%\backend\src\server.js"
echo const app = express(); >> "%INSTALL_DIR%\backend\src\server.js"
echo app.listen(3000); >> "%INSTALL_DIR%\backend\src\server.js"

mkdir "%INSTALL_DIR%\backend\src\routes"
echo. > "%INSTALL_DIR%\backend\src\routes\index.js"

mkdir "%INSTALL_DIR%\backend\src\middleware"
echo. > "%INSTALL_DIR%\backend\src\middleware\auth.js"

echo.
echo [3/5] Simulando estrutura frontend...
echo.

mkdir "%INSTALL_DIR%\frontend\src" >nul 2>&1
mkdir "%INSTALL_DIR%\frontend\dist" >nul 2>&1

:: Criar arquivos do frontend
echo ^<html^>^<body^>Frontend^</body^>^</html^> > "%INSTALL_DIR%\frontend\dist\index.html"

echo.
echo [4/5] Criando frontend-dist em backend/src...
echo.

if exist "%INSTALL_DIR%\backend\src\frontend-dist" (
    rmdir /s /q "%INSTALL_DIR%\backend\src\frontend-dist"
    echo Removido: backend\src\frontend-dist
)

xcopy /E /I "%INSTALL_DIR%\frontend\dist" "%INSTALL_DIR%\backend\src\frontend-dist\" >nul 2>&1

echo.
echo [5/5] Verificando resultado final...
echo.

echo Estrutura esperada:
echo   %INSTALL_DIR%\backend\src\server.js      (arquivo existe)
echo   %INSTALL_DIR%\backend\src\routes\      (diretorio existe)
echo   %INSTALL_DIR%\backend\src\middleware\  (diretorio existe)
echo   %INSTALL_DIR%\backend\src\frontend-dist\  (arquivos do frontend)

echo.
echo Verificando arquivos:
dir "%INSTALL_DIR%\backend\src" /B

echo.
echo ========================================
echo TESTE CONCLUÍDO
echo ========================================
echo.
echo Pressione qualquer tecla para sair...
pause >nul
