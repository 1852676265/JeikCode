# ==============================================================================
# JeikCode 官方上游自动同步脚本 (PowerShell)
# 作用：
# 1. 自动从官方 upstream 拉取最新提交并推送到你的 GitHub origin/main（开源同步）
# 2. 自动切回 custom 二开分支，将官方最新更新合并进来（无缝升级）
# ==============================================================================

Write-Host ">>> [1/5] 检查并同步官方 upstream 代码..." -ForegroundColor Cyan
git fetch upstream

# 检查当前是否有未提交的更改
$hasChanges = $(git status --porcelain)
if ($hasChanges) {
    Write-Host ">>> 检测到本地有未提交修改，正在暂存 (git stash)..." -ForegroundColor Yellow
    git stash push -m "Auto stash before sync upstream $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

Write-Host ">>> [2/5] 切换到 main 分支同步官方最新代码..." -ForegroundColor Cyan
git checkout main
git merge --ff-only upstream/main

Write-Host ">>> [3/5] 推送最新官方代码到你的 GitHub (origin/main)..." -ForegroundColor Cyan
git push origin main

Write-Host ">>> [4/5] 切回二开分支 custom 并合并官方最新代码..." -ForegroundColor Cyan
git checkout custom
$mergeResult = git merge main
if ($LASTEXITCODE -ne 0) {
    Write-Host "!!! 注意：合并存在冲突，请手动解决冲突后提交！" -ForegroundColor Red
} else {
    Write-Host ">>> 官方更新已成功平滑合并到 custom 分支！" -ForegroundColor Green
    git push origin custom
}

if ($hasChanges) {
    Write-Host ">>> [5/5] 恢复此前暂存的本地修改..." -ForegroundColor Yellow
    git stash pop
}

Write-Host ">>> 全部同步流程已完成！" -ForegroundColor Green
