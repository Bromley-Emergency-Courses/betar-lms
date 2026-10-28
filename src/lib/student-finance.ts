import { z } from "zod";

export const invoiceStatuses = { not_requested: "Not recorded / not requested", requested: "Requested", sent: "Sent", corrected: "Corrected" };
export const paymentStatuses = { not_due: "Not due", outstanding: "Outstanding", paid: "Paid", disputed: "Disputed" };
const amount = z.number().int().min(0).max(2147483647);
export const financeCommandSchema = z.strictObject({
  id: z.uuid(), student_id: z.uuid(), term_id: z.uuid(), expected_version: z.uuid().nullable(), term_token: z.string().regex(/^[a-f0-9]{32}$/).nullable(),
  expected_amount_pence: amount, invoice_amount_pence: amount.nullable(), paid_amount_pence: amount.nullable(),
  invoice_status: z.enum(["not_requested", "requested", "sent", "corrected"]), payment_status: z.enum(["not_due", "outstanding", "paid", "disputed"]),
  notes: z.string().trim().max(10000).nullable()
}).refine(command => command.expected_version === null ? command.term_token !== null : command.term_token === null, "Review the finance record before saving.");

export interface FinanceSnapshot {
  records: Array<Omit<z.infer<typeof financeCommandSchema>, "student_id" | "expected_version" | "term_token"> & { version: string; term: string }>;
  terms: Array<{ id: string; label: string; suggestedAmountPence: number; token: string }>;
}

export function financePence(value: string, optional = false): number | null {
  const trimmed = value.trim();
  if (!trimmed && optional) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error("Enter amounts in pounds with no more than two decimal places.");
  const [pounds, pennies = ""] = trimmed.split(".");
  const pence = Number(pounds) * 100 + Number(pennies.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence > 2147483647) throw new Error("Amounts must not exceed £21,474,836.47.");
  return pence;
}
