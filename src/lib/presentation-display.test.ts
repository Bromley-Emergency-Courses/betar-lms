import { describe, expect, it } from "vitest";
import { presentationRubricCriteria } from "./presentation-rubric";
import { presentationBreakdown } from "./presentation-display";

const scores = Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, 4]));
describe("presentation breakdown", () => {
  it("separates rubric, manual deduction and saved total", () => {
    const details = presentationBreakdown(scores, 37, 3);
    expect(details).toContainEqual({ label: "Rubric subtotal", value: "40/50" });
    expect(details).toContainEqual({ label: "Time penalty", value: "3 points" });
    expect(details).toContainEqual({ label: "Recorded total", value: "37/50" });
    expect(details).toHaveLength(13);
  });
  it("preserves zero totals and historic differences rather than recomputing", () => {
    expect(presentationBreakdown(scores, 0, 40)).toContainEqual({ label: "Recorded total", value: "0/50" });
    expect(presentationBreakdown(scores, 37).at(-1)?.label).toBe("Review");
    expect(presentationBreakdown({}, 37)).toContainEqual({ label: "Recorded total", value: "37/50" });
  });
});
