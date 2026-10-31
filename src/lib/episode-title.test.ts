import { expect, it } from "vitest";
import { equivalentEpisodeTitles } from "./episode-title";

it.each([
  ["Grauroter Morgen", "Grau-roter Morgen"],
  ["Noch 10 Minuten zu leben", "Noch zehn Minuten zu leben"],
  ["Mord nach der Uhr", "Ein Mord nach der Uhr"],
  ["Ein ungeklärter Fall", "Ungeklärter Fall"],
  ["Ein Weg: nach Hause", "ein Weg — nach Hause"],
  ["Zwölf Tage", "12 Tage"],
  ["Die Temperatur -10 Grad", "Temperatur -zehn Grad"],
  ["Ein Fall: zehn Prozent", "Fall: 10 Prozent"],
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
  ["Temperatur -10 Grad", "Temperatur +10 Grad"],
  ["Temperatur −10 Grad", "Temperatur 10 Grad"],
  ["Temperatur - 10 Grad", "Temperatur 10 Grad"],
  ["Noch 1,5 Minuten", "Noch 1/5 Minuten"],
  ["Fall 3-1", "Fall 3/1"],
  ["Fall 3–1", "Fall 3 1"],
  ["Zehn Prozent: 10%", "Zehn Prozent: 10"],
  ["Der 1. Mai", "Der 1 Mai"],
  ["Distanz x²", "Distanz x2"],
  ["Tatort am See", "Tatortamsee"],
  ["", ""],
  ["Der", "Die"],
])("keeps concrete content differences conflicting: %s / %s", (left, right) => {
  expect(equivalentEpisodeTitles(left, right)).toBe(false);
});
