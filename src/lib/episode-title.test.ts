import { expect, it } from "vitest";
import { equivalentEpisodeTitles } from "./episode-title";

it.each([
  ["Grauroter Morgen", "Grau-roter Morgen"],
  ["Noch 10 Minuten zu leben", "Noch zehn Minuten zu leben"],
  ["Mord nach der Uhr", "Ein Mord nach der Uhr"],
  ["Ein ungeklärter Fall", "Ungeklärter Fall"],
  ["Ein Weg: nach Hause", "ein Weg — nach Hause"],
  ["Zwölf Tage", "12 Tage"],
])("compares deterministic orthographic variants: %s / %s", (left, right) => {
  expect(equivalentEpisodeTitles(left, right)).toBe(true);
  expect(equivalentEpisodeTitles(right, left)).toBe(true);
});

it.each([
  ["Mord nach der Uhr", "Tod nach der Uhr"],
  ["Noch zehn Minuten zu leben", "Noch elf Minuten zu leben"],
  ["Mord nach der Uhr", "Mord nach Uhr"],
  ["Ein Toter am See", "Kein Toter am See"],
  ["Der Mord", "Der Mörder"],
  ["Fall 3-1", "Fall 31"],
  ["Tatort am See", "Tatortamsee"],
  ["", ""],
  ["Der", "Die"],
])("keeps concrete content differences conflicting: %s / %s", (left, right) => {
  expect(equivalentEpisodeTitles(left, right)).toBe(false);
});
