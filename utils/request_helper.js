import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG } from '../config.js';
import { METRICS, recordMetrics, recordFailedAttempt, isRetryable, classifyStatus } from './metrics.js';

/**
 * Eksekusi pengujian HTTP LLM ke /v1/chat/completions
 * 
 * @param {Object} options
 * @param {Array} options.messages - Array pesan [{ role, content }]
 * @param {boolean} options.enableThinking - Parameter chat_template_kwargs.enable_thinking
 * @param {string} options.scenarioName - Nama skenario untuk logging
 */
export function executeLLMRequest({ messages, enableThinking, scenarioName = 'llm_test' }) {
  const isStreaming = CONFIG.STREAM;

  // Sisipkan session tag unik di awal agar vLLM tidak "curang" memakai prefix cache
  // sehingga GPU benar-benar dipaksa menghitung prefill & alokasi KV-cache dari nol.
  const uniqueSessionId = `[SESSION-${Date.now()}-VU${__VU || 1}-IT${__ITER || 1}]`;
  const preparedMessages = messages.map((msg, index) => {
    if (index === 0 && msg.role === 'system') {
      return { role: msg.role, content: `${msg.content} (Request Session: ${uniqueSessionId})` };
    }
    return msg;
  });

  const requestBody = {
    model: CONFIG.MODEL,
    messages: preparedMessages,
    temperature: CONFIG.TEMPERATURE,
    max_tokens: CONFIG.MAX_TOKENS,
    stream: isStreaming,
    chat_template_kwargs: {
      enable_thinking: Boolean(enableThinking)
    }
  };

  // Jika streaming, minta vLLM untuk menyertakan blok usage (token count) di chunk akhir
  if (isStreaming) {
    requestBody.stream_options = { include_usage: true };
  }

  const payloadString = JSON.stringify(requestBody);

  const params = {
    headers: CONFIG.getHeaders(),
    timeout: CONFIG.TIMEOUT_MS,
    tags: {
      scenario: scenarioName,
      thinking: enableThinking ? 'enabled' : 'disabled',
    }
  };

  // Kirim request; untuk OOM/overload (5xx, 429, timeout) coba ulang hingga MAX_RETRIES kali.
  // Jika tetap gagal dinyatakan FAILED. Error 4xx tidak di-retry.
  const startTime = Date.now();
  let res;
  let attempt = 0;
  while (true) {
    res = http.post(CONFIG.BASE_URL, payloadString, params);
    if (res.status === 200) break;

    recordFailedAttempt(res.status);
    console.error(`[FAIL] ${scenarioName} attempt ${attempt + 1}/${CONFIG.MAX_RETRIES + 1} HTTP ${res.status} (${classifyStatus(res.status)}): ${res.body ? String(res.body).substring(0, 200) : 'No body'}`);

    if (!isRetryable(res.status) || attempt >= CONFIG.MAX_RETRIES) break;
    attempt++;
    METRICS.retries.add(1);
    sleep(2 * attempt); // backoff 2s, 4s, 6s
  }
  const totalDuration = Date.now() - startTime;

  const isSuccess = check(res, {
    'status is 200': (r) => r.status === 200,
  });

  let ttftMs = 0;
  let completionTokens = 0;
  let promptTokens = 0;

  if (isSuccess && res.body) {
    // Pada streaming mode, res.timings.waiting merepresentasikan durasi prefill 
    // hingga chunk/token pertama diterima oleh client (TTFT).
    ttftMs = res.timings.waiting;

    if (isStreaming) {
      // Parse SSE chunks (data: {...})
      const lines = res.body.split('\n');
      let foundUsage = false;
      let chunkCount = 0;

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('data:') && line !== 'data: [DONE]') {
          const jsonStr = line.substring(5).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage && !foundUsage) {
              promptTokens = parsed.usage.prompt_tokens || 0;
              completionTokens = parsed.usage.completion_tokens || 0;
              foundUsage = true;
            }
            if (parsed.choices && parsed.choices.length > 0) {
              chunkCount++;
            }
          } catch (e) {
            // Ignore parse errors on individual partial chunks
          }
        }
      }

      // Fallback jika provider tidak mengembalikan usage block di streaming
      if (!foundUsage && chunkCount > 0) {
        completionTokens = chunkCount;
      }
    } else {
      // Non-streaming response parsing
      try {
        const json = res.json();
        if (json && json.usage) {
          promptTokens = json.usage.prompt_tokens || 0;
          completionTokens = json.usage.completion_tokens || 0;
        }
      } catch (e) {
        console.warn(`[WARN] Gagal parse JSON body non-streaming: ${e.message}`);
      }
    }
  }

  // Rekam ke custom metrics K6
  recordMetrics({
    status: res.status,
    ttftMs: ttftMs,
    e2eDurationMs: res.timings.duration || totalDuration, // durasi attempt yang berhasil
    completionTokens: completionTokens,
    promptTokens: promptTokens,
  });

  return res;
}
