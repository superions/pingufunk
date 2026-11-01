import { expect, it } from "vitest";
import {
  pairedProgrammeExpectations,
  programmeExpectations,
} from "./__fixtures__/mediathek-programme";
import {
  parseMediaExpectations,
  serializeMediaExpectations,
  durationExpectations,
} from "./media-expectations";
import { generateFakeNzb, parseNzbContent } from "@/services/nzb-release";

it("transports both targets and separate runtimes through NZB and the existing serialized job field", () => {
  const release = {
    title: "Synthetic.Series.S00E02E03.Whole.Programme.GERMAN.720p",
    url: "https://example.invalid/whole.mp4",
    mediaExpectations: pairedProgrammeExpectations,
  };
  const nzb = parseNzbContent(generateFakeNzb(release));
  expect(nzb).toEqual(release);
  expect(parseMediaExpectations(serializeMediaExpectations(nzb!.mediaExpectations!))).toEqual(
    pairedProgrammeExpectations
  );
  expect(durationExpectations(pairedProgrammeExpectations, 25)).toEqual(
    Object.values(pairedProgrammeExpectations.durations)
  );
  expect(parseMediaExpectations(serializeMediaExpectations(programmeExpectations))).toEqual(
    programmeExpectations
  );
});
it.each([
  "missing-part",
  "zero-part",
  "wrong-total",
  "reversed",
  "nonadjacent",
  "foreign-season",
  "duplicate",
  "v6-downgrade",
  "extra-target",
  "single-target",
])("rejects %s without downgrading a whole-programme declaration", (kind) => {
  const x: {
    version: number;
    episodeDurations: Array<{ seconds: number }>;
    sourceProgramme: {
      targets: Array<{ season: number; episode: number }>;
      target?: { season: number; episode: number };
    };
  } = structuredClone(pairedProgrammeExpectations);
  if (kind === "missing-part") x.episodeDurations.pop();
  if (kind === "zero-part") x.episodeDurations[1].seconds = 0;
  if (kind === "wrong-total") x.episodeDurations[1].seconds = 61;
  if (kind === "reversed") x.sourceProgramme.targets.reverse();
  if (kind === "nonadjacent") x.sourceProgramme.targets[1].episode = 4;
  if (kind === "foreign-season") x.sourceProgramme.targets[1].season = 1;
  if (kind === "duplicate") x.sourceProgramme.targets[1].episode = 2;
  if (kind === "v6-downgrade") x.version = 6;
  if (kind === "extra-target") x.sourceProgramme.targets.push({ season: 0, episode: 4 });
  if (kind === "single-target") {
    x.sourceProgramme.target = x.sourceProgramme.targets[0];
    Reflect.deleteProperty(x.sourceProgramme, "targets");
  }
  expect(() => parseMediaExpectations(x)).toThrow("Invalid media expectations");
});
