/** Syntax only; preserves relative legacy paths and does not attest mount rights. */
export function isDownloadPathInput(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    new TextEncoder().encode(value).length <= 4096 &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !/^[a-z][a-z\d+.-]*:\/\//iu.test(value)
  );
}
