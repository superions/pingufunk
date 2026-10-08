export type TransferPhase =
  | "request"
  | "response"
  | "file_open"
  | "body_read"
  | "file_write"
  | "progress"
  | "file_finish";

export interface TransferFailure {
  version: 1;
  phase: TransferPhase;
  reason:
    | "exception"
    | "inactivity_timeout"
    | "http_status"
    | "missing_body"
    | "invalid_length"
    | "length_overflow"
    | "length_mismatch";
  code: string;
  receivedBytes: number;
  writtenBytes: number;
  expectedBytes: number | null;
  httpStatus: number | null;
  elapsedMs: number;
  cleanupCode?: string;
}

const safeCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENOSPC",
  "EDQUOT",
  "EIO",
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOENT",
  "EEXIST",
  "EMFILE",
  "ENFILE",
  "ESTALE",
  "ABORT_ERR",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "P1000",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2002",
  "P2024",
  "P2025",
  "P2028",
  "P2034",
]);

/** Only closed, known codes escape the exception boundary. Never copy messages,
 * stack, URL, path, response text, Prisma metadata or arbitrary custom codes. */
export function safeTransferErrorCode(error: unknown): string {
  for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
    try {
      const { code, cause } = error as { code?: unknown; cause?: unknown };
      if (typeof code === "string" && safeCodes.has(code)) return code;
      error = cause;
    } catch {
      return "UNKNOWN";
    }
  }
  return "UNKNOWN";
}

export function transferFailureMessage(failure: TransferFailure): string {
  return `Download failed: ${JSON.stringify(failure)}`;
}
