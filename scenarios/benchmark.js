import { sleep } from 'k6';
import { getSelectedProfile } from '../config.js';
import { executeLLMRequest } from '../utils/request_helper.js';
import { generateSummaryReport } from '../utils/summary_reporter.js';

/**
 * Skenario benchmark parametrik.
 *   -e CONTEXT=1k|2k|4k|16k|32k|64k
 *   -e THINKING=on|off
 *   -e PROFILE=runpod|dgx|smoke
 */
const CONTEXT = (__ENV.CONTEXT || '1k').toLowerCase();
const THINKING = (__ENV.THINKING || 'on').toLowerCase() !== 'off';
const SCENARIO_ID = `think_${THINKING ? 'on' : 'off'}_${CONTEXT}`;

// Load payload sekali di init phase
const payloadData = JSON.parse(open(`../data/context_${CONTEXT}.json`));

export const options = {
  ...getSelectedProfile(),
  thresholds: {
    // Target SLA: success rate final (setelah retry) minimal 85%
    'llm_success_rate': ['rate>=0.85'],

    // OTOMATIS STOP (ABORT) jika error rate HTTP (5xx, timeout, noresp) melebihi 15%
    // delayAbortEval: 1m agar tidak berhenti prematur di fase pemanasan awal
    'http_req_failed': [
      { threshold: 'rate<0.15', abortOnFail: true, delayAbortEval: '1m' },
    ],
  },
};

export default function () {
  executeLLMRequest({
    messages: payloadData.messages,
    enableThinking: THINKING,
    scenarioName: SCENARIO_ID,
  });

  // Jeda 1-2 detik antar request agar tidak flooding seketika
  sleep(1 + Math.random());
}

export function handleSummary(data) {
  return generateSummaryReport(data, SCENARIO_ID);
}

