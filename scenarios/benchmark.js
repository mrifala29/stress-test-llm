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
    // Request dinyatakan FAILED setelah 3x retry; target SLA success rate > 95%
    'llm_success_rate': ['rate>0.95'],
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

