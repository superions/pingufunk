import { ENQUEUE_KEY_HEADER, parseEnqueueKey } from "./enqueue-request";

const STORAGE_KEY = "pingufunk.enqueue.v1";
const CAPACITY = 64;
const active = new Set<string>();
export interface UiEnqueueRequest {
  nzb: string;
  fingerprint: string;
  category: "movie" | "tv" | "default";
}
export class UiEnqueueError extends Error {}
type Registry = Record<string, string>;

function load(storage: Storage): Registry {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UiEnqueueError("Gespeicherte Auftragsbestätigung ist ungültig. Queue prüfen.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > CAPACITY
  )
    throw new UiEnqueueError("Gespeicherte Auftragsbestätigung ist ungültig. Queue prüfen.");
  for (const [key, intent] of Object.entries(value)) {
    if (
      !/^[a-f\d]{64}:(movie|tv|default)$/.test(key) ||
      typeof intent !== "string" ||
      !/^[a-f\d-]{36}:\d{13}$/i.test(intent)
    )
      throw new UiEnqueueError("Gespeicherte Auftragsbestätigung ist ungültig. Queue prüfen.");
  }
  return value as Registry;
}

function nonce(): string {
  // getRandomValues works on plain HTTP too; randomUUID/SubtleCrypto need not.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}:${Date.now()}`;
}

/** One deliberate UI attempt; uncertain results retain the same key across reload.
 * No automatic retry and no body/media URL persisted in browser storage.
 * A fresh key is permitted only after confirmation or an explicit new intent.
 */
export async function enqueueUiNzb(
  request: UiEnqueueRequest,
  newIntent = false,
  storage: Storage = sessionStorage
): Promise<string> {
  if (!/^[a-f\d]{64}$/.test(request.fingerprint))
    throw new UiEnqueueError("Auftragsdaten fehlen. Bitte die Suche erneut laden.");
  const identity = `${request.fingerprint}:${request.category}`;
  if (active.has(identity))
    throw new UiEnqueueError("Dieser Auftrag wartet bereits auf Bestätigung.");
  active.add(identity);
  try {
    const registry = load(storage);
    if (!registry[identity] && Object.keys(registry).length >= CAPACITY)
      throw new UiEnqueueError(
        "Zu viele unbestätigte Aufträge. Queue prüfen, bevor neue Aufträge begonnen werden."
      );
    const key = newIntent ? nonce() : (registry[identity] ?? nonce());
    try {
      parseEnqueueKey(key);
    } catch {
      throw new UiEnqueueError(
        "Der Auftragsschlüssel ist abgelaufen oder die Uhrzeit stimmt nicht. Queue prüfen; ein neuer Auftrag kann doppelt laden."
      );
    }
    registry[identity] = key;
    storage.setItem(STORAGE_KEY, JSON.stringify(registry));
    const response = await fetch(`/api/download?mode=addfile&cat=${request.category}`, {
      method: "POST",
      headers: { [ENQUEUE_KEY_HEADER]: key },
      body: request.nzb,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new UiEnqueueError(
        response.status === 409
          ? "Auftragsschlüssel-Konflikt. Queue prüfen; nicht automatisch neu einreihen."
          : "Der Download wurde nicht bestätigt. Bewusstes Wiederholen verwendet denselben Auftragsschlüssel. Queue prüfen."
      );
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Reflect.get(data, "status") !== true)
      throw new UiEnqueueError(
        "Der Download wurde nicht bestätigt. Mit demselben Schlüssel wiederholen oder Queue prüfen."
      );
    const ids: unknown = Reflect.get(data, "nzo_ids");
    if (
      !Array.isArray(ids) ||
      ids.length !== 1 ||
      typeof ids[0] !== "string" ||
      !/^[A-Za-z\d_-]{1,128}$/.test(ids[0])
    )
      throw new UiEnqueueError(
        "Die Auftrags-ID wurde nicht bestätigt. Queue prüfen, bevor du erneut einreihst."
      );
    const latest = load(storage);
    if (latest[identity] === key) {
      delete latest[identity];
      storage.setItem(STORAGE_KEY, JSON.stringify(latest));
    }
    return ids[0];
  } catch (error) {
    if (error instanceof UiEnqueueError) throw error;
    throw new UiEnqueueError(
      "Der Download wurde nicht bestätigt oder der Auftragsschlüssel konnte nicht gespeichert werden. Queue prüfen; nicht automatisch neu einreihen."
    );
  } finally {
    active.delete(identity);
  }
}
