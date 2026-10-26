/** Existing slots remain valid; measured selectors keep every concrete resolution distinct. */
export const RENDITION_SELECTORS = [
  "hd",
  "sd",
  "low",
  "2160p",
  "1080p",
  "720p",
  "576p",
  "480p",
] as const;
export type RenditionSelector = (typeof RENDITION_SELECTORS)[number];
