import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

/**
 * Custom K6 Summary Handler
 * Menghasilkan:
 * 1. Console text summary dengan highlight metrik LLM (TTFT, TPS, Failures)
 * 2. Visual HTML Report di folder reports/
 * 3. JSON summary data untuk integrasi CI/CD atau dashboard
 */
export function generateSummaryReport(data, scenarioName) {
  const safeName = scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const profile = (__ENV.PROFILE || 'smoke').toLowerCase();
  const filePrefix = `${safeName}_${profile}`;
  
  const outputs = {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${filePrefix}_summary.json`]: JSON.stringify(data, null, 2),
  };

  try {
    outputs[`reports/${filePrefix}_report.html`] = htmlReport(data, {
      title: `LLM Benchmark [${profile.toUpperCase()}] - ${scenarioName}`,
    });
  } catch (err) {
    console.warn(`[WARN] Gagal membuat HTML report via bundle: ${err.message}`);
  }

  return outputs;
}
