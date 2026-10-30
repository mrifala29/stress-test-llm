# LLM Stress Testing & GPU Capacity Benchmark (DGX vs Runpod)

Suite pengujian beban (*stress test*) K6 untuk membandingkan kapasitas dan kestabilan inferensi model **Qwen3.6-35B-A3B** antara server **DGX** dan **Runpod (RTX A6000 Ada)**.

---

## 📊 Matriks Target Benchmark (PM)

| Metrik Evaluasi | Runpod (RTX A6000 Ada) | Server DGX | Cara Pengukuran K6 |
| :--- | :--- | :--- | :--- |
| **VRAM Footprint & KV-Cache** | 48 GB GDDR6 (~20–24 GB KV-Cache) | High VRAM HBM (~70–105 GB KV-Cache) | Monitor lonjakan OOM saat multi-user |
| **Peak Generation Speed** | ~30 – 45 tokens/detik (Single User) | ~150 – 170+ tokens/detik | `llm_tokens_per_second` (Profile: 1 VU) |
| **Throughput Multi-User** | ~15 – 25 tokens/detik per stream | ~72 – 95+ tokens/detik per stream | `llm_tokens_per_second` (Stress Profile) |
| **Time-to-First-Token (TTFT)** | Latensi tinggi (>3.5s pada long context) | Ultra-low latency (<0.8s – 1.2s) | `llm_ttft_ms` via SSE stream TTFB |
| **Max Concurrent Users** | ~4 – 8 loops (rentan OOM) | 72+ highly concurrent agentic loops | `llm_fail_*` & `llm_retries` pada Ramping VUs |
| **Max Context Window** | Hingga 64K | Hingga 64K | Payload `data/context_{1k..64k}.json` |

---

## 📁 Struktur Repositori

```text
stress-test-llm/
├── .env / .env.example          # Kredensial endpoint Runpod & DGX (git-ignored)
├── config.js                    # Endpoint & profil beban (sama untuk Runpod & DGX, maks 100 VU)
├── run_benchmark.sh             # Script runner otomatis
├── scripts/generate_payloads.js # Generator payload konteks 1k..64k
├── data/context_{1k,2k,4k,16k,32k,64k}.json
├── scenarios/benchmark.js       # Skenario parametrik (CONTEXT, THINKING)
├── utils/
│   ├── metrics.js               # Custom metrics (TTFT, TPS, retry, penyebab gagal)
│   ├── request_helper.js        # HTTP POST + parser SSE + retry 3x
│   ├── summary_reporter.js      # JSON summary per skenario
│   └── consolidate_reports.js   # Generator laporan HTML + kesimpulan
└── dashboards/grafana_dashboard.json
```

---

## 🧪 Skenario Uji (12 per server)

| Kategori | Konteks | Thinking |
| :--- | :--- | :--- |
| Short | 1k, 2k, 4k, 16k | ON & OFF |
| Long | 32k, 64k (maksimum 64k) | ON & OFF |

* **Profil beban sama untuk kedua server:** 1 → 10 → 25 → 50 → 75 → 100 VU → 0.
* **Retry:** request yang kena OOM/overload (HTTP 5xx, 429, timeout) diulang hingga **3x**. Jika tetap gagal dinyatakan **FAILED**. Error 4xx tidak di-retry.
* Skenario **PASSED** bila success rate final ≥ 95%. Setiap laporan HTML memiliki bagian **Kesimpulan** di bagian paling bawah.

---

## 🚀 Cara Menjalankan Pengujian

Format: `./run_benchmark.sh [target] [profil: smoke|runpod|dgx]`

Target: `1k|2k|4k|16k|32k|64k` (thinking ON & OFF), `<ctx>:on|off`, `short`, `long`, `all`.

```bash
node scripts/generate_payloads.js    # sekali, bila data/ belum ada
./run_benchmark.sh 1k smoke          # sanity check
./run_benchmark.sh short runpod      # 1k, 2k, 4k, 16k
./run_benchmark.sh long runpod       # 32k, 64k
./run_benchmark.sh 64k:on dgx        # satu skenario
./run_benchmark.sh all dgx           # seluruh 12 skenario
```

Variabel opsional: `-e MAX_TOKENS=4096`, `-e MAX_RETRIES=3`, `-e TIMEOUT_MS=...` (default menyesuaikan ukuran konteks).

---

## 📈 Dashboard Grafana Live & Prometheus (`server-dev`)

Dashboard resmi telah terpasang di Grafana:
* 🔗 **Direct URL:** [https://grafana.linkit360.ai/d/llm-dgx-runpod/llm-benchmark3a-dgx-vs-runpod-a6000](https://grafana.linkit360.ai/d/llm-dgx-runpod/llm-benchmark3a-dgx-vs-runpod-a6000)
* 📁 **File Konfigurasi:** [`dashboards/grafana_dashboard.json`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/dashboards/grafana_dashboard.json)

Untuk mengalirkan metrik K6 secara live saat pengujian:
```bash
k6 run \
  -o experimental-prometheus-rw=${PROMETHEUS_REMOTE_WRITE_URL:-http://<PROMETHEUS_HOST>:9600/api/v1/push} \
  -e PROFILE=dgx -e CONTEXT=1k -e THINKING=on \
  scenarios/benchmark.js
```
*Panel di Grafana akan langsung menampilkan lonjakan Concurrency (VUs), TTFT real-time, Tokens/sec per stream, dan mendeteksi titik OOM (HTTP 500).*

---

## 📄 Hasil Laporan Visual HTML & Summary JSON
 
Setiap kali pengujian dijalankan, K6 dan generator laporan otomatis menghasilkan laporan visual HTML interaktif di folder `reports/`:

### 🏆 3 Laporan Utama untuk PM & Tim Dev:
1. 📊 **[`reports/report_runpod.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_runpod.html)**
   * Merangkum seluruh performa 12 skenario pada server **Runpod (RTX A6000 Ada)**.
2. 📊 **[`reports/report_dgx.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_dgx.html)**
   * Merangkum seluruh performa 12 skenario pada **Server DGX**.
3. ⚔️ **[`reports/report_comparison_dgx_vs_runpod.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_comparison_dgx_vs_runpod.html)**
   * Laporan **Head-to-Head Comparison** yang membandingkan performa DGX vs Runpod secara berdampingan (*side-by-side*) langsung mengacu pada Matriks Target PM.

File `.html` ini bersifat *standalone* (dapat dibuka langsung di browser seperti Chrome, Safari, atau Firefox) dan dilengkapi tombol navigasi untuk berpindah antar laporan dengan satu klik.

* Seluruh data mentah JSON dan laporan rincian per skenario disimpan terpisah di subfolder `reports/raw/` sehingga folder kerja tetap rapi.
* Untuk me-refresh atau membuat ulang laporan kapan saja:
  ```bash
  npm run report
  ```
* Untuk membersihkan dan me-reset seluruh laporan pengujian:
  ```bash
  npm run clean
  # atau:
  ./run_benchmark.sh clean
  ```
