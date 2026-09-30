import { expect, it, vi } from "vitest";
import { readBoundedProviderJson, ProviderResponseError } from "./bounded-provider-json";

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
