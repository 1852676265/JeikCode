#!/bin/bash
# 发版流水线监听（while 版）：每 180s 轮询 gh run list，直到所有 run 离开 queued/in_progress。
# 结果写入 $TMPDIR/jc-pipeline-watch.log；终态会显式写 ALL GREEN / FAILED。
LOG="${TMPDIR:-/tmp}/jc-pipeline-watch.log"
: > "$LOG"
echo "watch started @ $(date '+%F %T')" >> "$LOG"

i=0
while true; do
  i=$((i + 1))
  ts=$(date '+%F %T')
  out=$(gh run list --limit 6 2>&1 || true)
  {
    echo "=== poll $i @ $ts ==="
    echo "$out"
  } >> "$LOG"

  if ! echo "$out" | grep -Eq '(queued|in_progress|pending|requested|waiting)'; then
    if echo "$out" | grep -Eq '(failure|cancelled|timed_out|startup_failure)'; then
      echo "PIPELINE RESULT: FAILED" >> "$LOG"
    else
      echo "PIPELINE RESULT: ALL GREEN" >> "$LOG"
    fi
    break
  fi
  sleep 180
done
echo "watch done @ $(date '+%F %T')" >> "$LOG"
