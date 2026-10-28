import { z } from "zod";

export function formatAttendanceTimestamp(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", calendar: "gregory", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(parts.day)} ${months[Number(parts.month) - 1]} ${parts.year}, ${parts.hour.padStart(2, "0")}:${parts.minute.padStart(2, "0")}`;
}

export const workspaceAttendanceStatuses = ["not_recorded", "expected", "attended", "partial", "missed"] as const;
export const workspaceAttendanceLabels = { not_recorded: "Not recorded", expected: "Expected", attended: "Attended", partial: "Part attended", missed: "Missed" };
export const attendanceCommandSchema = z.object({
  studentId: z.string().uuid(), sessionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(), expectedSessionRevision: z.number().int().nonnegative(),
  status: z.enum(workspaceAttendanceStatuses), expected: z.boolean(), note: z.string().trim().max(500).nullable(),
  reason: z.string().trim().min(1, "Enter an administrator reason.").max(4000), confirmClear: z.boolean()
}).strict();
export const sharedSessionCommandSchema = z.object({
  studentId: z.string().uuid(), sessionId: z.string().uuid(), termId: z.string().uuid(),
  date: z.iso.date(), startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().trim().min(2).max(160), reason: z.string().trim().min(1, "Enter an administrator reason.").max(4000)
}).strict().refine(input => input.startsAt < input.endsAt, { message: "End time must be after start time.", path: ["endsAt"] });
