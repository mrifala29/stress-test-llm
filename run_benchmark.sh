#!/usr/bin/env bash

# K6 LLM Stress Test Runner (DGX vs Runpod A6000)
# Penggunaan:
#   ./run_benchmark.sh [scenario: 1|2|3|4|all] [profile: smoke|runpod|dgx]
# Contoh:
#   ./run_benchmark.sh 1 smoke
#   ./run_benchmark.sh 2 runpod
#   ./run_benchmark.sh 2 dgx
#   ./run_benchmark.sh all dgx

# Otomatis muat environment variables dari file .env jika ada
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

SCENARIO=${1:-"1"}
PROFILE=${2:-"smoke"}

if [ "$1" = "clean" ]; then
  echo ">>> Membersihkan seluruh file laporan di folder 'reports/'..."
  rm -rf reports/*
  mkdir -p reports/raw
  node utils/consolidate_reports.js > /dev/null 2>&1 || true
  echo "[OK] Folder 'reports/' sudah bersih dan direset ke kondisi awal."
  exit 0
fi

mkdir -p reports/raw

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
echo "  Skenario:   $SCENARIO"
echo "  Profil:     $PROFILE ($SERVER_LABEL)"
echo "  Target URL: $ACTIVE_URL"
echo "=========================================================="

run_k6() {
  local script=$1
  local name=$2
  echo ""
  echo ">>> [RUNNING] $name (Profile: $PROFILE)"

  # Jalankan K6 tanpa abort jika threshold SLA terlampaui (exit code 99 biasa terjadi pada stress test)
  k6 run -e "PROFILE=$PROFILE" "$script" || {
    local exit_code=$?
    if [ $exit_code -eq 99 ]; then
      echo ">>> [CATATAN] Ambang batas (SLA Thresholds) terlewati pada $name (Exit Code 99: Overload/Degraded)."
    else
      echo ">>> [PERINGATAN] $name selesai dengan exit code $exit_code."
    fi
  }
}

case "$SCENARIO" in
  1)
    run_k6 "scenarios/01_thinking_short.js" "Scenario 1: Thinking ON + Short Context (1k)"
    ;;
  2)
    run_k6 "scenarios/02_thinking_long.js" "Scenario 2: Thinking ON + Long Context (128k)"
    ;;
  3)
    run_k6 "scenarios/03_no_thinking_short.js" "Scenario 3: Thinking OFF + Short Context (1k)"
    ;;
  4)
    run_k6 "scenarios/04_no_thinking_long.js" "Scenario 4: Thinking OFF + Long Context (128k)"
    ;;
  all)
    echo "Menjalankan seluruh 4 skenario..."
    run_k6 "scenarios/01_thinking_short.js" "Scenario 1: Thinking ON (1k)"
    sleep 3
    run_k6 "scenarios/03_no_thinking_short.js" "Scenario 3: Thinking OFF (1k)"
    sleep 3
    run_k6 "scenarios/02_thinking_long.js" "Scenario 2: Thinking ON (128k)"
    sleep 3
    run_k6 "scenarios/04_no_thinking_long.js" "Scenario 4: Thinking OFF (128k)"
    ;;
  *)
    echo "Pilihan skenario tidak valid! Gunakan: 1, 2, 3, 4, atau all"
    exit 1
    ;;
esac

echo ""
echo ">>> Menggabungkan laporan ke HTML konsolidasi..."
node utils/consolidate_reports.js "$PROFILE" || true

echo ""
echo "=========================================================="
echo "  Pengujian Selesai! Laporan utama tersimpan di:"
echo "  - reports/report_${PROFILE}.html"
echo "  - reports/report_comparison_dgx_vs_runpod.html"
echo "=========================================================="
