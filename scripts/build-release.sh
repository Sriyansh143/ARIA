#!/bin/bash
set -euo pipefail
cd /home/z/my-project
OUT="download/aria-mission-control-latest.zip"
mkdir -p download
rm -f "$OUT"
zip -r -q "$OUT" . -x "node_modules/*" ".next/*" ".git/*" "db/*.db" "db/*.db-journal" "upload/*" "tool-results/*" "agent-ctx/*" "*.log" ".zscripts/mini-service-*.log" "download/*" ".DS_Store" "Thumbs.db" "postcss.config.mjs.disabled" || true
echo "Built: $OUT ($(du -h "$OUT" | cut -f1), $(unzip -l "$OUT" 2>/dev/null | tail -1 | awk '{print $2}') files)"
