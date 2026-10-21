#!/usr/bin/env bash
#
# 为构建好的 Linux AppImage 注入更新信息（.upd_info）并生成配套的 .zsync 差量更新索引文件。
# 支持 AppImageUpdate、Gear Lever、AppImageLauncher 以及各类 Linux 应用商店进行无缝增量差量升级。
#
# 规范参考: https://github.com/AppImage/AppImageSpec/blob/master/draft.md#update-information
#
set -euo pipefail

shopt -s globstar nullglob

REPO="${REPO:-${GITHUB_REPOSITORY:-jeikl/JeikCode}}"
TAG="${TAG:-${GITHUB_REF_NAME:-}}"

if [[ -z "$TAG" ]]; then
  TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")"
fi

owner="${REPO%%/*}"
repo_name="${REPO##*/}"

# 如果未传参数，自动搜寻 desktop 产物目录下的所有 AppImage
if [[ $# -eq 0 ]]; then
  set -- desktop/src-tauri/target/**/bundle/appimage/*.AppImage
fi

if [[ $# -eq 0 ]]; then
  echo "Notice: No AppImage files found to process."
  exit 0
fi

command -v zsyncmake >/dev/null 2>&1 || {
  echo "Error: zsyncmake not found. Please install the 'zsync' package (e.g. sudo apt-get install -y zsync)." >&2
  exit 1
}

for raw_appimage in "$@"; do
  [[ -f "$raw_appimage" ]] || continue

  # 规范化文件名：GitHub Releases 在上传包含空格的资产时会自动将空格替换为点号 '.'
  # 提前将空格替换为点号，避免 .zsync 内部的相对文件名/URL 与 GitHub 上的实际资产名称脱节
  dir="$(dirname "$raw_appimage")"
  base="$(basename "$raw_appimage")"
  clean_base="${base// /.}"
  appimage="${dir}/${clean_base}"

  if [[ "$raw_appimage" != "$appimage" ]]; then
    echo "Normalizing AppImage filename: '$base' -> '$clean_base'"
    mv -f "$raw_appimage" "$appimage"
  fi

  # 推导针对该架构与软件前缀的通用更新 pattern（使用通配符匹配未来任意版本的同架构发布）
  # 例如: JeikCode.Desktop_7.2.0_amd64.AppImage -> JeikCode.Desktop_*_amd64.AppImage.zsync
  clean_ver="${TAG#v}"
  if [[ -n "$clean_ver" && "$clean_base" == *"_${clean_ver}_"* ]]; then
    pattern="${clean_base/_${clean_ver}_/_*_}"
  else
    pattern="$(echo "$clean_base" | sed -E 's/_[0-9]+(\.[0-9]+)*([a-zA-Z0-9.-]*)?_/_*_/')"
  fi

  update_info="gh-releases-zsync|${owner}|${repo_name}|latest|${pattern}.zsync"
  echo "Target AppImage: $appimage"
  echo "Update Information: $update_info"

  # 读取 ELF 的 .upd_info 节区位置与大小 (以十六进制提取后转换为十进制)
  read -r size_hex offset_hex < <(
    objdump -h "$appimage" 2>/dev/null | awk '$2 == ".upd_info" { print $3, $6; exit }' || true
  )

  if [[ -n "${size_hex:-}" && -n "${offset_hex:-}" && "$size_hex" =~ ^[0-9a-fA-F]+$ && "$offset_hex" =~ ^[0-9a-fA-F]+$ ]]; then
    size=$((16#$size_hex))
    offset=$((16#$offset_hex))

    if (( size > 0 && ${#update_info} < size )); then
      # 写入 update information 并以 NUL 填充剩余空间，避免残留字节
      {
        printf '%s' "$update_info"
        head -c "$((size - ${#update_info}))" /dev/zero
      } | dd of="$appimage" bs=1 seek="$offset" count="$size" conv=notrunc status=none

      # 回读校验写入一致性
      embedded="$(dd if="$appimage" bs=1 skip="$offset" count="$size" status=none 2>/dev/null | tr -d '\0')"
      if [[ "$embedded" == "$update_info" ]]; then
        echo "Successfully embedded update info into .upd_info section."
      else
        echo "Warning: embedded update info mismatch ('$embedded' vs '$update_info')." >&2
      fi
    else
      echo "Warning: .upd_info section size ($size) is invalid or insufficient for '${#update_info}' bytes." >&2
    fi
  else
    echo "Notice: .upd_info section not found or non-ELF stub; skipping binary patch."
  fi

  # 基于注入/更新后的最终 AppImage 生成 .zsync 差量索引文件
  zsync_file="${appimage}.zsync"
  zsyncmake -u "$clean_base" -o "$zsync_file" "$appimage"
  echo "Generated zsync: $zsync_file"
done
