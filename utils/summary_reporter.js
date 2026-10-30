import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

/**
 * Custom K6 Summary Handler
 * Menghasilkan:
 * 1. Console text summary
 * 2. JSON summary di reports/raw/ (sumber data untuk laporan HTML)
 *
 * Laporan HTML (per skenario & konsolidasi) dibuat oleh utils/consolidate_reports.js
 * dengan tema yang seragam.
 */
export function generateSummaryReport(data, scenarioName) {
  const safeName = scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const profile = (__ENV.PROFILE || 'smoke').toLowerCase();
  const filePrefix = `${safeName}_${profile}`;

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/raw/${filePrefix}_summary.json`]: JSON.stringify(data, null, 2),
  };
}
