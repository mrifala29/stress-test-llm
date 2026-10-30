import { Trend, Counter, Rate } from 'k6/metrics';

/**
 * Custom K6 Metrics untuk Benchmarking LLM & Kapasitas GPU
 * Didesain selaras dengan tabel spesifikasi PM:
 * - Time-To-First-Token (TTFT)
 * - Peak & Sustained Generation Speed (Tokens/sec per stream)
 * - Throughput & Token Counter
 * - Out-Of-Memory (OOM) Failure Rate
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

  // Rate error kegagalan server / OOM / timeout (HTTP 500, 502, 503, 504, 429, atau 0)
  oomFailures: new Rate('llm_oom_failures'),

  // Rate keberhasilan request (HTTP 200)
  successfulRequests: new Rate('llm_success_rate'),
};

/**
 * Helper untuk mencatat metrik request non-streaming / streaming
 */
export function recordMetrics({ status, ttftMs, e2eDurationMs, completionTokens, promptTokens }) {
  const isSuccess = status === 200;
  METRICS.successfulRequests.add(isSuccess);

  // Jika status 5xx, 429, atau 0 (timeout / connection aborted karena overload), tandai sebagai failure
  if (status >= 500 || status === 429 || status === 0) {
    METRICS.oomFailures.add(1);
  } else {
    METRICS.oomFailures.add(0);
  }

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
