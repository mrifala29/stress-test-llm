import { Trend, Counter, Rate } from 'k6/metrics';

/**
 * Custom K6 Metrics untuk Benchmarking LLM & Kapasitas GPU
 * Didesain selaras dengan tabel spesifikasi PM:
 * - Time-To-First-Token (TTFT)
 * - Peak & Sustained Generation Speed (Tokens/sec per stream)
 * - Throughput & Token Counter
 * - Retry & rincian penyebab kegagalan (OOM/timeout/429/4xx)
 */
export const METRICS = {
  // Latensi waktu hingga token pertama diterima (Time to First Token) dalam ms
  ttft: new Trend('llm_ttft_ms', true),

  // Kecepatan pembuatan token (Tokens per second / TPS per stream) - bukan waktu (isTime = false)
  tokensPerSecond: new Trend('llm_tokens_per_second', false),

  // Total durasi siklus inferensi dari kirim request sampai token selesai (ms)
  e2eDuration: new Trend('llm_e2e_duration_ms', true),

  // Total tokens yang diproduksi model
  completionTokens: new Counter('llm_completion_tokens'),

  // Total tokens prompt yang dikirim
  promptTokens: new Counter('llm_prompt_tokens'),

  // Total akumulasi tokens (prompt + completion)
  totalTokens: new Counter('llm_total_tokens'),

  // Rate keberhasilan FINAL per request (setelah retry). false = dinyatakan FAILED.
  successfulRequests: new Rate('llm_success_rate'),

  // Jumlah percobaan ulang (retry) yang dilakukan
  retries: new Counter('llm_retries'),

  // Rincian penyebab kegagalan per percobaan (attempt)
  failOom: new Counter('llm_fail_oom_5xx'),      // HTTP 5xx (OOM / server error)
  failTimeout: new Counter('llm_fail_timeout'),  // timeout saat respons sudah mulai mengalir (server lambat/antre)
  failNoResp: new Counter('llm_fail_noresp'),    // status 0 tanpa respons sama sekali (koneksi ditolak/terputus)
  failRateLimit: new Counter('llm_fail_429'),    // HTTP 429 (overload / antrean penuh)
  failClient: new Counter('llm_fail_4xx'),       // HTTP 4xx lain (mis. konteks melebihi batas) - tidak di-retry

  // Titik error pertama: estimasi active VU saat kegagalan/retry terjadi (Breaking Point VU)
  firstErrorVU: new Trend('llm_first_error_vu', false),
};

/**
 * Estimasi jumlah VU yang sedang aktif berdasarkan durasi berjalan (timeline ramping)
 */
export function getEstimatedActiveVUs(elapsedSec, profile = 'standard') {
  if (profile === 'smoke' || profile === 'smoke_dgx' || profile === 'smoke_runpod') {
    if (elapsedSec < 30) return 1;
    if (elapsedSec < 60) return 2;
    return 1;
  }
  // Profil beban standard (1 -> 100 VU):
  // 0s - 60s: 1 VU
  // 60s - 180s: ramp 1 -> 10 VU
  // 180s - 300s: ramp 10 -> 25 VU
  // 300s - 420s: ramp 25 -> 50 VU
  // 420s - 540s: ramp 50 -> 75 VU
  // 540s - 660s: ramp 75 -> 100 VU
  // 660s - 720s: cooldown 100 -> 0 VU
  if (elapsedSec < 60) return 1;
  if (elapsedSec < 180) return Math.round(1 + ((elapsedSec - 60) / 120) * 9);
  if (elapsedSec < 300) return Math.round(10 + ((elapsedSec - 180) / 120) * 15);
  if (elapsedSec < 420) return Math.round(25 + ((elapsedSec - 300) / 120) * 25);
  if (elapsedSec < 540) return Math.round(50 + ((elapsedSec - 420) / 120) * 25);
  if (elapsedSec < 660) return Math.round(75 + ((elapsedSec - 540) / 120) * 25);
  return 100;
}

/**
 * Klasifikasi: 'ok' | 'oom' | 'timeout' | 'noresp' | 'ratelimit' | 'client'
 * Status 0 dengan body parsial = timeout saat streaming.
 */
export function classifyStatus(status, body) {
  if (status === 200) return 'ok';
  if (status === 0) return body && body.length > 0 ? 'timeout' : 'noresp';
  if (status === 429) return 'ratelimit';
  if (status >= 500) return 'oom';
  return 'client';
}

/** Error server/overload/timeout/koneksi di-retry hingga 3x sesuai instruksi lead dev.
 *  Hanya error client 4xx (misal parameter salah) yang tidak di-retry. */
export function isRetryable(status, body) {
  const c = classifyStatus(status, body);
  return c === 'oom' || c === 'noresp' || c === 'ratelimit' || c === 'timeout';
}

/** Catat satu percobaan yang gagal beserta estimasi VU saat kejadian */
export function recordFailedAttempt(status, body, activeVU = 1) {
  const c = classifyStatus(status, body);
  if (c === 'oom') METRICS.failOom.add(1);
  else if (c === 'timeout') METRICS.failTimeout.add(1);
  else if (c === 'noresp') METRICS.failNoResp.add(1);
  else if (c === 'ratelimit') METRICS.failRateLimit.add(1);
  else if (c === 'client') METRICS.failClient.add(1);

  if (activeVU > 0) {
    METRICS.firstErrorVU.add(activeVU);
  }
}

/**
 * Catat hasil final satu request (setelah retry).
 * Metrik performa hanya dicatat jika berhasil.
 */
export function recordMetrics({ status, ttftMs, e2eDurationMs, completionTokens, promptTokens }) {
  const isSuccess = status === 200;
  METRICS.successfulRequests.add(isSuccess);

  if (isSuccess) {
    if (ttftMs !== undefined && ttftMs !== null && ttftMs > 0) {
      METRICS.ttft.add(ttftMs);
    }

    if (e2eDurationMs > 0) {
      METRICS.e2eDuration.add(e2eDurationMs);
    }

    if (completionTokens > 0) {
      METRICS.completionTokens.add(completionTokens);
      
      // Hitung tokens per second untuk fase decode
      // Decode duration = total durasi - TTFT (jika streaming) atau total durasi
      const decodeDurationSec = (ttftMs && e2eDurationMs > ttftMs) 
        ? (e2eDurationMs - ttftMs) / 1000 
        : e2eDurationMs / 1000;

      if (decodeDurationSec > 0) {
        const tps = completionTokens / decodeDurationSec;
        METRICS.tokensPerSecond.add(tps);
      }
    }

    if (promptTokens > 0) {
      METRICS.promptTokens.add(promptTokens);
    }

    if ((promptTokens || 0) + (completionTokens || 0) > 0) {
      METRICS.totalTokens.add((promptTokens || 0) + (completionTokens || 0));
    }
  }
}
