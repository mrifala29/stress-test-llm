#!/usr/bin/env bash
set -e

# Script Backup Laporan Benchmark K6
# Menyimpan seluruh folder reports/ (raw JSON, HTML per skenario, dan laporan konsolidasi)
# ke folder backup/ dengan timestamp.

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="backup/reports_${TIMESTAMP}"
LATEST_DIR="backup/latest"

mkdir -p "$BACKUP_DIR"

if [ -d "reports" ]; then
  echo ">>> Menyalin folder 'reports/' ke '$BACKUP_DIR'..."
  cp -R reports/* "$BACKUP_DIR/" 2>/dev/null || true

  # Perbarui backup/latest
  rm -rf "$LATEST_DIR"
  mkdir -p "$LATEST_DIR"
  cp -R "$BACKUP_DIR"/* "$LATEST_DIR/" 2>/dev/null || true

  FILE_COUNT=$(find "$BACKUP_DIR" -type f | wc -l | tr -d ' ')
  echo ">>> [OK] Backup berhasil dibuat di: $BACKUP_DIR ($FILE_COUNT files)"
  echo ">>> [OK] Shortcut folder terbaru: $LATEST_DIR"
else
  echo "[WARN] Folder 'reports/' tidak ditemukan, tidak ada yang dibackup."
fi

