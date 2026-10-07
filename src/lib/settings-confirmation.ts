import { isCredentialSettingKey, isMaskedSetting } from "./settings-redaction";
import { normalizeSetting } from "./settings-schema";

/** A successful HTTP status alone is not confirmation of a persisted batch. */
export function confirmedSettings(
  payload: unknown,
  submitted: Record<string, unknown>
): Record<string, string> {
  const fail = (): never => {
    throw new Error("Settings confirmation missing; refresh before retrying");
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail();
  const body = payload as Record<string, unknown>;
  if (
    body.success !== true ||
    !body.settings ||
    typeof body.settings !== "object" ||
    Array.isArray(body.settings)
  )
    return fail();
  const expected = Object.entries(submitted)
    .filter(
      ([key, value]) =>
        !(isMaskedSetting(key, value) || (isCredentialSettingKey(key) && value === ""))
    )
    .map(([key]) => key);
  const rows = Object.entries(body.settings);
  if (body.updated !== expected.length || rows.length !== expected.length) return fail();
  for (const [key, value] of rows) {
    if (
      !expected.includes(key) ||
      typeof value !== "string" ||
      normalizeSetting(key, value) !== value
    )
      return fail();
  }
  return Object.fromEntries(rows) as Record<string, string>;
}
