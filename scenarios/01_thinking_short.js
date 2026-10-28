import { sleep } from 'k6';
import { getSelectedProfile } from '../config.js';
import { executeLLMRequest } from '../utils/request_helper.js';
import { generateSummaryReport } from '../utils/summary_reporter.js';

// Load payload data sekali di init phase
const payloadData = JSON.parse(open('../data/short_context_1k.json'));

export const options = {
  ...getSelectedProfile(),
  thresholds: {
    // SLA Metrik: Success rate > 95%
    'llm_success_rate': ['rate>0.95'],
    // OOM Failure Rate < 5%
    'llm_oom_failures': ['rate<0.05'],
    // Time-To-First-Token p(90) di bawah 3.5 detik (sesuai target PM)
    'llm_ttft_ms': ['p(90)<3500'],
  },
};

export default function () {
  executeLLMRequest({
    messages: payloadData.messages,
    enableThinking: true,
    scenarioName: '01_thinking_short_1k',
  });

  // Jeda dinamis 1-2 detik antar request agar tidak flooding seketika
  sleep(1 + Math.random());
}

export function handleSummary(data) {
  return generateSummaryReport(data, '01_thinking_short_1k');
}
