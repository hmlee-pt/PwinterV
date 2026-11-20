@echo off
chcp 65001 >nul
title 運動員防受傷檢測系統 - 版本切換工具

:MENU
cls
echo ======================================================
echo    運動員防受傷檢測系統 (Athletic Mobility PWA)
echo                版本切換與回溯工具
echo ======================================================
echo.
echo [目前 Git 狀態]
git status -s
echo.
echo [目前所在分支 / 版本]
git branch --show-current
git describe --tags --always
echo.
echo ------------------------------------------------------
echo  請選擇操作：
echo ------------------------------------------------------
echo  1. 檢視所有歷史版本標籤 (Git Tags)
echo  2. 切換到指定歷史版本 (檢視模式)
echo  3. 切回最新開發主線 (master / main)
echo  4. 以指定版本建立新修復分支
echo  5. 啟動本機開發伺服器 (npm run dev)
echo  0. 離開
echo ------------------------------------------------------
set /p choice=請輸入選項 (0-5): 

if "%choice%"=="1" goto LIST_TAGS
if "%choice%"=="2" goto CHECKOUT_TAG
if "%choice%"=="3" goto CHECKOUT_MAIN
if "%choice%"=="4" goto CREATE_BRANCH
if "%choice%"=="5" goto RUN_DEV
if "%choice%"=="0" exit /b
goto MENU

:LIST_TAGS
cls
echo [所有版本標籤清單]
git tag -n -l
echo.
pause
goto MENU

:CHECKOUT_TAG
cls
echo [切換到指定版本]
set /p tagname=請輸入欲切換的版本標籤 (例如 v1.0.0): 
if "%tagname%"=="" goto MENU
git checkout %tagname%
echo.
echo 已切換至 %tagname%。若需回最新版本請選主選單 3。
pause
goto MENU

:CHECKOUT_MAIN
cls
echo [切回最新開發主線]
git checkout master 2>nul || git checkout main
echo.
pause
goto MENU

:CREATE_BRANCH
cls
echo [以指定版本建立新分支]
set /p base_tag=請輸入基底版本 (例如 v1.0.0): 
set /p new_branch=請輸入新分支名稱 (例如 hotfix-v1.0.1): 
if "%base_tag%"=="" goto MENU
if "%new_branch%"=="" goto MENU
git checkout -b %new_branch% %base_tag%
echo.
echo 已建立並切換至分支 %new_branch% (基於 %base_tag%)
pause
goto MENU

:RUN_DEV
cls
echo [啟動本機開發伺服器]
call npm.cmd run dev
pause
goto MENU
