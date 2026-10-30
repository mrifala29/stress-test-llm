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
  failTimeout: new Counter('llm_fail_timeout'),  // status 0 (timeout / koneksi terputus)
  failRateLimit: new Counter('llm_fail_429'),    // HTTP 429 (overload / antrean penuh)
  failClient: new Counter('llm_fail_4xx'),       // HTTP 4xx lain (mis. konteks melebihi batas) - tidak di-retry
};

/** Klasifikasi status HTTP: 'ok' | 'oom' | 'timeout' | 'ratelimit' | 'client' */
export function classifyStatus(status) {
  if (status === 200) return 'ok';
  if (status === 0) return 'timeout';
  if (status === 429) return 'ratelimit';
  if (status >= 500) return 'oom';
  return 'client';
}

/** Hanya OOM/overload yang di-retry */
export function isRetryable(status) {
  const c = classifyStatus(status);
  return c === 'oom' || c === 'timeout' || c === 'ratelimit';
}

/** Catat satu percobaan yang gagal */
export function recordFailedAttempt(status) {
  const c = classifyStatus(status);
  if (c === 'oom') METRICS.failOom.add(1);
  else if (c === 'timeout') METRICS.failTimeout.add(1);
  else if (c === 'ratelimit') METRICS.failRateLimit.add(1);
  else if (c === 'client') METRICS.failClient.add(1);
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
