[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-Menu {
    Clear-Host
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "    運動員防受傷檢測系統 (Athletic Mobility PWA)       " -ForegroundColor Yellow
    Write-Host "                版本管理與 GitHub 推送工具             " -ForegroundColor White
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "[目前 Git 狀態]" -ForegroundColor Green
    git status -s
    Write-Host ""

    Write-Host "[目前所在分支與版本]" -ForegroundColor Green
    $branch = git branch --show-current
    $tag = git describe --tags --always
    Write-Host "  分支: $branch | 標籤: $tag"
    Write-Host ""

    Write-Host "------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  請選擇操作：" -ForegroundColor White
    Write-Host "------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  1. 檢視所有歷史版本標籤 (Git Tags)"
    Write-Host "  2. 切換到指定歷史版本 (檢視模式)"
    Write-Host "  3. 切回最新開發主線 (main)"
    Write-Host "  4. 以指定版本建立新分支"
    Write-Host "  5. 啟動本機開發伺服器 (npm run dev)"
    Write-Host "  6. 一鍵推送到 GitHub 遠端倉庫 (git push origin main --tags)" -ForegroundColor Cyan
    Write-Host "  0. 離開"
    Write-Host "------------------------------------------------------" -ForegroundColor DarkGray
}

while ($true) {
    Show-Menu
    $choice = Read-Host "請輸入選項 (0-6)"

    switch ($choice) {
        "1" {
            Clear-Host
            Write-Host "[所有版本標籤清單]" -ForegroundColor Green
            git tag -n -l
            Write-Host ""
            Read-Host "按 Enter 返回主選單..."
        }
        "2" {
            Clear-Host
            $tagname = Read-Host "請輸入欲切換的版本標籤 (例如 v1.0.0)"
            if (-not [string]::IsNullOrWhiteSpace($tagname)) {
                git checkout $tagname
            }
            Read-Host "按 Enter 返回主選單..."
        }
        "3" {
            Clear-Host
            git checkout main 2>$null
            if ($LASTEXITCODE -ne 0) {
                git checkout master
            }
            Read-Host "按 Enter 返回主選單..."
        }
        "4" {
            Clear-Host
            $baseTag = Read-Host "請輸入基底版本 (例如 v1.0.0)"
            $newBranch = Read-Host "請輸入新分支名稱 (例如 hotfix-v1.0.1)"
            if (-not [string]::IsNullOrWhiteSpace($baseTag) -and -not [string]::IsNullOrWhiteSpace($newBranch)) {
                git checkout -b $newBranch $baseTag
            }
            Read-Host "按 Enter 返回主選單..."
        }
        "5" {
            Clear-Host
            Write-Host "[啟動本機開發伺服器] 按 Ctrl + C 可結束..." -ForegroundColor Green
            npm.cmd run dev
            Read-Host "按 Enter 返回主選單..."
        }
        "6" {
            Clear-Host
            Write-Host "[推送到 GitHub 遠端倉庫]" -ForegroundColor Green
            Write-Host "正在推送至 https://github.com/hmlee-pt/PwinterV.git ..." -ForegroundColor Gray
            git push -u origin main --tags
            Write-Host ""
            Write-Host "若顯示成功，即表示所有檔案與標籤已同步至 GitHub！" -ForegroundColor Yellow
            Read-Host "按 Enter 返回主選單..."
        }
        "0" {
            exit
        }
        default {
            Write-Host "無效選項，請重新輸入。" -ForegroundColor Red
            Start-Sleep -Seconds 1
        }
    }
}
