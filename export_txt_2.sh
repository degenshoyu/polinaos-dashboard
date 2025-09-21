#!/bin/bash
SRC_DIR=~/Development/ai/polinaos-dashboard
DEST_DIR=~/Development/ai/tem_files

mkdir -p "$DEST_DIR"

FILES=(
  "app/api/admin/mentions/backfill-max/route.ts"
  "lib/pricing/mentionMax.ts"
)

for file in "${FILES[@]}"; do
  txt_name=$(echo "$file" | sed 's/\//_/g' | sed 's/.ts$/.txt/')
  dest_file="$DEST_DIR/$txt_name"
  cat "$SRC_DIR/$file" > "$dest_file"
  echo "$file 上传为 $txt_name"
done

echo "✅ All done. All files saved to $DEST_DIR"
