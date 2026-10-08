import { parseDecisionReport, type DecisionReport } from "./decision-diagnostics";
const key = "pingufunk.diagnostics.v1";
const ttl = 5 * 60_000;

/** One closed report, scoped to this browser tab; no queries, content IDs or URLs. */
export function rememberUiDiagnosis(value: unknown): DecisionReport | null {
  const report = parseDecisionReport(value);
  try {
    if (report) sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttl, report }));
    else sessionStorage.removeItem(key);
  } catch {
    /* Storage is optional for diagnosis, unlike enqueue acknowledgements. */
  }
  return report;
}
export function readUiDiagnosis(): DecisionReport | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 32_768) return null;
    const value = JSON.parse(raw);
    if (
      !Number.isSafeInteger(value.expires) ||
      value.expires <= Date.now() ||
      value.expires > Date.now() + ttl
    )
      return null;
    return parseDecisionReport(value.report);
  } catch {
    return null;
  }
}
