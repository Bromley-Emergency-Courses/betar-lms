import { z } from "zod";
import type { TeachingOffering } from "./student-teaching";
import type { WorkspaceAttendance } from "./student-workspace";

export interface TeachingPlanOptions {
  token: string;
  offerings: Array<TeachingOffering & { canPresent: boolean; plannedSessionId: string | null; planRevision: number }>;
  sessions: WorkspaceAttendance[];
}
export const teachingPlanCommandSchema = z.strictObject({
  studentId: z.uuid(), offeringId: z.uuid(), token: z.string().regex(/^[a-f0-9]{32}$/), kind: z.enum(["attendance", "presentation"]),
  sessionId: z.uuid().nullable(), fromSessionId: z.uuid().nullable(), expected: z.boolean()
}).refine(command => command.kind === "presentation" ? command.fromSessionId === null && command.expected : command.sessionId !== null && (command.fromSessionId === null || (command.expected && command.fromSessionId !== command.sessionId)), "Choose a valid plan and destination.");
