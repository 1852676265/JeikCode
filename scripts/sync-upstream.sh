#!/usr/bin/env bash
# ==============================================================================
# JeikCode 官方上游自动同步脚本 (Bash)
# 作用：
# 1. 自动从官方 upstream 拉取最新提交并推送到你的 GitHub origin/main（开源同步）
# 2. 自动切回 custom 二开分支，将官方最新更新合并进来（无缝升级）
# ==============================================================================
set -e

echo ">>> [1/5] 检查并同步官方 upstream 代码..."
git fetch upstream

HAS_STASH=0
if [[ -n $(git status --porcelain) ]]; then
  echo ">>> 检测到未提交修改，暂存中..."
  git stash push -m "Auto stash before sync upstream $(date +'%Y-%m-%d %H:%M:%S')"
  HAS_STASH=1
fi

echo ">>> [2/5] 切换到 main 分支同步官方最新代码..."
git checkout main
git merge --ff-only upstream/main

echo ">>> [3/5] 推送最新官方代码到你的 GitHub (origin/main)..."
git push origin main

echo ">>> [4/5] 切回二开分支 custom 并合并官方更新..."
git checkout custom
git merge main
git push origin custom

if [[ $HAS_STASH -eq 1 ]]; then
  echo ">>> [5/5] 恢复此前暂存的修改..."
  git stash pop
fi

echo ">>> 全部同步流程已完成！"
