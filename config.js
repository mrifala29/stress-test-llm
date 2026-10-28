/**
 * Konfigurasi Utama K6 LLM Stress Testing Suite
 * Benchmark: DGX vs Runpod (A6000 Ada)
 */

export const CONFIG = {
  // LLM Endpoint & Kredensial (Bisa di-override lewat -e LLM_BASE_URL=...)
  BASE_URL: __ENV.LLM_BASE_URL || 'https://llm.linkit360.ai/v1/chat/completions',
  API_KEY: __ENV.LLM_API_KEY || '',
  MODEL: __ENV.LLM_MODEL || 'Qwen3.6-35B-A3B',

  // Parameter Inferensi
  TEMPERATURE: __ENV.TEMPERATURE ? parseFloat(__ENV.TEMPERATURE) : 0.7,
  MAX_TOKENS: __ENV.MAX_TOKENS ? parseInt(__ENV.MAX_TOKENS) : 4096,
  
  // Streaming diaktifkan agar K6 bisa menghitung Time-To-First-Token (TTFT)
  STREAM: __ENV.STREAM === 'false' ? false : true,

  // Timeout request (180s untuk long context 128k)
  TIMEOUT_MS: __ENV.TIMEOUT_MS ? parseInt(__ENV.TIMEOUT_MS) : 180000,

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

  // 2. Profil Runpod - RTX A6000 Ada (48GB VRAM, batas ~4-8 concurrent users)
  runpod: {
    stages: [
      { duration: '1m', target: 1 },  // Baseline single user
      { duration: '2m', target: 4 },  // Beban normal
      { duration: '3m', target: 8 },  // Batas saturasi
      { duration: '2m', target: 12 }, // Overload untuk cek titik OOM / HTTP 500
      { duration: '1m', target: 0 },  // Cooldown
    ],
  },

  // 3. Profil DGX (High-Memory Architecture, target 72+ concurrent users)
  dgx: {
    stages: [
      { duration: '1m', target: 5 },   // Warmup
      { duration: '2m', target: 20 },  // Mid load
      { duration: '3m', target: 50 },  // Heavy batching
      { duration: '3m', target: 75 },  // Target 72+ concurrent loops
      { duration: '2m', target: 90 },  // Peak capacity limit
      { duration: '1m', target: 0 },   // Cooldown
    ],
  },
};

// Aliases agar tetap fleksibel jika memakai nama lama
LOAD_PROFILES.a6000 = LOAD_PROFILES.runpod;
LOAD_PROFILES.h200 = LOAD_PROFILES.dgx;

export function getSelectedProfile() {
  const profileName = (__ENV.PROFILE || 'smoke').toLowerCase();
  if (LOAD_PROFILES[profileName]) {
    return LOAD_PROFILES[profileName];
  }
  console.warn(`[WARN] Profile '${profileName}' tidak ditemukan, default ke 'smoke'`);
  return LOAD_PROFILES.smoke;
}
