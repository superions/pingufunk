/** Private Config readback tokens, never transported in an NZB or browser payload. */
export type SourceAdmission = readonly { key: string; value: string }[];
export class SourceAdmissionError extends Error {
  constructor() {
    super("Source binding changed; search and verify the source again");
  }
}
/** No-op conditional updates lock policy rows through the same atomic job commit on both DBs. */
export async function applySourceAdmission(
  tx: {
    config: {
      updateMany(args: {
        where: { key: string; value: string };
        data: { value: string };
      }): PromiseLike<{ count: number }>;
    };
  },
  conditions: SourceAdmission | undefined
): Promise<void> {
  for (const condition of conditions ?? []) {
    const result = await tx.config.updateMany({
      where: condition,
      data: { value: condition.value },
    });
    if (result.count !== 1) throw new SourceAdmissionError();
  }
}
