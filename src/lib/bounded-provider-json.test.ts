import { expect, it, vi } from "vitest";
import {
  readBoundedProviderJson,
  readBoundedProviderText,
  ProviderResponseError,
  MAX_PROVIDER_RESPONSE_BYTES,
} from "./bounded-provider-json";

it("allows explicitly larger bounded responses but not an unbounded safety ceiling", async () => {
  await expect(
    readBoundedProviderJson(new Response("[1]"), Date.now() + 1000, 10 * 1024 * 1024)
  ).resolves.toEqual([1]);
  await expect(
    readBoundedProviderJson(new Response("[1]"), Date.now() + 1000, MAX_PROVIDER_RESPONSE_BYTES + 1)
  ).rejects.toBeInstanceOf(ProviderResponseError);
});

it("allows the exact byte boundary and rejects one byte over it", async () => {
  await expect(
    readBoundedProviderJson(new Response("[1]"), Date.now() + 1_000, 3)
  ).resolves.toEqual([1]);
  await expect(
    readBoundedProviderJson(new Response("[1]"), Date.now() + 1_000, 2)
  ).rejects.toBeInstanceOf(ProviderResponseError);
});

it("bounds chunk overhead even for an otherwise valid, small JSON payload", async () => {
  const cancel = vi.fn();
  const bytes = new TextEncoder().encode(JSON.stringify(new Array(8_193).fill(0)));
  let position = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (position === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(position, ++position));
      },
      cancel,
    })
  );
  await expect(
    readBoundedProviderJson(response, Date.now() + 2_000, 100_000)
  ).rejects.toBeInstanceOf(ProviderResponseError);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(position).toBeLessThan(bytes.length);
});

it("does not disclose a parse error containing a private URL", async () => {
  await expect(
    readBoundedProviderJson(
      new Response("https://fixture.invalid/?token=synthetic"),
      Date.now() + 1_000,
      100
    )
  ).rejects.toThrow(/^Invalid provider response$/);
});

it("uses the same byte, UTF-8 and deadline protections for public HTML", async () => {
  await expect(readBoundedProviderText(new Response("ü"), Date.now() + 1000, 2)).resolves.toBe("ü");
  await expect(readBoundedProviderText(new Response("ü"), Date.now() + 1000, 1)).rejects.toThrow(
    "Invalid provider response"
  );
  await expect(
    readBoundedProviderText(new Response(Uint8Array.of(255)), Date.now() + 1000, 2)
  ).rejects.toThrow("Invalid provider response");
  await expect(readBoundedProviderText(new Response("html"), Date.now() - 1, 100)).rejects.toThrow(
    "Invalid provider response"
  );
});

it("includes UTF-8 decoding in the original absolute operation deadline", async () => {
  vi.useFakeTimers();
  const response = new Response("bounded");
  const deadline = Date.now() + 1000;
  const decode = TextDecoder.prototype.decode;
  vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (
    this: TextDecoder,
    input,
    options
  ) {
    const value = decode.call(this, input, options);
    vi.advanceTimersByTime(1000);
    return value;
  });
  try {
    await expect(readBoundedProviderText(response, deadline, 100)).rejects.toThrow(
      "Invalid provider response"
    );
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
