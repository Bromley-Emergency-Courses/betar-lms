import clsx from "clsx";

const colourByValue: Record<string, string> = {
  active: "green",
  completed: "green",
  paid: "green",
  passed: "green",
  attended: "green",
  cccu_registration_complete: "green",
  verified: "green",
  ready_for_decision: "green",
  in_progress: "violet",
  accepted: "violet",
  offered: "violet",
  watch: "amber",
  outstanding: "amber",
  partial: "amber",
  cccu_registration_pending: "amber",
  needs_information: "amber",
  unverified: "amber",
  deferred: "amber",
  interrupted: "amber",
  prospect: "neutral",
  not_ready: "neutral",
  not_due: "neutral",
  not_requested: "neutral",
  expected: "neutral",
  resit: "amber",
  did_not_complete: "red",
  failed: "red",
  missed: "red",
  offer_declined: "red",
  offer_lapsed: "red",
  lapsed: "red",
  rejected: "red",
  withdrawn: "red",
  disputed: "red",
  support_needed: "red"
};

export function StatusPill({ value, label }: { value: string; label?: string }) {
  const colour = colourByValue[value] ?? "neutral";
  return <span className={clsx("status", colour)}>{label ?? value.replaceAll("_", " ")}</span>;
}
