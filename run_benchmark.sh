#!/usr/bin/env bash

# K6 LLM Stress Test Runner (DGX vs Runpod A6000)
# Penggunaan:
#   ./run_benchmark.sh [scenario: 1|2|3|4|all] [profile: smoke|runpod|dgx]
# Contoh:
#   ./run_benchmark.sh 1 smoke
#   ./run_benchmark.sh 2 runpod
#   ./run_benchmark.sh 2 dgx
#   ./run_benchmark.sh all dgx

set -e

# Otomatis muat environment variables dari file .env jika ada
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

SCENARIO=${1:-"1"}
PROFILE=${2:-"smoke"}

mkdir -p reports

echo "=========================================================="
echo "  K6 LLM STRESS TEST: DGX vs RUNPOD (A6000)"
echo "  Skenario: $SCENARIO | Profil Target: $PROFILE"
echo "=========================================================="

run_k6() {
  local script=$1
  local name=$2
  echo ""
  echo ">>> [RUNNING] $name (Profile: $PROFILE)"
  k6 run -e PROFILE="$PROFILE" "$script"
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
echo "=========================================================="
echo "  Pengujian Selesai! Laporan tersimpan di folder 'reports/'"
echo "=========================================================="
