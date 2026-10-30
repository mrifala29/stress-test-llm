#!/usr/bin/env bash

# K6 LLM Stress Test Runner (DGX vs Runpod)
# Penggunaan:
#   ./run_benchmark.sh [target] [profile: smoke|runpod|dgx]
#
# target:
#   <ctx>        satu ukuran konteks: 1k|2k|4k|16k|32k|64k  (thinking ON & OFF)
#   <ctx>:on|off satu skenario spesifik, mis. 64k:off
#   all          skenario ringkas terpilih: 1k, 16k, 32k (thinking ON & OFF)
#   full         seluruh skenario lengkap: 1k, 2k, 4k, 16k, 32k, 64k
#   short        1k, 2k, 4k, 16k
#   long         32k, 64k
#   backup       backup hasil laporan saat ini ke folder backup/
#   clean        bersihkan seluruh laporan
# Contoh:
#   ./run_benchmark.sh 1k smoke
#   ./run_benchmark.sh all dgx
#   ./run_benchmark.sh all runpod
#   ./run_benchmark.sh full dgx

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

TARGET=${1:-"all"}
PROFILE=${2:-"smoke"}

if [ "$1" = "backup" ]; then
  ./scripts/backup_reports.sh
  exit 0
fi

if [ "$1" = "clean" ]; then
  echo ">>> Membersihkan seluruh file laporan di folder 'reports/'..."
  rm -rf reports/*
  mkdir -p reports/raw
  echo "[OK] Folder 'reports/' sudah bersih."
  exit 0
fi

mkdir -p reports/raw

# Otomatis bersihkan laporan lama untuk profile yang akan diuji agar data selalu fresh
echo ">>> [AUTO-CLEAN] Membersihkan data laporan lama untuk profile '${PROFILE}'..."
rm -f reports/raw/*_${PROFILE}_* reports/report_${PROFILE}.html
echo "[OK] Data lama untuk '${PROFILE}' telah dibersihkan."

if [ "$PROFILE" = "runpod" ] || [ "$PROFILE" = "a6000" ] || [ "$PROFILE" = "smoke_runpod" ]; then
  ACTIVE_URL="${LLM_RUNPOD_URL:-$LLM_BASE_URL}"
  SERVER_LABEL="Runpod (RTX A6000 Ada)"
elif [ "$PROFILE" = "dgx" ] || [ "$PROFILE" = "h200" ] || [ "$PROFILE" = "smoke_dgx" ]; then
  ACTIVE_URL="${LLM_DGX_URL:-$LLM_BASE_URL}"
  SERVER_LABEL="Server DGX (High-VRAM)"
else
  ACTIVE_URL="${LLM_DGX_URL:-${LLM_RUNPOD_URL:-$LLM_BASE_URL}}"
  SERVER_LABEL="Smoke Test / Default"
fi

echo "=========================================================="
echo "  K6 LLM STRESS TEST: DGX vs RUNPOD"
echo "  Target:     $TARGET"
echo "  Profil:     $PROFILE ($SERVER_LABEL)"
echo "  Target URL: $ACTIVE_URL"
echo "=========================================================="

run_k6() {
  local ctx=$1
  local thinking=$2
  echo ""
  echo ">>> [RUNNING] Thinking ${thinking} | Context ${ctx} (Profile: $PROFILE)"

  # Exit code 99 = threshold SLA terlewati (normal pada stress test), tidak menghentikan rangkaian uji
  k6 run -e "PROFILE=$PROFILE" -e "CONTEXT=$ctx" -e "THINKING=$thinking" scenarios/benchmark.js || {
    local exit_code=$?
    if [ $exit_code -eq 99 ]; then
      echo ">>> [CATATAN] SLA threshold terlewati (Thinking ${thinking}, ${ctx}) - Exit Code 99."
    else
      echo ">>> [PERINGATAN] Run selesai dengan exit code $exit_code."
    fi
  }

  # Perbarui laporan HTML seketika setiap skenario selesai agar selalu ada dan live
  node utils/consolidate_reports.js "$PROFILE" >/dev/null 2>&1 || true
}

run_ctx() {
  run_k6 "$1" on
  sleep 3
  run_k6 "$1" off
  sleep 3
}

case "$TARGET" in
  1k|2k|4k|16k|32k|64k)
    run_ctx "$TARGET"
    ;;
  1k:on|2k:on|4k:on|16k:on|32k:on|64k:on)
    run_k6 "${TARGET%%:*}" on
    ;;
  1k:off|2k:off|4k:off|16k:off|32k:off|64k:off)
    run_k6 "${TARGET%%:*}" off
    ;;
  short)
    for c in 1k 2k 4k 16k; do run_ctx $c; done
    ;;
  long)
    for c in 32k 64k; do run_ctx $c; done
    ;;
  all)
    # Skenario ringkas terpilih: 1k (short), 16k (mid), 32k (long)
    echo ">>> Menjalankan skenario terpilih: 1k, 16k, dan 32k..."
    for c in 1k 16k 32k; do run_ctx $c; done
    ;;
  full)
    # Seluruh 6 skenario lengkap (1k..64k)
    echo ">>> Menjalankan seluruh 6 skenario lengkap (1k..64k)..."
    for c in 1k 2k 4k 16k 32k 64k; do run_ctx $c; done
    ;;
  *)
    echo "Target tidak valid! Gunakan: 1k|2k|4k|16k|32k|64k, <ctx>:on|off, all, full, short, long, backup, clean"
    exit 1
    ;;
esac

echo ""
echo ">>> Membuat laporan HTML..."
node utils/consolidate_reports.js "$PROFILE" || true

echo ""
echo "=========================================================="
echo "  Pengujian Selesai! Laporan:"
echo "  - reports/report_runpod.html"
echo "  - reports/report_dgx.html"
echo "  - reports/report_comparison_dgx_vs_runpod.html"
echo "  - reports/raw/*.html (per skenario)"
echo "=========================================================="
