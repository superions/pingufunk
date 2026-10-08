import { sourceFieldContract, validSourceDate } from "./postgresql-preflight.mjs";

export const importOrder = [
  ["TvdbSeries", "tvdbSeries"],
  ["TvdbEpisode", "tvdbEpisode"],
  ["Config", "config"],
  ["Download", "download"],
  ["EnqueueIntent", "enqueueIntent"],
  ["GeneratedRuleset", "generatedRuleset"],
  ["TopicCategory", "topicCategory"],
];

/**
 * Convert only SQLite storage representations, never domain payloads. The
 * preflight validates precision/range/NULL first; this repeats essential
 * guards so an importer cannot accidentally bypass that boundary.
 */
export function convertRow(model, row) {
  const contract = sourceFieldContract[model];
  if (!contract) throw new Error("Unknown source model");
  const expected = new Set(Object.values(contract).flat());
  if (model === "Download") {
    // Historical shapes lack these append-only nullable fields; absence alone maps to NULL.
    // Malformed existing text remains intact for the runtime to reject, not rewrite.
    row = {
      mediaExpectations: null,
      mediaValidation: null,
      ...row,
    };
  }
  const output = {};
  for (const [field, value] of Object.entries(row)) {
    if (!expected.has(field)) throw new Error(`Unknown field in ${model}`);
    if (value === null) {
      if (contract.required.includes(field)) throw new Error(`Required null in ${model}.${field}`);
      output[field] = null;
      continue;
    }
    if (contract.int?.includes(field)) {
      if (typeof value !== "bigint" || value < -2147483648n || value > 2147483647n)
        throw new Error(`Invalid int32 in ${model}.${field}`);
      output[field] = Number(value);
    } else if (contract.bigint?.includes(field)) {
      if (
        typeof value !== "bigint" ||
        value < -9223372036854775808n ||
        value > 9223372036854775807n
      )
        throw new Error(`Invalid int64 in ${model}.${field}`);
      output[field] = value;
    } else if (contract.date?.includes(field)) {
      if (!validSourceDate(value)) throw new Error(`Invalid timestamp in ${model}.${field}`);
      const milliseconds = typeof value === "bigint" ? Number(value) : Date.parse(value);
      if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(milliseconds))
        throw new Error(`Invalid timestamp in ${model}.${field}`);
      output[field] = new Date(milliseconds);
    } else if (contract.text?.includes(field)) {
      if (typeof value !== "string" || value.includes("\0"))
        throw new Error(`Invalid text in ${model}.${field}`);
      output[field] = value;
    } else {
      throw new Error(`Uncontracted field in ${model}`);
    }
  }
  if (Object.keys(output).length !== expected.size) throw new Error(`Incomplete row in ${model}`);
  return output;
}
