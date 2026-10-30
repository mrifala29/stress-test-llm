/**
 * Consolidator Laporan K6 LLM Stress Test (DGX vs Runpod)
 * Menggabungkan seluruh 4 skenario menjadi 3 laporan utama:
 * 1. reports/report_runpod.html (Seluruh skenario Runpod)
 * 2. reports/report_dgx.html (Seluruh skenario DGX)
 * 3. reports/report_comparison_dgx_vs_runpod.html (Perbandingan Head-to-Head DGX vs Runpod)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportsDir = path.join(__dirname, '..', 'reports');

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Baca konfigurasi .env untuk mendapatkan URL aktif Runpod dan DGX
const envPath = path.join(__dirname, '..', '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        envVars[key] = val;
      }
    }
  }
}

const runpodUrl = envVars.LLM_RUNPOD_URL || envVars.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions';
const dgxUrl = envVars.LLM_DGX_URL || envVars.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions';
const modelName = envVars.LLM_MODEL || 'Qwen3.6-35B-A3B';

const SCENARIO_DEFS = [
  { id: '01_thinking_short_1k', name: 'Skenario 1: Thinking ON + Short Context (1k)', shortName: 'Thinking ON (1k)', thinking: true, context: '1k' },
  { id: '02_thinking_long_128k', name: 'Skenario 2: Thinking ON + Long Context (128k)', shortName: 'Thinking ON (128k)', thinking: true, context: '128k' },
  { id: '03_no_thinking_short_1k', name: 'Skenario 3: Thinking OFF + Short Context (1k)', shortName: 'Thinking OFF (1k)', thinking: false, context: '1k' },
  { id: '04_no_thinking_long_128k', name: 'Skenario 4: Thinking OFF + Long Context (128k)', shortName: 'Thinking OFF (128k)', thinking: false, context: '128k' },
];

const rawDir = path.join(reportsDir, 'raw');
if (!fs.existsSync(rawDir)) {
  fs.mkdirSync(rawDir, { recursive: true });
}

function loadScenarioData(profile) {
  const results = {};
  for (const sc of SCENARIO_DEFS) {
    let jsonPath = path.join(rawDir, `${sc.id}_${profile}_summary.json`);
    if (!fs.existsSync(jsonPath)) {
      jsonPath = path.join(reportsDir, `${sc.id}_${profile}_summary.json`);
    }
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        results[sc.id] = JSON.parse(raw);
      } catch (err) {
        console.warn(`[WARN] Gagal membaca ${jsonPath}:`, err.message);
      }
    }
  }
  return results;
}

function extractMetrics(scenarioSummary) {
  if (!scenarioSummary || !scenarioSummary.metrics) return null;
  const m = scenarioSummary.metrics;

  const getVal = (metricObj, key, fallback = 0) => {
    if (metricObj && metricObj.values && metricObj.values[key] !== undefined) {
      return metricObj.values[key];
    }
    return fallback;
  };

  const ttftAvg = getVal(m.llm_ttft_ms, 'avg');
  const ttftP90 = getVal(m.llm_ttft_ms, 'p(90)');
  const tpsAvg = getVal(m.llm_tokens_per_second, 'avg');
  const tpsMax = getVal(m.llm_tokens_per_second, 'max');
  const oomRate = getVal(m.llm_oom_failures, 'rate') * 100;
  const successRate = getVal(m.llm_success_rate, 'rate', 1) * 100;
  const completionTokens = getVal(m.llm_completion_tokens, 'count');
  const promptTokens = getVal(m.llm_prompt_tokens, 'count');
  const totalTokens = getVal(m.llm_total_tokens, 'count') || (completionTokens + promptTokens);
  const iterations = getVal(m.iterations, 'count');
  const maxVUs = getVal(m.vus_max, 'value') || getVal(m.vus, 'max') || 0;

  return {
    ttftAvg: ttftAvg ? ttftAvg.toFixed(0) : '-',
    ttftP90: ttftP90 ? ttftP90.toFixed(0) : '-',
    tpsAvg: tpsAvg ? tpsAvg.toFixed(1) : '-',
    tpsMax: tpsMax ? tpsMax.toFixed(1) : '-',
    oomRate: oomRate.toFixed(1),
    successRate: successRate.toFixed(1),
    completionTokens: completionTokens.toLocaleString(),
    promptTokens: promptTokens.toLocaleString(),
    totalTokens: totalTokens.toLocaleString(),
    iterations,
    maxVUs,
    passed: successRate >= 95 && oomRate < 5,
  };
}

function generateSingleServerHTML(profile, data) {
  const isRunpod = profile.toLowerCase().includes('runpod') || profile.toLowerCase().includes('a6000');
  const serverTitle = isRunpod 
    ? 'Runpod — NVIDIA RTX A6000 Ada (48GB GDDR6)' 
    : 'Server DGX — High-VRAM HBM Architecture';
  const serverBadge = isRunpod ? 'Runpod (A6000 Ada)' : 'Server DGX';
  const badgeColor = isRunpod ? '#f59e0b' : '#3b82f6';
  const activeEndpoint = isRunpod ? runpodUrl : dgxUrl;

  let tableRows = '';
  let totalReqs = 0;
  let allPassed = true;
  let completedCount = 0;

  for (const sc of SCENARIO_DEFS) {
    const raw = data[sc.id];
    const metrics = extractMetrics(raw);

    if (metrics) {
      completedCount++;
      totalReqs += metrics.iterations;
      if (!metrics.passed) allPassed = false;

      const statusBadge = metrics.passed
        ? `<span class="badge badge-success">PASSED</span>`
        : `<span class="badge badge-danger">FAILED (OOM / Degraded)</span>`;

      tableRows += `
        <tr>
          <td>
            <strong>${sc.name}</strong>
            <div class="text-muted small">Thinking: ${sc.thinking ? 'ON' : 'OFF'} | Context: ${sc.context}</div>
          </td>
          <td>${statusBadge}</td>
          <td>${metrics.ttftAvg} ms <span class="text-muted small">(p90: ${metrics.ttftP90} ms)</span></td>
          <td><strong>${metrics.tpsAvg}</strong> <span class="text-muted small">tps (peak: ${metrics.tpsMax})</span></td>
          <td>${metrics.maxVUs} VUs</td>
          <td><span class="${metrics.oomRate > 0 ? 'text-danger font-bold' : 'text-success'}">${metrics.oomRate}%</span></td>
          <td>${metrics.successRate}%</td>
          <td>${metrics.iterations}</td>
        </tr>
      `;
    } else {
      tableRows += `
        <tr class="opacity-60">
          <td>
            <strong>${sc.name}</strong>
            <div class="text-muted small">Thinking: ${sc.thinking ? 'ON' : 'OFF'} | Context: ${sc.context}</div>
          </td>
          <td><span class="badge badge-neutral">MENUNGGU TES</span></td>
          <td colspan="6" class="text-muted italic">Skenario ini belum dijalankan. Jalankan: <code>./run_benchmark.sh ${sc.id.slice(0, 2).replace(/^0+/, '')} ${profile}</code></td>
        </tr>
      `;
    }
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laporan Uji Beban LLM - ${serverBadge}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: ${badgeColor};
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 32px 20px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header h1 { font-size: 26px; font-weight: 700; color: #fff; }
    .header p { color: var(--muted); font-size: 14px; margin-top: 4px; }
    .server-pill {
      background: var(--accent);
      color: #fff;
      padding: 8px 18px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .endpoint-badge {
      display: inline-block;
      margin-top: 8px;
      background: rgba(255,255,255,0.06);
      padding: 4px 10px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .stat-label { font-size: 13px; color: var(--muted); text-transform: uppercase; font-weight: 600; }
    .stat-value { font-size: 28px; font-weight: 700; margin: 8px 0; color: #fff; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
      overflow-x: auto;
    }
    .card-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #fff; display: flex; align-items: center; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 12px 14px; background: rgba(0,0,0,0.25); color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 14px; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-neutral { background: rgba(148, 163, 184, 0.15); color: var(--muted); border: 1px solid rgba(148, 163, 184, 0.3); }
    .text-muted { color: var(--muted); }
    .small { font-size: 12px; }
    .text-success { color: #34d399; }
    .text-danger { color: #f87171; }
    .font-bold { font-weight: 700; }
    .italic { font-style: italic; }
    .opacity-60 { opacity: 0.6; }
    code { font-family: monospace; color: #38bdf8; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; }
    .footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 40px; }
    .nav-links { display: flex; gap: 12px; margin-bottom: 24px; }
    .nav-btn {
      text-decoration: none;
      color: #94a3b8;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .nav-btn.active { color: #fff; background: var(--accent); border-color: var(--accent); }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav-links">
      <a href="report_runpod.html" class="nav-btn ${isRunpod ? 'active' : ''}">Laporan Runpod</a>
      <a href="report_dgx.html" class="nav-btn ${!isRunpod ? 'active' : ''}">Laporan DGX</a>
      <a href="report_comparison_dgx_vs_runpod.html" class="nav-btn">Laporan Head-to-Head</a>
    </div>

    <div class="header">
      <div>
        <h1>Laporan Komprehensif Uji Beban LLM (K6)</h1>
        <p>Model Target: <strong>${modelName}</strong> | Arsitektur: ${serverTitle}</p>
        <div class="endpoint-badge">Target Endpoint: ${activeEndpoint}</div>
      </div>
      <div class="server-pill">${serverBadge}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Skenario Selesai</div>
        <div class="stat-value">${completedCount} / 4</div>
        <div class="text-muted small">Cakupan pengujian inferensi</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Permintaan (Requests)</div>
        <div class="stat-value">${totalReqs.toLocaleString()}</div>
        <div class="text-muted small">Akumulasi request pada server</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Status SLA & Kestabilan</div>
        <div class="stat-value" style="color: ${completedCount === 0 ? '#94a3b8' : (allPassed ? '#34d399' : '#f87171')}">
          ${completedCount === 0 ? 'MENUNGGU TES' : (allPassed ? 'STABIL' : 'TERDETEKSI OOM')}
        </div>
        <div class="text-muted small">${completedCount === 0 ? 'Belum ada eksekusi K6' : (allPassed ? 'Toleransi OOM di bawah 5%' : 'Terjadi degradasi / 500 error')}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Matriks Hasil 4 Skenario Inferensi</span>
        <span class="text-muted small">Di-generate otomatis oleh K6 LLM Suite</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Skenario</th>
            <th>Status SLA</th>
            <th>TTFT (Waktu Token 1)</th>
            <th>Generation Speed</th>
            <th>Max VUs</th>
            <th>OOM / 500 Error</th>
            <th>Success Rate</th>
            <th>Total Req</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      Generated on ${new Date().toLocaleString('id-ID')} &bull; K6 LLM Stress Test Framework
    </div>
  </div>
</body>
</html>
`;
}

function generateHeadToHeadHTML(runpodData, dgxData) {
  let rows = '';
  let runpodTested = 0;
  let dgxTested = 0;

  for (const sc of SCENARIO_DEFS) {
    const rMetrics = extractMetrics(runpodData[sc.id]);
    const dMetrics = extractMetrics(dgxData[sc.id]);

    if (rMetrics) runpodTested++;
    if (dMetrics) dgxTested++;

    const rStatus = rMetrics ? (rMetrics.passed ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-danger">OOM / Fail</span>') : '<span class="badge badge-neutral">Belum Diuji</span>';
    const dStatus = dMetrics ? (dMetrics.passed ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-danger">OOM / Fail</span>') : '<span class="badge badge-neutral">Belum Diuji</span>';

    rows += `
      <tr>
        <td>
          <strong>${sc.name}</strong>
          <div class="text-muted small">Thinking: ${sc.thinking ? 'ON' : 'OFF'} | Context: ${sc.context}</div>
        </td>
        <td>${rStatus}</td>
        <td><strong>${rMetrics ? rMetrics.tpsAvg : '-'}</strong> tps</td>
        <td>${rMetrics ? rMetrics.ttftAvg : '-'} ms</td>
        <td>${rMetrics ? (rMetrics.oomRate > 0 ? '<span class="text-danger font-bold">' + rMetrics.oomRate + '%</span>' : rMetrics.oomRate + '%') : '-'}</td>
        <td style="border-left: 2px solid #334155;">${dStatus}</td>
        <td><strong class="text-success">${dMetrics ? dMetrics.tpsAvg : '-'}</strong> tps</td>
        <td class="text-success">${dMetrics ? dMetrics.ttftAvg : '-'} ms</td>
        <td>${dMetrics ? dMetrics.oomRate + '%' : '-'}</td>
      </tr>
    `;
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benchmark Head-to-Head: Server DGX vs Runpod (A6000)</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --runpod: #f59e0b;
      --dgx: #3b82f6;
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 32px 20px;
      line-height: 1.5;
    }
    .container { max-width: 1300px; margin: 0 auto; }
    .nav-links { display: flex; gap: 12px; margin-bottom: 24px; }
    .nav-btn {
      text-decoration: none;
      color: #94a3b8;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .nav-btn.active { color: #fff; background: #6366f1; border-color: #6366f1; }
    .header {
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
      text-align: center;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; color: #fff; font-weight: 700; }
    .header p { color: var(--muted); font-size: 15px; }
    .endpoints-container {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    .endpoint-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
    }
    .endpoint-card strong { color: #fff; }
    .endpoint-card code { font-family: monospace; color: #38bdf8; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
      overflow-x: auto;
    }
    .card-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #fff; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 12px 14px; background: rgba(0,0,0,0.3); color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 14px; border-bottom: 1px solid var(--border); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .badge-neutral { background: rgba(148, 163, 184, 0.15); color: var(--muted); }
    .text-success { color: #34d399; }
    .text-danger { color: #f87171; }
    .font-bold { font-weight: 700; }
    .text-muted { color: var(--muted); }
    .small { font-size: 12px; }
    .footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav-links">
      <a href="report_runpod.html" class="nav-btn">Laporan Runpod</a>
      <a href="report_dgx.html" class="nav-btn">Laporan DGX</a>
      <a href="report_comparison_dgx_vs_runpod.html" class="nav-btn active">Laporan Head-to-Head</a>
    </div>

    <div class="header">
      <h1>Hasil Evaluasi Head-to-Head: Server DGX vs Runpod (RTX A6000 Ada)</h1>
      <p>Benchmark Kapasitas Inferensi & Batas KV-Cache Model <strong>${modelName}</strong></p>
      <div class="endpoints-container">
        <div class="endpoint-card">
          <strong style="color: #fbbf24;">Runpod URL:</strong> <code>${runpodUrl}</code>
        </div>
        <div class="endpoint-card">
          <strong style="color: #60a5fa;">DGX URL:</strong> <code>${dgxUrl}</code>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">1. Matriks Hasil Aktual Pengujian Beban (K6)</div>
      <table>
        <thead>
          <tr>
            <th rowspan="2">Skenario Uji</th>
            <th colspan="4" style="text-align: center; background: rgba(245, 158, 11, 0.15); color: #fbbf24;">RUNPOD (RTX A6000 Ada - 48GB GDDR6)</th>
            <th colspan="4" style="text-align: center; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border-left: 2px solid #334155;">SERVER DGX (High-VRAM HBM)</th>
          </tr>
          <tr>
            <th>Status</th>
            <th>TPS</th>
            <th>TTFT</th>
            <th>OOM %</th>
            <th style="border-left: 2px solid #334155;">Status</th>
            <th>TPS</th>
            <th>TTFT</th>
            <th>OOM %</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">2. Target Spesifikasi Benchmark PM (Referensi Evaluasi)</div>
      <table>
        <thead>
          <tr>
            <th>Metrik Evaluasi</th>
            <th style="color: #fbbf24;">Target Runpod (A6000 Ada)</th>
            <th style="color: #60a5fa;">Target Server DGX</th>
            <th>Cara Pengukuran K6</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>VRAM Footprint & KV-Cache</strong></td>
            <td>48 GB GDDR6 (~20–24 GB KV-Cache)</td>
            <td>High VRAM HBM (~70–105 GB KV-Cache)</td>
            <td>Pantau titik lonjakan OOM saat multi-user</td>
          </tr>
          <tr>
            <td><strong>Peak Generation Speed</strong></td>
            <td>~30 – 45 tokens/detik (Single User)</td>
            <td>~150 – 170+ tokens/detik</td>
            <td><code>llm_tokens_per_second</code> (Profile: 1 VU)</td>
          </tr>
          <tr>
            <td><strong>Throughput Multi-User</strong></td>
            <td>~15 – 25 tokens/detik per stream</td>
            <td>~72 – 95+ tokens/detik per stream</td>
            <td><code>llm_tokens_per_second</code> (Stress Profile)</td>
          </tr>
          <tr>
            <td><strong>Time-to-First-Token (TTFT)</strong></td>
            <td>Latensi tinggi (>3.5s pada long context)</td>
            <td>Ultra-low latency (<0.8s – 1.2s)</td>
            <td><code>llm_ttft_ms</code> via SSE stream TTFB</td>
          </tr>
          <tr>
            <td><strong>Max Concurrent Users</strong></td>
            <td>~4 – 8 loops (rentan OOM)</td>
            <td>72+ highly concurrent agentic loops</td>
            <td><code>llm_oom_failures</code> pada Ramping VUs</td>
          </tr>
          <tr>
            <td><strong>Max Context Window</strong></td>
            <td>Terbatas (~16K – 32K di bawah beban)</td>
            <td>Full context (128K tokens)</td>
            <td>Payload <code>data/long_context_128k.json</code></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer">
      Generated on ${new Date().toLocaleString('id-ID')} &bull; K6 LLM Stress Test Framework
    </div>
  </div>
</body>
</html>
`;
}

// Selalu generate seluruh laporan: Runpod, DGX, dan Head-to-Head
['runpod', 'dgx'].forEach(prof => {
  const data = loadScenarioData(prof);
  const html = generateSingleServerHTML(prof, data);
  const outPath = path.join(reportsDir, `report_${prof}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[OK] Laporan server berhasil dibuat: ${outPath}`);
});

// Selalu buat laporan perbandingan Head-to-Head
const runpodData = loadScenarioData('runpod');
const dgxData = loadScenarioData('dgx');
const compHtml = generateHeadToHeadHTML(runpodData, dgxData);
const compPath = path.join(reportsDir, 'report_comparison_dgx_vs_runpod.html');
fs.writeFileSync(compPath, compHtml, 'utf8');
console.log(`[OK] Laporan perbandingan Head-to-Head berhasil dibuat: ${compPath}`);
