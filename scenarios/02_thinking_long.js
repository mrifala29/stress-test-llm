import { sleep } from 'k6';
import { getSelectedProfile } from '../config.js';
import { executeLLMRequest } from '../utils/request_helper.js';
import { generateSummaryReport } from '../utils/summary_reporter.js';

// Load payload data 128k context sekali di init phase
const payloadData = JSON.parse(open('../data/long_context_128k.json'));

export const options = {
  ...getSelectedProfile(),
  thresholds: {
    'llm_success_rate': ['rate>0.85'],
    'llm_oom_failures': ['rate<0.10'],
  },
};

export default function () {
  executeLLMRequest({
    messages: payloadData.messages,
    enableThinking: true,
    scenarioName: '02_thinking_long_128k',
  });

  // Jeda 2-3 detik untuk fase recovery KV-Cache di GPU
  sleep(2 + Math.random());
}

export function handleSummary(data) {
  return generateSummaryReport(data, '02_thinking_long_128k');
}
