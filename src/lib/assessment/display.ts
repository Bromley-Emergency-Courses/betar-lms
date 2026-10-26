import type { ComponentResult } from "./types";

export function indicatorLabel(indicator: string): string {
  return indicator.replace("Attendance non-compliance", "Attendance requirement not met").replace("Presentation incomplete", "Presentation not completed").replace("theory:", "Theory · ").replace("practical:", "Practical · ");
}

export function componentScoreText(result?: Pick<ComponentResult, "score">, notRequired = false): string {
  if (notRequired) return "N/A";
  return result?.score == null ? "Pending" : `${result.score}%`;
}
