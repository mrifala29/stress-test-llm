import { sleep } from 'k6';
import { getSelectedProfile } from '../config.js';
import { executeLLMRequest } from '../utils/request_helper.js';
import { generateSummaryReport } from '../utils/summary_reporter.js';

// Load payload short context sekali di init phase
const payloadData = JSON.parse(open('../data/short_context_1k.json'));

export const options = {
  ...getSelectedProfile(),
  thresholds: {
    'llm_success_rate': ['rate>0.95'],
    'llm_oom_failures': ['rate<0.05'],
    'llm_ttft_ms': ['p(90)<2500'],
  },
};

export default function () {
  executeLLMRequest({
    messages: payloadData.messages,
    enableThinking: false,
    scenarioName: '03_no_thinking_short_1k',
  });

  sleep(1 + Math.random());
}

export function handleSummary(data) {
  return generateSummaryReport(data, '03_no_thinking_short_1k');
}
