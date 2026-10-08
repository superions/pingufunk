import { EnqueueRequestError } from "./enqueue-request";

let tail: Promise<void> = Promise.resolve();
let pending = 0;

/** Admission only, not a transaction retry or a cross-process receipt store. */
export function serialSqliteEnqueue<T>(operation: () => Promise<T>): Promise<T> {
  if (pending >= 64)
    return Promise.reject(new EnqueueRequestError("Enqueue capacity exceeded", 503));
  pending++;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new EnqueueRequestError("Enqueue admission deadline exceeded", 408));
    }, 3000);
  });
  const admitted = tail.then(async () => {
    clearTimeout(timer);
    if (expired) throw new EnqueueRequestError("Enqueue admission deadline exceeded", 408);
    // No timeout races a mutation after admission: its commit can be uncertain.
    return operation();
  });
  tail = admitted.then(
    () => {
      pending--;
    },
    () => {
      pending--;
    }
  );
  return Promise.race([admitted, deadline]);
}
