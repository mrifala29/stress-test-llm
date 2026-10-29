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
| **Max Concurrent Users** | ~4 – 8 loops (rentan OOM) | 72+ highly concurrent agentic loops | `llm_oom_failures` pada Ramping VUs |
| **Max Context Window** | Terbatas (~16K – 32K di bawah beban) | Full context (Diuji pada 128K tokens) | Payload `data/long_context_128k.json` |

---

## 📁 Struktur Repositori

```text
stress-test-llm/
├── .env / .env.example          # Kredensial endpoint Runpod & DGX (git-ignored)
├── README.md                    # Dokumentasi lengkap & panduan uji
├── config.js                    # Konfigurasi endpoint terpisah & profil beban
├── run_benchmark.sh             # Script runner otomatis
├── package.json                 # Script shortcut npm
├── dashboards/
│   └── grafana_dashboard.json   # Definisi dashboard monitoring Grafana
├── data/
│   ├── short_context_1k.json    # Prompt pendek (~1.000 tokens)
│   └── long_context_128k.json   # Dokumen konteks panjang (~128.000 tokens)
├── utils/
│   ├── metrics.js               # Definisi custom metrics (TTFT, TPS, OOM)
│   ├── request_helper.js        # Engine HTTP POST + Parser SSE streaming
│   ├── summary_reporter.js      # Generator HTML report & JSON summary per skenario
│   └── consolidate_reports.js   # Generator laporan konsolidasi & perbandingan Head-to-Head
└── scenarios/
    ├── 01_thinking_short.js     # Skenario 1: Thinking ON + Short Context (1k)
    ├── 02_thinking_long.js      # Skenario 2: Thinking ON + Long Context (128k)
    ├── 03_no_thinking_short.js  # Skenario 3: Thinking OFF + Short Context (1k)
    └── 04_no_thinking_long.js   # Skenario 4: Thinking OFF + Long Context (128k)
```

---

## 🚀 Cara Menjalankan Pengujian

Format perintah: `./run_benchmark.sh [skenario: 1|2|3|4|all] [profil: smoke|runpod|dgx]`

* **Smoke Test (Sanity Check 1 VU):**
  ```bash
  ./run_benchmark.sh 1 smoke
  ```

* **Uji Runpod (A6000 Ada) — Uji Titik OOM (1 $\rightarrow$ 4 $\rightarrow$ 8 $\rightarrow$ 12 VUs):**
  ```bash
  # Skenario 1: Thinking ON (1k context)
  ./run_benchmark.sh 1 runpod

  # Skenario 2: Thinking ON (128k context) - cek batas OOM KV-Cache
  ./run_benchmark.sh 2 runpod
  ```

* **Uji Server DGX — Uji Konkurensi Tinggi (5 $\rightarrow$ 20 $\rightarrow$ 50 $\rightarrow$ 75 $\rightarrow$ 90 VUs):**
  ```bash
  # Skenario 1: Thinking ON (1k context)
  ./run_benchmark.sh 1 dgx

  # Skenario 2: Thinking ON (128k context) - validasi 72+ concurrent loops
  ./run_benchmark.sh 2 dgx
  ```

* **Jalankan Keempat Skenario Berturut-turut:**
  ```bash
  ./run_benchmark.sh all dgx
  ```

---

## 📈 Dashboard Grafana Live & Prometheus (`server-dev`)

Dashboard resmi telah terpasang di Grafana:
* 🔗 **Direct URL:** [https://grafana.linkit360.ai/d/llm-dgx-runpod/llm-benchmark3a-dgx-vs-runpod-a6000](https://grafana.linkit360.ai/d/llm-dgx-runpod/llm-benchmark3a-dgx-vs-runpod-a6000)
* 📁 **File Konfigurasi:** [`dashboards/grafana_dashboard.json`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/dashboards/grafana_dashboard.json)

Untuk mengalirkan metrik K6 secara live saat pengujian:
```bash
k6 run \
  -o experimental-prometheus-rw=${PROMETHEUS_REMOTE_WRITE_URL:-http://<PROMETHEUS_HOST>:9600/api/v1/push} \
  -e PROFILE=dgx \
  scenarios/01_thinking_short.js
```
*Panel di Grafana akan langsung menampilkan lonjakan Concurrency (VUs), TTFT real-time, Tokens/sec per stream, dan mendeteksi titik OOM (HTTP 500).*

---

## 📄 Hasil Laporan Visual HTML & Summary JSON
 
Setiap kali pengujian dijalankan, K6 dan generator laporan otomatis menghasilkan laporan visual HTML interaktif di folder `reports/`:

### 🏆 3 Laporan Utama untuk PM & Tim Dev:
1. 📊 **[`reports/report_runpod.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_runpod.html)**
   * Merangkum seluruh performa 4 skenario pada server **Runpod (RTX A6000 Ada)**.
2. 📊 **[`reports/report_dgx.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_dgx.html)**
   * Merangkum seluruh performa 4 skenario pada **Server DGX**.
3. ⚔️ **[`reports/report_comparison_dgx_vs_runpod.html`](file:///Users/alfarizy/Desktop/Project/stress-test-llm/reports/report_comparison_dgx_vs_runpod.html)**
   * Laporan **Head-to-Head Comparison** yang membandingkan performa DGX vs Runpod secara berdampingan (*side-by-side*) langsung mengacu pada Matriks Target PM.

File `.html` ini bersifat *standalone* (dapat dibuka langsung di browser seperti Chrome, Safari, atau Firefox) dan dilengkapi tombol navigasi untuk berpindah antar laporan dengan satu klik.

Untuk me-refresh atau membuat ulang laporan kapan saja, jalankan:
```bash
npm run report
```
