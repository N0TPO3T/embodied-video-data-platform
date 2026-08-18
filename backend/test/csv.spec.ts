import { csvCell, csvDocument } from "../src/csv/csv.js";

describe("safe CSV serialization", () => {
  it.each([
    ["=HYPERLINK(\"https://example.invalid\")", '"\'=HYPERLINK(""https://example.invalid"")"'],
    ["+SUM(1,2)", '"\'+SUM(1,2)"'],
    ["-2+3", "'-2+3"],
    ["@payload", "'@payload"],
    ["  =1+1", "'  =1+1"],
  ])("neutralizes formula-like cell %s", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("keeps numeric negatives numeric and emits an UTF-8 BOM", () => {
    expect(csvCell(-12)).toBe("-12");
    expect(csvDocument([["名称", "正常"]])).toBe("\uFEFF名称,正常\n");
  });
});
