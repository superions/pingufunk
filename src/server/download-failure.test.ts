import { describe, expect, it } from "vitest";
import { safeTransferErrorCode, transferFailureMessage } from "./download-failure";

describe("closed transfer diagnostic codes", () => {
  it("reads known nested fetch codes without copying messages or socket metadata", () => {
    const secret = "opaque-credential";
    const error = new Error(`https://user:${secret}@example.invalid/private?token=${secret}`, {
      cause: Object.assign(new Error(secret), {
        code: "UND_ERR_SOCKET",
        socket: { remoteAddress: secret },
      }),
    });
    expect(safeTransferErrorCode(error)).toBe("UND_ERR_SOCKET");
    const message = transferFailureMessage({
      version: 1,
      phase: "body_read",
      reason: "exception",
      code: safeTransferErrorCode(error),
      receivedBytes: 8,
      writtenBytes: 8,
      expectedBytes: 80,
      httpStatus: 200,
      elapsedMs: 100,
    });
    expect(message).not.toContain(secret);
    expect(message).not.toContain("example.invalid");
    expect(message.length).toBeLessThan(400);
  });

  it("never emits arbitrary codes, cycles, or throwing properties", () => {
    expect(safeTransferErrorCode({ code: "token-value" })).toBe("UNKNOWN");
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(safeTransferErrorCode(cycle)).toBe("UNKNOWN");
    expect(
      safeTransferErrorCode({
        get code() {
          throw Error("secret");
        },
      })
    ).toBe("UNKNOWN");
    expect(safeTransferErrorCode({ cause: { cause: { cause: { cause: { code: "EIO" } } } } })).toBe(
      "UNKNOWN"
    );
  });
});
