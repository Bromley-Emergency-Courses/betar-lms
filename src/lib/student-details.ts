import { z } from "zod";

export const studentStatuses = ["prospect", "active", "completed", "withdrawn", "deferred", "interrupted"] as const;
export const admissionStages = ["interest", "application_invited", "submitted", "reviewed", "offered", "rejected", "accepted", "cccu_registration_pending", "cccu_registration_complete"] as const;

export const studentDetailsSchema = z.object({
  cccu_student_id: z.string().nullable(),
  temporary_id: z.string().min(2).max(80),
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().nullable(),
  status: z.enum(studentStatuses),
  admission_stage: z.enum(admissionStages),
  programme: z.enum(["pgcert", "microcredential"]),
  start_term_id: z.string().uuid().nullable(),
  notes: z.string().nullable()
});

export const studentProfileCommandSchema = z.object({
  studentId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  details: studentDetailsSchema.strict().refine(details => [details.first_name, details.last_name, details.temporary_id].every(value => value.trim().length > 0), "Name and identifier cannot be blank.")
}).strict();

export const studentCreationSchema = z.strictObject({
  studentId: z.uuid(),
  details: studentDetailsSchema.extend({
    first_name: z.string().trim().min(1).max(80), last_name: z.string().trim().min(1).max(80),
    temporary_id: z.string().trim().min(2).max(80).nullable(), cccu_student_id: z.string().trim().max(80).nullable(),
    email: z.string().trim().email(), phone: z.string().trim().max(100).nullable(), notes: z.string().trim().max(10000).nullable()
  }).strict()
});
