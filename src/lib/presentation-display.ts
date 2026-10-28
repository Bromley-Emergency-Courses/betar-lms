import { presentationRubricCriteria } from "./presentation-rubric";

export function presentationBreakdown(scores: Record<string, number>, total: number, penalty = 0) {
  const valid = Object.keys(scores).length === presentationRubricCriteria.length && presentationRubricCriteria.every(criterion => Number.isInteger(scores[criterion.id]) && scores[criterion.id] >= 1 && scores[criterion.id] <= 5);
  const subtotal = Object.values(scores).reduce((sum, score) => sum + score, 0);
  return [
    ...presentationRubricCriteria.map(criterion => ({ label: criterion.label, value: scores[criterion.id] == null ? "Not recorded" : `${scores[criterion.id]}/5` })),
    ...Object.entries(scores).filter(([key]) => !presentationRubricCriteria.some(criterion => criterion.id === key)).map(([key, score]) => ({ label: `Legacy criterion: ${key}`, value: String(score) })),
    { label: "Rubric subtotal", value: valid ? `${subtotal}/50` : "Incomplete legacy rubric" },
    { label: "Time penalty", value: `${penalty} points` },
    { label: "Recorded total", value: `${total}/50` },
    ...(!valid || subtotal - penalty !== total ? [{ label: "Review", value: "Legacy discrepancy — recorded total preserved; administrator reconciliation required." }] : [])
  ];
}
