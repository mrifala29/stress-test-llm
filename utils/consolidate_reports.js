/**
 * Konsolidator Laporan K6 LLM Stress Test (DGX vs Runpod)
 *
 * Membaca reports/raw/*_summary.json dan menghasilkan, dengan tema seragam:
 *  1. reports/raw/<skenario>_<profil>_report.html (laporan per skenario)
 *  2. reports/report_runpod.html                  (seluruh skenario Runpod)
 *  3. reports/report_dgx.html                     (seluruh skenario DGX)
 *  4. reports/report_comparison_dgx_vs_runpod.html (head-to-head)
 *
 * Setiap laporan ditutup dengan bagian Kesimpulan.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, '..', 'reports');
const rawDir = path.join(reportsDir, 'raw');
fs.mkdirSync(rawDir, { recursive: true });

// ---------- Konfigurasi dari .env ----------
const envVars = {};
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('=');
      if (i > -1) envVars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
}
const DEFAULT_URL = 'https://llm.linkit360.ai/v1/chat/completions';
const runpodUrl = envVars.LLM_RUNPOD_URL || envVars.LLM_BASE_URL || DEFAULT_URL;
const dgxUrl = envVars.LLM_DGX_URL || envVars.LLM_BASE_URL || DEFAULT_URL;
const modelName = envVars.LLM_MODEL || 'Qwen3.6-35B-A3B';

// ---------- Definisi skenario ----------
// Skenario ringkas aktif: 1k, 16k, dan 32k.
// Konteks lain (2k, 4k, 64k) hanya disertakan jika datanya ada di reports/raw/ agar tabel tidak kosong melompong.
const ALL_KNOWN_CONTEXTS = ['1k', '2k', '4k', '16k', '32k', '64k'];
const DEFAULT_ACTIVE_CONTEXTS = ['1k', '16k', '32k'];

const detectedContexts = new Set();
if (fs.existsSync(rawDir)) {
  const files = fs.readdirSync(rawDir);
  for (const f of files) {
    if (!f.endsWith('_summary.json')) continue;
    for (const ctx of ALL_KNOWN_CONTEXTS) {
      if (f.includes(`_${ctx}_`)) {
        detectedContexts.add(ctx);
      }
    }
  }
}

// Gunakan konteks yang ada datanya di raw/, atau default ke 1k, 16k, 32k
const activeSet = detectedContexts.size > 0 ? detectedContexts : new Set(DEFAULT_ACTIVE_CONTEXTS);
const CONTEXTS = ALL_KNOWN_CONTEXTS.filter((ctx) => activeSet.has(ctx));
const LONG_CONTEXTS = ['32k', '64k'];

const SCENARIOS = [];
for (const ctx of CONTEXTS) {
  for (const thinking of [true, false]) {
    SCENARIOS.push({
      id: `think_${thinking ? 'on' : 'off'}_${ctx}`,
      name: `Thinking ${thinking ? 'ON' : 'OFF'} + ${LONG_CONTEXTS.includes(ctx) ? 'Long' : 'Short'} Context (${ctx})`,
      thinking,
      context: ctx,
      category: LONG_CONTEXTS.includes(ctx) ? 'Long' : 'Short',
    });
  }
}

const SERVERS = {
  runpod: { key: 'runpod', label: 'Runpod (RTX A6000 Ada)', title: 'Runpod — NVIDIA RTX A6000 Ada (48GB GDDR6)', url: runpodUrl },
  dgx: { key: 'dgx', label: 'Server DGX', title: 'Server DGX — High-VRAM HBM Architecture', url: dgxUrl },
};

const PASS_THRESHOLD = 95; // % success rate (final, setelah retry)

// ---------- Pemuatan & ekstraksi data ----------
function loadSummary(id, profile) {
  const p = path.join(rawDir, `${id}_${profile}_summary.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.warn(`[WARN] Gagal membaca ${p}: ${err.message}`);
    return null;
  }
}

function loadAll(profile) {
  const out = {};
  for (const sc of SCENARIOS) out[sc.id] = extractMetrics(loadSummary(sc.id, profile));
  return out;
}

function extractMetrics(summary) {
  if (!summary || !summary.metrics) return null;
  const m = summary.metrics;
  const v = (name, key, fb = 0) => (m[name] && m[name].values && m[name].values[key] !== undefined ? m[name].values[key] : fb);

  const passes = v('llm_success_rate', 'passes');
  const fails = v('llm_success_rate', 'fails');
  const requests = passes + fails;
  const successRate = requests > 0 ? (passes / requests) * 100 : 0;

  const firstErrorVU = v('llm_first_error_vu', 'min', null);
  const maxVUs = v('vus_max', 'value') || v('vus', 'max') || 1000;
  let maxSafeVU = maxVUs;
  let breakingPointText = `Stabil s/d ${maxVUs} VU`;
  if (firstErrorVU !== null && firstErrorVU !== undefined && firstErrorVU > 0) {
    const vuInt = Math.round(firstErrorVU);
    maxSafeVU = vuInt > 1 ? vuInt - 1 : 1;
    breakingPointText = `Error pertama di ~${vuInt} VU`;
  } else if (requests === 0) {
    maxSafeVU = '-';
    breakingPointText = '-';
  }

  return {
    requests,
    passes,
    fails,
    successRate,
    ttftAvg: v('llm_ttft_ms', 'avg', null),
    ttftP90: v('llm_ttft_ms', 'p(90)', null),
    ttftP95: v('llm_ttft_ms', 'p(95)', null),
    tpsAvg: v('llm_tokens_per_second', 'avg', null),
    tpsMed: v('llm_tokens_per_second', 'med', null),
    tpsMax: v('llm_tokens_per_second', 'max', null),
    e2eAvg: v('llm_e2e_duration_ms', 'avg', null),
    e2eP95: v('llm_e2e_duration_ms', 'p(95)', null),
    promptTokens: v('llm_prompt_tokens', 'count'),
    completionTokens: v('llm_completion_tokens', 'count'),
    totalTokens: v('llm_total_tokens', 'count'),
    retries: v('llm_retries', 'count'),
    failOom: v('llm_fail_oom_5xx', 'count'),
    failTimeout: v('llm_fail_timeout', 'count'),
    failNoResp: v('llm_fail_noresp', 'count'),
    fail429: v('llm_fail_429', 'count'),
    fail4xx: v('llm_fail_4xx', 'count'),
    firstErrorVU,
    maxSafeVU,
    breakingPointText,
    iterations: v('iterations', 'count'),
    maxVUs,
    status: requests > 0 && successRate >= PASS_THRESHOLD ? 'PASSED' : 'FAILED',
    raw: m,
  };
}

// ---------- Helper format ----------
const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(d));
const fmtSec = (ms) => (ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(2)} s`);
const fmtInt = (n) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('id-ID'));
const failedAttempts = (x) => x.failOom + x.failTimeout + x.failNoResp + x.fail429 + x.fail4xx;

function statusBadge(x) {
  if (!x) return '<span class="badge badge-neutral">NOT RUN</span>';
  return x.status === 'PASSED'
    ? '<span class="badge badge-success">PASSED</span>'
    : '<span class="badge badge-danger">FAILED</span>';
}

function maxSafeBadge(x) {
  if (!x || x.requests === 0) return '<span class="text-muted">-</span>';
  if (x.firstErrorVU && x.firstErrorVU > 0) {
    return `<span class="badge" style="background:rgba(245,158,11,0.2); color:#fbbf24; font-weight:700;">Kuat s/d ${x.maxSafeVU} VU</span> <span class="text-muted small">(${x.breakingPointText})</span>`;
  }
  if (x.status === 'PASSED') {
    return `<span class="badge badge-success" style="font-weight:700;">Kuat ${x.maxVUs} VU (Penuh)</span>`;
  }
  return `<span class="text-muted">${x.breakingPointText}</span>`;
}

function causeText(x) {
  const parts = [];
  if (x.failOom) parts.push(`OOM/5xx ${x.failOom}`);
  if (x.failTimeout) parts.push(`timeout ${x.failTimeout}`);
  if (x.failNoResp) parts.push(`tanpa respons ${x.failNoResp}`);
  if (x.fail429) parts.push(`429 ${x.fail429}`);
  if (x.fail4xx) parts.push(`4xx ${x.fail4xx}`);
  return parts.length ? parts.join(', ') : '-';
}

// ---------- Kerangka HTML (tema seragam) ----------
const CSS = `
    :root { --bg:#0f172a; --card-bg:#1e293b; --border:#334155; --text:#f8fafc; --muted:#94a3b8; --runpod:#f59e0b; --dgx:#3b82f6; --success:#10b981; --danger:#ef4444; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 32px 20px; line-height: 1.5; }
    .container { max-width: 1300px; margin: 0 auto; }
    .nav-links { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .nav-btn { text-decoration: none; color: #94a3b8; background: rgba(255,255,255,0.05); border: 1px solid var(--border); padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; transition: all 0.2s; }
    .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .nav-btn.active { color: #fff; background: #6366f1; border-color: #6366f1; }
    .header { padding-bottom: 24px; border-bottom: 1px solid var(--border); margin-bottom: 32px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 8px; color: #fff; font-weight: 700; }
    .header p { color: var(--muted); font-size: 15px; }
    .endpoints-container { display: flex; justify-content: center; gap: 20px; margin-top: 16px; flex-wrap: wrap; }
    .endpoint-card { background: rgba(255,255,255,0.04); border: 1px solid var(--border); padding: 8px 16px; border-radius: 8px; font-size: 13px; }
    .endpoint-card strong { color: #fff; }
    .endpoint-card code { font-family: monospace; color: #38bdf8; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; overflow-x: auto; }
    .card-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #fff; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 12px 14px; background: rgba(0,0,0,0.3); color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 14px; border-bottom: 1px solid var(--border); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-success { background: rgba(16,185,129,0.15); color: #34d399; }
    .badge-danger { background: rgba(239,68,68,0.15); color: #f87171; }
    .badge-neutral { background: rgba(148,163,184,0.15); color: var(--muted); }
    .text-success { color: #34d399; }
    .text-danger { color: #f87171; }
    .font-bold { font-weight: 700; }
    .text-muted { color: var(--muted); }
    .small { font-size: 12px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .stat { background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
    .stat .label { color: var(--muted); font-size: 12px; }
    .stat .value { font-size: 22px; font-weight: 700; color: #fff; }
    .conclusion ul { padding-left: 20px; }
    .conclusion li { margin-bottom: 10px; font-size: 14px; }
    .conclusion .verdict { margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: rgba(99,102,241,0.12); border: 1px solid #6366f1; font-size: 14px; }
    .footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 40px; }
`;

function page({ title, heading, subtitle, active, body, endpoints = '' }) {
  const nav = (href, label, key) => `<a href="${href}" class="nav-btn${active === key ? ' active' : ''}">${label}</a>`;
  const prefix = active.startsWith('raw') ? '../' : '';
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <div class="nav-links">
      ${nav(prefix + 'report_runpod.html', 'Laporan Runpod', 'runpod')}
      ${nav(prefix + 'report_dgx.html', 'Laporan DGX', 'dgx')}
      ${nav(prefix + 'report_comparison_dgx_vs_runpod.html', 'Laporan Head-to-Head', 'compare')}
    </div>
    <div class="header">
      <h1>${heading}</h1>
      <p>${subtitle}</p>
      ${endpoints}
    </div>
    ${body}
    <div class="footer">Generated on ${new Date().toLocaleString('id-ID')} &bull; K6 LLM Stress Test Framework</div>
  </div>
</body>
</html>`;
}

function conclusionCard(bullets, verdict) {
  return `
    <div class="card conclusion">
      <div class="card-title">Kesimpulan</div>
      <ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
      <div class="verdict"><strong>Rekomendasi:</strong> ${verdict}</div>
    </div>`;
}

// ---------- Analisis untuk kesimpulan ----------
function maxPassedContext(results, thinking) {
  let best = null;
  for (const sc of SCENARIOS) {
    const x = results[sc.id];
    if (sc.thinking === thinking && x && x.status === 'PASSED') best = sc.context;
  }
  return best;
}

function totals(results) {
  const t = { run: 0, passed: 0, failed: 0, retries: 0, oom: 0, timeout: 0, noresp: 0, r429: 0, c4xx: 0, requests: 0, failedReq: 0, minSafeVU: 1000 };
  for (const sc of SCENARIOS) {
    const x = results[sc.id];
    if (!x) continue;
    t.run++;
    x.status === 'PASSED' ? t.passed++ : t.failed++;
    t.retries += x.retries;
    t.oom += x.failOom;
    t.timeout += x.failTimeout;
    t.noresp += x.failNoResp;
    t.r429 += x.fail429;
    t.c4xx += x.fail4xx;
    t.requests += x.requests;
    t.failedReq += x.fails;
    if (typeof x.maxSafeVU === 'number' && x.maxSafeVU < t.minSafeVU) {
      t.minSafeVU = x.maxSafeVU;
    }
  }
  return t;
}

function firstFailure(results, thinking) {
  for (const sc of SCENARIOS) {
    const x = results[sc.id];
    if (sc.thinking === thinking && x && x.status === 'FAILED') return sc.context;
  }
  return null;
}

function serverConclusion(server, results) {
  const t = totals(results);
  if (t.run === 0) {
    return conclusionCard(['Belum ada data pengujian untuk server ini.'], 'Jalankan skenario terlebih dahulu.');
  }
  const bullets = [];
  bullets.push(`Dari <strong>${t.run}</strong> skenario yang dijalankan (maks ${SCENARIOS.length}), <strong class="text-success">${t.passed} PASSED</strong> dan <strong class="text-danger">${t.failed} FAILED</strong> (batas lulus: success rate final ≥ ${PASS_THRESHOLD}% setelah maksimal 3x retry).`);

  bullets.push(`<strong>Batas Daya Tahan GPU (Kekuatan Beban VU):</strong> ${server.label} kuat menampung beban tanpa error hingga <strong>${t.minSafeVU} VU</strong> pada skenario terberat. Di atas batas tersebut mulai terjadi antrean / timeout / pemutusan koneksi.`);

  for (const thinking of [true, false]) {
    const best = maxPassedContext(results, thinking);
    const fail = firstFailure(results, thinking);
    const label = thinking ? 'Thinking ON' : 'Thinking OFF';
    bullets.push(
      `${label}: konteks terbesar yang lulus <strong>${best || 'tidak ada'}</strong>` +
        (fail ? `; kegagalan pertama muncul di konteks <strong>${fail}</strong>.` : '; tidak ada kegagalan.')
    );
  }

  const withTps = SCENARIOS.map((s) => results[s.id]).filter((x) => x && x.tpsAvg);
  if (withTps.length) {
    const avgTps = withTps.reduce((s, x) => s + x.tpsAvg, 0) / withTps.length;
    const avgTtft = withTps.filter((x) => x.ttftAvg).reduce((s, x, _, a) => s + x.ttftAvg / a.length, 0);
    bullets.push(`Rata-rata kecepatan generasi <strong>${fmt(avgTps, 1)} tokens/detik</strong> per stream dengan TTFT rata-rata <strong>${fmtSec(avgTtft)}</strong> pada skenario yang berhasil.`);
  }

  bullets.push(
    `Kegagalan (per percobaan): OOM/5xx <strong>${t.oom}</strong>, timeout streaming <strong>${t.timeout}</strong>, tanpa respons <strong>${t.noresp}</strong>, 429 <strong>${t.r429}</strong>, 4xx lain <strong>${t.c4xx}</strong>. Total retry dilakukan: <strong>${t.retries}</strong>; request yang tetap gagal setelah retry: <strong>${t.failedReq}</strong> dari ${fmtInt(t.requests)}.`
  );
  if (t.c4xx > 0) bullets.push('Terdapat error 4xx (tidak di-retry) — kemungkinan konteks + output melebihi batas <code>max-model-len</code> server.');

  const verdict =
    t.failed === 0
      ? `${server.label} stabil untuk seluruh skenario yang diuji pada beban hingga 1000 VU.`
      : `${server.label} belum stabil pada ${t.failed} skenario; batasi konteks/konkurensi sesuai batas aman ${t.minSafeVU} VU di atas atau tambah kapasitas.`;
  return conclusionCard(bullets, verdict);
}

function compareConclusion(rp, dg) {
  const tr = totals(rp);
  const td = totals(dg);
  if (tr.run === 0 && td.run === 0) return conclusionCard(['Belum ada data pengujian.'], 'Jalankan skenario terlebih dahulu.');

  const bullets = [];
  bullets.push(`Runpod: <strong class="text-success">${tr.passed} PASSED</strong> / <strong class="text-danger">${tr.failed} FAILED</strong> dari ${tr.run} skenario. DGX: <strong class="text-success">${td.passed} PASSED</strong> / <strong class="text-danger">${td.failed} FAILED</strong> dari ${td.run} skenario.`);

  bullets.push(`<strong>Batas Daya Tahan GPU (Kekuatan Beban VU):</strong> Runpod kuat menahan beban hingga <strong>${tr.minSafeVU} VU</strong>, sedangkan DGX kuat menahan hingga <strong>${td.minSafeVU} VU</strong> sebelum error/koneksi putus pertama kali terjadi.`);

  for (const thinking of [true, false]) {
    const label = thinking ? 'Thinking ON' : 'Thinking OFF';
    bullets.push(`${label} — konteks terbesar yang lulus: Runpod <strong>${maxPassedContext(rp, thinking) || 'tidak ada'}</strong>, DGX <strong>${maxPassedContext(dg, thinking) || 'tidak ada'}</strong>.`);
  }

  // Head-to-head pada skenario yang berhasil di kedua server
  const both = SCENARIOS.filter((s) => rp[s.id] && dg[s.id] && rp[s.id].tpsAvg && dg[s.id].tpsAvg);
  if (both.length) {
    const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
    const rTps = avg(both, (s) => rp[s.id].tpsAvg);
    const dTps = avg(both, (s) => dg[s.id].tpsAvg);
    const rTtft = avg(both.filter((s) => rp[s.id].ttftAvg && dg[s.id].ttftAvg), (s) => rp[s.id].ttftAvg);
    const dTtft = avg(both.filter((s) => rp[s.id].ttftAvg && dg[s.id].ttftAvg), (s) => dg[s.id].ttftAvg);
    const tpsWin = dTps > rTps ? 'DGX' : 'Runpod';
    const ttftWin = dTtft < rTtft ? 'DGX' : 'Runpod';
    bullets.push(`Pada ${both.length} skenario yang berhasil di kedua server: TPS rata-rata Runpod <strong>${fmt(rTps, 1)}</strong> vs DGX <strong>${fmt(dTps, 1)}</strong> (lebih cepat: <strong>${tpsWin}</strong>); TTFT rata-rata Runpod <strong>${fmtSec(rTtft)}</strong> vs DGX <strong>${fmtSec(dTtft)}</strong> (lebih rendah: <strong>${ttftWin}</strong>).`);
  } else {
    bullets.push('Tidak ada skenario yang berhasil di kedua server, sehingga perbandingan TPS/TTFT belum dapat dibuat.');
  }

  bullets.push(`Penyebab kegagalan — Runpod: OOM/5xx ${tr.oom}, timeout ${tr.timeout}, tanpa respons ${tr.noresp}, 429 ${tr.r429}, 4xx ${tr.c4xx}, retry ${tr.retries}. DGX: OOM/5xx ${td.oom}, timeout ${td.timeout}, tanpa respons ${td.noresp}, 429 ${td.r429}, 4xx ${td.c4xx}, retry ${td.retries}.`);

  let verdict;
  if (td.run && tr.run) {
    if (td.passed > tr.passed) verdict = `DGX lebih layak untuk beban produksi (lulus ${td.passed} vs ${tr.passed} skenario). Runpod hanya cocok untuk konteks/konkurensi yang lebih rendah sesuai batas lulus di atas.`;
    else if (tr.passed > td.passed) verdict = `Runpod lulus lebih banyak skenario (${tr.passed} vs ${td.passed}); periksa konfigurasi DGX (batas memori/antrean) sebelum dijadikan acuan.`;
    else verdict = `Kedua server lulus jumlah skenario yang sama (${tr.passed}); pilih berdasarkan TPS/TTFT dan biaya.`;
  } else {
    verdict = 'Data salah satu server belum lengkap; jalankan seluruh skenario di kedua server untuk kesimpulan akhir.';
  }
  return conclusionCard(bullets, verdict);
}

// ---------- Laporan per skenario (raw) ----------
function trendRow(label, metric, unit, scale = 1) {
  if (!metric || !metric.values) return '';
  const g = (k) => (metric.values[k] === undefined ? '-' : fmt(metric.values[k] / scale, 2));
  return `<tr><td>${label}</td><td>${g('avg')}</td><td>${g('min')}</td><td>${g('med')}</td><td>${g('p(90)')}</td><td>${g('p(95)')}</td><td>${g('max')}</td><td class="text-muted">${unit}</td></tr>`;
}

function scenarioReport(sc, profile, x) {
  const server = SERVERS[profile];
  const m = x.raw;
  const body = `
    <div class="card">
      <div class="card-title">Ringkasan</div>
      <div class="stats">
        <div class="stat"><div class="label">Status</div><div class="value">${statusBadge(x)}</div></div>
        <div class="stat"><div class="label">Batas Kuat GPU</div><div class="value" style="color:#fbbf24;">${typeof x.maxSafeVU === 'number' ? x.maxSafeVU + ' VU' : '-'}</div><div class="text-muted small">${x.breakingPointText}</div></div>
        <div class="stat"><div class="label">Success rate (final)</div><div class="value ${x.status === 'PASSED' ? 'text-success' : 'text-danger'}">${fmt(x.successRate, 1)}%</div></div>
        <div class="stat"><div class="label">Total request</div><div class="value">${fmtInt(x.requests)}</div></div>
        <div class="stat"><div class="label">Request gagal (setelah 3x retry)</div><div class="value">${fmtInt(x.fails)}</div></div>
        <div class="stat"><div class="label">Total retry</div><div class="value">${fmtInt(x.retries)}</div></div>
        <div class="stat"><div class="label">VU maksimum</div><div class="value">${x.maxVUs}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Latensi &amp; Kecepatan</div>
      <table>
        <thead><tr><th>Metrik</th><th>avg</th><th>min</th><th>med</th><th>p(90)</th><th>p(95)</th><th>max</th><th>Satuan</th></tr></thead>
        <tbody>
          ${trendRow('Time-To-First-Token (TTFT)', m.llm_ttft_ms, 's', 1000)}
          ${trendRow('Tokens per detik (per stream)', m.llm_tokens_per_second, 'tps')}
          ${trendRow('Durasi E2E', m.llm_e2e_duration_ms, 's', 1000)}
          ${trendRow('HTTP request duration', m.http_req_duration, 's', 1000)}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">Kegagalan &amp; Retry</div>
      <table>
        <thead><tr><th>Penyebab (per percobaan)</th><th>Jumlah</th><th>Keterangan</th></tr></thead>
        <tbody>
          <tr><td>OOM / HTTP 5xx</td><td>${x.failOom}</td><td class="text-muted small">Di-retry hingga 3x</td></tr>
          <tr><td>Timeout saat streaming / request timeout</td><td>${x.failTimeout}</td><td class="text-muted small">Di-retry hingga 3x</td></tr>
          <tr><td>Tanpa respons / koneksi terputus</td><td>${x.failNoResp}</td><td class="text-muted small">Di-retry hingga 3x</td></tr>
          <tr><td>HTTP 429</td><td>${x.fail429}</td><td class="text-muted small">Di-retry hingga 3x</td></tr>
          <tr><td>HTTP 4xx lain</td><td>${x.fail4xx}</td><td class="text-muted small">Tidak di-retry (mis. konteks melebihi batas)</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">Token</div>
      <div class="stats">
        <div class="stat"><div class="label">Prompt tokens</div><div class="value">${fmtInt(x.promptTokens)}</div></div>
        <div class="stat"><div class="label">Completion tokens</div><div class="value">${fmtInt(x.completionTokens)}</div></div>
        <div class="stat"><div class="label">Total tokens</div><div class="value">${fmtInt(x.totalTokens)}</div></div>
      </div>
    </div>`;

  const bullets = [];
  if (x.status === 'PASSED') {
    bullets.push(`Skenario <strong class="text-success">PASSED</strong>: success rate ${fmt(x.successRate, 1)}% dari ${fmtInt(x.requests)} request, TPS rata-rata ${fmt(x.tpsAvg, 1)}, TTFT rata-rata ${fmtSec(x.ttftAvg)}.`);
  } else {
    bullets.push(`Skenario <strong class="text-danger">FAILED</strong>: success rate ${fmt(x.successRate, 1)}% (di bawah ${PASS_THRESHOLD}%); ${fmtInt(x.fails)} request tetap gagal setelah retry.`);
  }
  bullets.push(`Penyebab kegagalan: ${causeText(x)}. Total retry: ${x.retries}.`);
  if (x.fail4xx > 0) bullets.push('Ada error 4xx — periksa batas <code>max-model-len</code> server terhadap ukuran prompt + output.');
  const verdict =
    x.status === 'PASSED'
      ? `${server.label} mampu menangani ${sc.name} pada beban hingga ${x.maxVUs} VU.`
      : `${server.label} tidak mampu menangani ${sc.name} pada beban hingga ${x.maxVUs} VU; turunkan konkurensi atau konteks.`;

  return page({
    title: `${sc.name} — ${server.label}`,
    heading: sc.name,
    subtitle: `${server.title} &bull; Model <strong>${modelName}</strong>`,
    active: `raw-${profile}`,
    body: body + conclusionCard(bullets, verdict),
  });
}

// ---------- Laporan per server ----------
function serverReport(profile, results) {
  const server = SERVERS[profile];
  let rows = '';
  for (const sc of SCENARIOS) {
    const x = results[sc.id];
    const link = x ? `<a class="text-muted small" href="raw/${sc.id}_${profile}_report.html">detail</a>` : '';
    rows += `
        <tr>
          <td><strong>${sc.name}</strong><div class="text-muted small">Thinking: ${sc.thinking ? 'ON' : 'OFF'} | Context: ${sc.context} ${link}</div></td>
          <td>${statusBadge(x)}</td>
          ${
            x
              ? `<td>${maxSafeBadge(x)}</td>
          <td>${fmt(x.successRate, 1)}%</td>
          <td>${fmtSec(x.ttftAvg)} <span class="text-muted small">(p90: ${fmtSec(x.ttftP90)})</span></td>
          <td><strong>${fmt(x.tpsAvg, 1)}</strong> <span class="text-muted small">tps (peak: ${fmt(x.tpsMax, 1)})</span></td>
          <td>${x.retries}</td>
          <td class="small">${causeText(x)}</td>
          <td>${x.maxVUs} VUs</td>`
              : '<td colspan="7" class="text-muted">Belum diuji</td>'
          }
        </tr>`;
  }
  const body = `
    <div class="card">
      <div class="card-title">Hasil Pengujian Beban (K6) — Ramping s/d 1000 VU (20 Menit)</div>
      <table>
        <thead><tr><th>Skenario Uji</th><th>Status</th><th>Batas Kuat GPU</th><th>Success</th><th>TTFT</th><th>TPS</th><th>Retry</th><th>Penyebab Gagal</th><th>Beban</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${serverConclusion(server, results)}`;

  return page({
    title: `Laporan ${server.label}`,
    heading: `Laporan Pengujian: ${server.title}`,
    subtitle: `Benchmark Kapasitas Inferensi Model <strong>${modelName}</strong>`,
    active: profile,
    endpoints: `<div class="endpoints-container"><div class="endpoint-card"><strong>URL:</strong> <code>${server.url}</code></div></div>`,
    body,
  });
}

// ---------- Laporan head-to-head ----------
function compareReport(rp, dg) {
  let rows = '';
  const cell = (x, border = false) => {
    const b = border ? ' style="border-left: 2px solid #334155;"' : '';
    if (!x) return `<td${b}>${statusBadge(x)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>`;
    return `<td${b}>${statusBadge(x)}</td><td>${maxSafeBadge(x)}</td><td>${fmt(x.tpsAvg, 1)}</td><td>${fmtSec(x.ttftAvg)}</td><td>${fmt(x.successRate, 1)}%</td><td>${x.retries}</td>`;
  };
  for (const sc of SCENARIOS) {
    rows += `
        <tr>
          <td><strong>${sc.name}</strong><div class="text-muted small">Thinking: ${sc.thinking ? 'ON' : 'OFF'} | Context: ${sc.context}</div></td>
          ${cell(rp[sc.id])}
          ${cell(dg[sc.id], true)}
        </tr>`;
  }
  const body = `
    <div class="card">
      <div class="card-title">1. Matriks Hasil Pengujian Beban (K6) — Profil Beban Sama, Ramping s/d 1000 VU (20 Menit)</div>
      <table>
        <thead>
          <tr>
            <th rowspan="2">Skenario Uji</th>
            <th colspan="6" style="text-align:center; background: rgba(245,158,11,0.15); color:#fbbf24;">RUNPOD (RTX A6000 Ada - 48GB GDDR6)</th>
            <th colspan="6" style="text-align:center; background: rgba(59,130,246,0.15); color:#60a5fa; border-left: 2px solid #334155;">SERVER DGX (High-VRAM HBM)</th>
          </tr>
          <tr>
            <th>Status</th><th>Batas Kuat GPU</th><th>TPS</th><th>TTFT</th><th>Success</th><th>Retry</th>
            <th style="border-left: 2px solid #334155;">Status</th><th>Batas Kuat GPU</th><th>TPS</th><th>TTFT</th><th>Success</th><th>Retry</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="text-muted small" style="margin-top:12px;">Request OOM/overload/timeout/koneksi (5xx, 429, timeout, tanpa respons) di-retry hingga 3x; jika tetap gagal dinyatakan FAILED. Skenario PASSED bila success rate final ≥ ${PASS_THRESHOLD}%.</div>
    </div>

    <div class="card">
      <div class="card-title">2. Target Spesifikasi Benchmark PM (Referensi Evaluasi)</div>
      <table>
        <thead><tr><th>Metrik Evaluasi</th><th style="color:#fbbf24;">Target Runpod (A6000 Ada)</th><th style="color:#60a5fa;">Target Server DGX</th><th>Cara Pengukuran K6</th></tr></thead>
        <tbody>
          <tr><td><strong>VRAM Footprint &amp; KV-Cache</strong></td><td>48 GB GDDR6 (~20–24 GB KV-Cache)</td><td>High VRAM HBM (~70–105 GB KV-Cache)</td><td>Pantau titik lonjakan OOM saat multi-user</td></tr>
          <tr><td><strong>Peak Generation Speed</strong></td><td>~30 – 45 tokens/detik (Single User)</td><td>~150 – 170+ tokens/detik</td><td><code>llm_tokens_per_second</code></td></tr>
          <tr><td><strong>Time-to-First-Token (TTFT)</strong></td><td>Latensi tinggi (&gt;3.5s pada long context)</td><td>Ultra-low latency (&lt;0.8s – 1.2s)</td><td><code>llm_ttft_ms</code></td></tr>
          <tr><td><strong>Max Concurrent Users</strong></td><td>~4 – 8 loops (rentan OOM)</td><td>72+ concurrent agentic loops</td><td>Ramping VUs 1 → 100, rincian <code>llm_fail_*</code></td></tr>
          <tr><td><strong>Max Context Window</strong></td><td>Hingga 64K</td><td>Hingga 64K</td><td>Payload <code>data/context_{1k..64k}.json</code></td></tr>
        </tbody>
      </table>
    </div>
    ${compareConclusion(rp, dg)}`;

  return page({
    title: 'Benchmark Head-to-Head: Server DGX vs Runpod (A6000)',
    heading: 'Hasil Evaluasi Head-to-Head: Server DGX vs Runpod (RTX A6000 Ada)',
    subtitle: `Benchmark Kapasitas Inferensi &amp; Batas KV-Cache Model <strong>${modelName}</strong> (konteks ${CONTEXTS.join(', ')})`,
    active: 'compare',
    endpoints: `<div class="endpoints-container">
        <div class="endpoint-card"><strong style="color:#fbbf24;">Runpod URL:</strong> <code>${runpodUrl}</code></div>
        <div class="endpoint-card"><strong style="color:#60a5fa;">DGX URL:</strong> <code>${dgxUrl}</code></div>
      </div>`,
    body,
  });
}

// ---------- Eksekusi ----------
const data = { runpod: loadAll('runpod'), dgx: loadAll('dgx') };

for (const profile of ['runpod', 'dgx']) {
  for (const sc of SCENARIOS) {
    const x = data[profile][sc.id];
    if (!x) continue;
    fs.writeFileSync(path.join(rawDir, `${sc.id}_${profile}_report.html`), scenarioReport(sc, profile, x), 'utf8');
  }
  const out = path.join(reportsDir, `report_${profile}.html`);
  fs.writeFileSync(out, serverReport(profile, data[profile]), 'utf8');
  console.log(`[OK] Laporan server berhasil dibuat: ${out}`);
}

const compPath = path.join(reportsDir, 'report_comparison_dgx_vs_runpod.html');
fs.writeFileSync(compPath, compareReport(data.runpod, data.dgx), 'utf8');
console.log(`[OK] Laporan perbandingan Head-to-Head berhasil dibuat: ${compPath}`);
