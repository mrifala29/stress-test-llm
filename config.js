/**
 * Konfigurasi Utama K6 LLM Stress Testing Suite
 * Benchmark: DGX vs Runpod (A6000 Ada) - konteks 1k s/d 64k
 */

function resolveBaseUrl() {
  const profile = (__ENV.PROFILE || 'smoke').toLowerCase();
  if (profile === 'runpod' || profile === 'a6000' || profile === 'smoke_runpod') {
    return __ENV.LLM_RUNPOD_URL || __ENV.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions';
  }
  if (profile === 'dgx' || profile === 'h200' || profile === 'smoke_dgx') {
    return __ENV.LLM_DGX_URL || __ENV.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions';
  }
  // Default untuk smoke test umum: pakai DGX jika ada, lalu Runpod, lalu fallback
  return __ENV.LLM_DGX_URL || __ENV.LLM_RUNPOD_URL || __ENV.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions';
}

function resolveApiKey() {
  const profile = (__ENV.PROFILE || 'smoke').toLowerCase();
  if (profile === 'runpod' || profile === 'a6000' || profile === 'smoke_runpod') {
    return __ENV.LLM_RUNPOD_API_KEY || __ENV.LLM_API_KEY || '';
  }
  if (profile === 'dgx' || profile === 'h200' || profile === 'smoke_dgx') {
    return __ENV.LLM_DGX_API_KEY || __ENV.LLM_API_KEY || '';
  }
  return __ENV.LLM_DGX_API_KEY || __ENV.LLM_RUNPOD_API_KEY || __ENV.LLM_API_KEY || '';
}

// Ukuran konteks yang didukung (maksimum 64k)
export const SHORT_CONTEXTS = ['1k', '2k', '4k', '16k'];
export const LONG_CONTEXTS = ['32k', '64k'];

function timeoutForContext(ctx) {
  const map = { '1k': 120000, '2k': 120000, '4k': 120000, '16k': 180000, '32k': 300000, '64k': 600000 };
  return map[ctx] || 300000;
}

export const CONFIG = {
  // LLM Endpoint & Kredensial (Bisa per-profile atau via LLM_BASE_URL)
  get BASE_URL() {
    return resolveBaseUrl();
  },
  get API_KEY() {
    return resolveApiKey();
  },
  MODEL: __ENV.LLM_MODEL || 'Qwen3.6-35B-A3B',

  // Parameter Inferensi
  TEMPERATURE: __ENV.TEMPERATURE ? parseFloat(__ENV.TEMPERATURE) : 0.7,
  MAX_TOKENS: __ENV.MAX_TOKENS ? parseInt(__ENV.MAX_TOKENS) : 4096,
  
  // Streaming diaktifkan agar K6 bisa menghitung Time-To-First-Token (TTFT)
  STREAM: __ENV.STREAM === 'false' ? false : true,

  // Timeout request per ukuran konteks (bisa dioverride via TIMEOUT_MS)
  TIMEOUT_MS: __ENV.TIMEOUT_MS ? parseInt(__ENV.TIMEOUT_MS) : timeoutForContext(__ENV.CONTEXT || '1k'),

  // Retry untuk error OOM/overload (5xx, 429, timeout). Setelah itu dinyatakan FAILED.
  MAX_RETRIES: __ENV.MAX_RETRIES ? parseInt(__ENV.MAX_RETRIES) : 3,

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.API_KEY}`,
      'Accept': this.STREAM ? 'text/event-stream' : 'application/json',
    };
  }
};

/**
 * Profil Beban Pengujian (Load Stages)
 * Pilih lewat: k6 run -e PROFILE=runpod atau -e PROFILE=dgx
 */
export const LOAD_PROFILES = {
  // 1. Smoke Test (Sanity check cepat 1 VU)
  smoke: {
    stages: [
      { duration: '30s', target: 1 },
      { duration: '30s', target: 2 },
      { duration: '15s', target: 0 },
    ],
  },

  // 2. Profil beban standar - dipakai SAMA untuk Runpod dan DGX (hingga 100 VU)
  //    agar perbandingan head-to-head setara.
  standard: {
    stages: [
      { duration: '1m', target: 1 },    // Baseline single user
      { duration: '2m', target: 10 },
      { duration: '2m', target: 25 },
      { duration: '2m', target: 50 },
      { duration: '2m', target: 75 },
      { duration: '2m', target: 100 },  // Peak
      { duration: '1m', target: 0 },    // Cooldown
    ],
  },
};

LOAD_PROFILES.runpod = LOAD_PROFILES.standard;
LOAD_PROFILES.dgx = LOAD_PROFILES.standard;
// Aliases agar tetap fleksibel jika memakai nama lama
LOAD_PROFILES.a6000 = LOAD_PROFILES.standard;
LOAD_PROFILES.h200 = LOAD_PROFILES.standard;

export function getSelectedProfile() {
  const profileName = (__ENV.PROFILE || 'smoke').toLowerCase();
  if (LOAD_PROFILES[profileName]) {
    return LOAD_PROFILES[profileName];
  }
  console.warn(`[WARN] Profile '${profileName}' tidak ditemukan, default ke 'smoke'`);
  return LOAD_PROFILES.smoke;
}
