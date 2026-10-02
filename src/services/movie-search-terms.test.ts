import { describe, expect, it } from "vitest";
import { movieSearchTerms } from "./movie-search-terms";

describe("bounded retrieval terms", () => {
  it("prioritizes complete documented titles over heuristics", () => {
    expect(movieSearchTerms(["Original Film", "Deutscher Film", "Alias Film", "Fourth"])).toEqual([
      "Original Film",
      "Deutscher Film",
      "Alias Film",
    ]);
  });
  it("deduplicates input and keeps single-word searches single", () => {
    expect(movieSearchTerms([" Movie ", "Movie", ""])).toEqual(["Movie"]);
  });
  it("adds umlaut and distinctive-word retrieval without claiming identity", () => {
    expect(movieSearchTerms(["Die außergewöhnliche Überquerung"])).toEqual([
      "Die außergewöhnliche Überquerung",
      "Die aussergewoehnliche Ueberquerung",
      "außergewöhnliche Überquerung",
    ]);
  });
});
