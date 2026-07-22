"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import {
  normalizeInboundExamResult,
  parsePracticalModuleCodeMap,
  parseExamAdapterPayload,
  persistNormalizedExamResults,
  practicalCsvRowsToInboundExamResults,
  resolveExamResultForStudent,
  syncEnrolmentStatusesForExamResults
} from "@/lib/exam-adapters";
import { getLmsData } from "@/lib/lms-data";
import { presentationRubricCriteria } from "@/lib/presentation-rubric";
import { createSupabaseServerClient } from "@/lib/supabase";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length > 0 ? next : null;
}

function optionalBoolean(formData: FormData, key: string): boolean | null {
  const next = optionalValue(formData, key);
  if (next === null) {
    return null;
  }
  if (next === "true") {
    return true;
  }
  if (next === "false") {
    return false;
  }
  throw new Error(`${key} must be true or false.`);
}

function isMissingEnrolmentRequirementColumnError(error: { message?: string; code?: string }): boolean {
  return (
    error.code === "PGRST204" &&
    typeof error.message === "string" &&
    (error.message.includes("attendance_days_required_override") ||
      error.message.includes("presentation_required_override"))
  );
}

function poundsToPence(input: string): number {
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Amount must be a positive number.");
  }
  return Math.round(amount * 100);
}

function requireDeleteConfirmation(formData: FormData): void {
  if (formData.get("confirm_delete") !== "on") {
    throw new Error("Deletion requires confirmation.");
  }
}

function revalidateCourseConfig() {
  revalidatePath("/course");
  revalidatePath("/exams");
}

const idSchema = z.string().uuid();

const moduleSchema = z.object({
  code: z.string().min(2).max(40),
  title: z.string().min(2).max(160),
  credits: z.coerce.number().int().positive(),
  mode: z.enum(["practical", "online"]),
  mandatory: z.boolean()
});

export async function createCourseModule(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = moduleSchema.parse({
    code: value(formData, "code").toUpperCase(),
    title: value(formData, "title"),
    credits: value(formData, "credits"),
    mode: value(formData, "mode"),
    mandatory: formData.get("mandatory") === "on"
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("course_modules").insert({
    ...parsed,
    active: true
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function updateCourseModule(formData: FormData) {
  await requirePermission("manage_course");
  const moduleId = idSchema.parse(value(formData, "module_id"));
  const parsed = moduleSchema.parse({
    code: value(formData, "code").toUpperCase(),
    title: value(formData, "title"),
    credits: value(formData, "credits"),
    mode: value(formData, "mode"),
    mandatory: formData.get("mandatory") === "on"
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("course_modules").update(parsed).eq("id", moduleId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function deleteCourseModule(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const moduleId = idSchema.parse(value(formData, "module_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("course_modules").delete().eq("id", moduleId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

const termSchema = z.object({
  name: z.string().min(2).max(120),
  starts_on: z.string().min(1),
  ends_on: z.string().min(1),
  exam_window_starts_on: z.string().nullable(),
  exam_window_ends_on: z.string().nullable(),
  status: z.enum(["draft", "published", "active", "closed"])
});

export async function createTerm(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = termSchema.parse({
    name: value(formData, "name"),
    starts_on: value(formData, "starts_on"),
    ends_on: value(formData, "ends_on"),
    exam_window_starts_on: optionalValue(formData, "exam_window_starts_on"),
    exam_window_ends_on: optionalValue(formData, "exam_window_ends_on"),
    status: value(formData, "status")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("terms").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function updateTerm(formData: FormData) {
  await requirePermission("manage_course");
  const termId = idSchema.parse(value(formData, "term_id"));
  const parsed = termSchema.parse({
    name: value(formData, "name"),
    starts_on: value(formData, "starts_on"),
    ends_on: value(formData, "ends_on"),
    exam_window_starts_on: optionalValue(formData, "exam_window_starts_on"),
    exam_window_ends_on: optionalValue(formData, "exam_window_ends_on"),
    status: value(formData, "status")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("terms").update(parsed).eq("id", termId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function deleteTerm(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const termId = idSchema.parse(value(formData, "term_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("terms").delete().eq("id", termId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

const offeringSchema = z.object({
  module_id: z.string().uuid(),
  term_id: z.string().uuid(),
  price_pence: z.number().int().nonnegative(),
  capacity: z.coerce.number().int().positive(),
  attendance_days_required_first_practical: z.coerce.number().int().nonnegative(),
  attendance_days_required_subsequent_practical: z.coerce.number().int().nonnegative(),
  presentation_required: z.boolean()
});

export async function createModuleOffering(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = offeringSchema.parse({
    module_id: value(formData, "module_id"),
    term_id: value(formData, "term_id"),
    price_pence: poundsToPence(value(formData, "price")),
    capacity: value(formData, "capacity"),
    attendance_days_required_first_practical: value(formData, "attendance_first"),
    attendance_days_required_subsequent_practical: value(formData, "attendance_subsequent"),
    presentation_required: formData.get("presentation_required") === "on"
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("module_offerings").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function updateModuleOffering(formData: FormData) {
  await requirePermission("manage_course");
  const offeringId = idSchema.parse(value(formData, "offering_id"));
  const parsed = offeringSchema.parse({
    module_id: value(formData, "module_id"),
    term_id: value(formData, "term_id"),
    price_pence: poundsToPence(value(formData, "price")),
    capacity: value(formData, "capacity"),
    attendance_days_required_first_practical: value(formData, "attendance_first"),
    attendance_days_required_subsequent_practical: value(formData, "attendance_subsequent"),
    presentation_required: formData.get("presentation_required") === "on"
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("module_offerings").update(parsed).eq("id", offeringId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

export async function deleteModuleOffering(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const offeringId = idSchema.parse(value(formData, "offering_id"));

  const supabase = await createSupabaseServerClient();
  const { count: enrolmentCount, error: enrolmentError } = await supabase
    .from("enrolments")
    .select("id", { count: "exact", head: true })
    .eq("offering_id", offeringId);
  if (enrolmentError) {
    throw new Error(enrolmentError.message);
  }
  if ((enrolmentCount ?? 0) > 0) {
    throw new Error(
      `This module offering has ${enrolmentCount} enrolment${enrolmentCount === 1 ? "" : "s"}. Remove or move those enrolments before deleting the offering.`
    );
  }

  const { error } = await supabase.from("module_offerings").delete().eq("id", offeringId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateCourseConfig();
}

const studentSchema = z.object({
  cccu_student_id: z.string().nullable(),
  temporary_id: z.string().min(2).max(80),
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().nullable(),
  status: z.enum(["prospect", "active", "completed", "withdrawn", "deferred", "interrupted"]),
  admission_stage: z.enum([
    "interest",
    "application_invited",
    "submitted",
    "reviewed",
    "offered",
    "rejected",
    "accepted",
    "cccu_registration_pending",
    "cccu_registration_complete"
  ]),
  programme: z.enum(["pgcert", "microcredential"]),
  start_term_id: z.string().uuid().nullable(),
  notes: z.string().nullable()
});

export async function createStudent(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = studentSchema.parse({
    cccu_student_id: optionalValue(formData, "cccu_student_id"),
    temporary_id: value(formData, "temporary_id") || `BETAR-TMP-${Date.now()}`,
    first_name: value(formData, "first_name"),
    last_name: value(formData, "last_name"),
    email: value(formData, "email"),
    phone: optionalValue(formData, "phone"),
    status: value(formData, "status"),
    admission_stage: value(formData, "admission_stage"),
    programme: value(formData, "programme"),
    start_term_id: optionalValue(formData, "start_term_id"),
    notes: optionalValue(formData, "notes")
  });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("students").insert(parsed).select("id").single();
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath("/admissions");
  redirect(`/students/${data.id}`);
}

export async function updateStudentDetails(formData: FormData) {
  await requirePermission("manage_admissions");
  const studentId = idSchema.parse(value(formData, "student_id"));
  const parsed = studentSchema.parse({
    cccu_student_id: optionalValue(formData, "cccu_student_id"),
    temporary_id: value(formData, "temporary_id"),
    first_name: value(formData, "first_name"),
    last_name: value(formData, "last_name"),
    email: value(formData, "email"),
    phone: optionalValue(formData, "phone"),
    status: value(formData, "status"),
    admission_stage: value(formData, "admission_stage"),
    programme: value(formData, "programme"),
    start_term_id: optionalValue(formData, "start_term_id"),
    notes: optionalValue(formData, "notes")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").update(parsed).eq("id", studentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/admissions");
}

export async function deleteStudent(formData: FormData) {
  await requirePermission("manage_admissions");
  requireDeleteConfirmation(formData);
  const studentId = idSchema.parse(value(formData, "student_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").delete().eq("id", studentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath("/admissions");
  redirect("/students");
}

const allowedStudentPhotoTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadStudentPhoto(formData: FormData) {
  await requirePermission("manage_everything");
  const studentId = idSchema.parse(value(formData, "student_id"));
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a student photo to upload.");
  }
  if (!allowedStudentPhotoTypes.has(file.type)) {
    throw new Error("Student photos must be PNG, JPG, or WEBP images.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Student photos must be 10MB or smaller.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectPath = `${studentId}/${crypto.randomUUID()}.${extension}`;
  const supabase = await createSupabaseServerClient();
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, photo_path")
    .eq("id", studentId)
    .single();
  if (studentError) {
    throw new Error(studentError.message);
  }

  const { error: uploadError } = await supabase.storage
    .from("student-photos")
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false
    });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { error: updateError } = await supabase.from("students").update({ photo_path: objectPath }).eq("id", studentId);
  if (updateError) {
    await supabase.storage.from("student-photos").remove([objectPath]);
    throw new Error(updateError.message);
  }

  if (student.photo_path) {
    await supabase.storage.from("student-photos").remove([student.photo_path]);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  redirect(`/students/${studentId}?mode=edit`);
}

export async function deleteStudentPhoto(formData: FormData) {
  await requirePermission("manage_everything");
  requireDeleteConfirmation(formData);
  const studentId = idSchema.parse(value(formData, "student_id"));
  const supabase = await createSupabaseServerClient();
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, photo_path")
    .eq("id", studentId)
    .single();
  if (studentError) {
    throw new Error(studentError.message);
  }
  if (student.photo_path) {
    const { error: removeError } = await supabase.storage.from("student-photos").remove([student.photo_path]);
    if (removeError) {
      throw new Error(removeError.message);
    }
  }

  const { error: updateError } = await supabase.from("students").update({ photo_path: null }).eq("id", studentId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  redirect(`/students/${studentId}?mode=edit`);
}

export async function updateStudentLifecycle(formData: FormData) {
  await requirePermission("manage_admissions");
  const studentId = z.string().uuid().parse(value(formData, "student_id"));
  const parsed = studentSchema.pick({ status: true, admission_stage: true }).parse({
    status: value(formData, "status"),
    admission_stage: value(formData, "admission_stage")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").update(parsed).eq("id", studentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/admissions");
}

const leadStageSchema = z.enum([
  "interest",
  "application_invited",
  "submitted",
  "reviewed",
  "offered",
  "rejected",
  "accepted",
  "archived"
]);

function moduleInterestIds(formData: FormData): string[] {
  return formData
    .getAll("module_interest_ids")
    .map((entryValue) => String(entryValue).trim())
    .filter(Boolean);
}

const admissionLeadSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().nullable(),
  stage: leadStageSchema,
  programme: z.enum(["pgcert", "microcredential"]),
  module_interest_ids: z.array(z.string().uuid()),
  source: z.string().nullable(),
  last_contacted_on: z.string().nullable(),
  next_action_on: z.string().nullable(),
  notes: z.string().nullable(),
  archived: z.boolean()
});

function parseAdmissionLeadForm(formData: FormData) {
  const stage = (value(formData, "stage") || "interest") as z.infer<typeof leadStageSchema>;
  return admissionLeadSchema.parse({
    first_name: value(formData, "first_name"),
    last_name: value(formData, "last_name"),
    email: value(formData, "email"),
    phone: optionalValue(formData, "phone"),
    stage,
    programme: value(formData, "programme") || "pgcert",
    module_interest_ids: moduleInterestIds(formData),
    source: optionalValue(formData, "source"),
    last_contacted_on: optionalValue(formData, "last_contacted_on"),
    next_action_on: optionalValue(formData, "next_action_on"),
    notes: optionalValue(formData, "notes"),
    archived: stage === "archived" || formData.get("archived") === "on"
  });
}

export async function createAdmissionLead(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseAdmissionLeadForm(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("admission_leads").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions");
  redirect("/admissions?mode=edit");
}

export async function updateAdmissionLead(formData: FormData) {
  await requirePermission("manage_admissions");
  const leadId = idSchema.parse(value(formData, "lead_id"));
  const parsed = parseAdmissionLeadForm(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("admission_leads").update(parsed).eq("id", leadId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions");
  redirect("/admissions?mode=edit");
}

export async function convertAdmissionLeadToStudent(formData: FormData) {
  await requirePermission("manage_admissions");
  const leadId = idSchema.parse(value(formData, "lead_id"));
  const temporaryId = value(formData, "temporary_id") || `BETAR-TMP-${Date.now()}`;
  const cccuStudentId = optionalValue(formData, "cccu_student_id");
  const startTermId = optionalValue(formData, "start_term_id");

  const supabase = await createSupabaseServerClient();
  const { data: lead, error: leadError } = await supabase.from("admission_leads").select("*").eq("id", leadId).single();
  if (leadError) {
    throw new Error(leadError.message);
  }
  if (lead.converted_student_id) {
    redirect(`/students/${lead.converted_student_id}`);
  }

  const admissionStage = cccuStudentId ? "cccu_registration_complete" : "cccu_registration_pending";
  const studentStatus = cccuStudentId ? "active" : "prospect";
  const parsed = studentSchema.parse({
    cccu_student_id: cccuStudentId,
    temporary_id: temporaryId,
    first_name: String(lead.first_name),
    last_name: String(lead.last_name),
    email: String(lead.email),
    phone: optionalValue(formData, "phone") ?? (lead.phone ? String(lead.phone) : null),
    status: studentStatus,
    admission_stage: admissionStage,
    programme: String(lead.programme),
    start_term_id: startTermId,
    notes: lead.notes ? String(lead.notes) : null
  });

  const { data: student, error: studentError } = await supabase.from("students").insert(parsed).select("id").single();
  if (studentError) {
    throw new Error(studentError.message);
  }

  const { error: updateLeadError } = await supabase
    .from("admission_leads")
    .update({
      converted_student_id: student.id,
      archived: true,
      stage: "archived"
    })
    .eq("id", leadId);
  if (updateLeadError) {
    throw new Error(updateLeadError.message);
  }

  revalidatePath("/admissions");
  revalidatePath("/students");
  redirect(`/students/${student.id}`);
}

export async function createProspect(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = studentSchema.parse({
    cccu_student_id: null,
    temporary_id: value(formData, "temporary_id") || `BETAR-TMP-${Date.now()}`,
    first_name: value(formData, "first_name"),
    last_name: value(formData, "last_name"),
    email: value(formData, "email"),
    phone: optionalValue(formData, "phone"),
    status: "prospect",
    admission_stage: value(formData, "admission_stage") || "interest",
    programme: value(formData, "programme") || "pgcert",
    start_term_id: optionalValue(formData, "start_term_id"),
    notes: optionalValue(formData, "notes")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath("/admissions");
  redirect("/admissions?mode=edit");
}

export async function updateAdmissionRecord(formData: FormData) {
  await requirePermission("manage_admissions");
  const studentId = idSchema.parse(value(formData, "student_id"));
  const parsed = studentSchema
    .pick({
      cccu_student_id: true,
      status: true,
      admission_stage: true,
      programme: true,
      start_term_id: true,
      notes: true
    })
    .parse({
      cccu_student_id: optionalValue(formData, "cccu_student_id"),
      status: value(formData, "status"),
      admission_stage: value(formData, "admission_stage"),
      programme: value(formData, "programme"),
      start_term_id: optionalValue(formData, "start_term_id"),
      notes: optionalValue(formData, "notes")
    });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("students").update(parsed).eq("id", studentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/admissions");
  redirect("/admissions?mode=edit");
}

function csvValue(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

export async function importAdmissionsCsv(formData: FormData) {
  await requirePermission("manage_admissions");
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a CSV file to import.");
  }

  const csv = await file.text();
  const parsedCsv = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true
  });
  if (parsedCsv.errors.length > 0) {
    throw new Error(parsedCsv.errors[0]?.message ?? "CSV could not be parsed.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: terms, error: termError } = await supabase.from("terms").select("id, name");
  if (termError) {
    throw new Error(termError.message);
  }
  const termIdByName = new Map((terms ?? []).map((term) => [String(term.name).toLowerCase(), String(term.id)]));

  const rows = parsedCsv.data
    .filter((row) => csvValue(row, "first_name") && csvValue(row, "last_name") && csvValue(row, "email"))
    .map((row, index) => {
      const startTermName = csvValue(row, "start_term_name").toLowerCase();
      const temporaryId = csvValue(row, "temporary_id") || `BETAR-TMP-${Date.now()}-${index + 1}`;
      return studentSchema.parse({
        cccu_student_id: csvValue(row, "cccu_student_id") || null,
        temporary_id: temporaryId,
        first_name: csvValue(row, "first_name"),
        last_name: csvValue(row, "last_name"),
        email: csvValue(row, "email"),
        phone: csvValue(row, "phone") || null,
        status: csvValue(row, "status") || "prospect",
        admission_stage: csvValue(row, "admission_stage") || "interest",
        programme: csvValue(row, "programme") || "pgcert",
        start_term_id: startTermName ? (termIdByName.get(startTermName) ?? null) : null,
        notes: csvValue(row, "notes") || null
      });
    });

  if (rows.length === 0) {
    throw new Error("No valid admissions rows found. Include first_name, last_name, and email.");
  }

  const { error } = await supabase.from("students").upsert(rows, { onConflict: "temporary_id" });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath("/admissions");
  redirect("/admissions?mode=edit");
}

const enrolmentSchema = z.object({
  student_id: z.string().uuid(),
  offering_id: z.string().uuid(),
  status: z.enum(["planned", "in_progress", "completed", "failed", "deferred", "resit", "did_not_complete"]),
  credits_awarded: z.coerce.number().int().nonnegative(),
  attendance_days_required_override: z.coerce.number().int().nonnegative().nullable(),
  presentation_required_override: z.boolean().nullable()
});

export async function createEnrolment(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = enrolmentSchema.parse({
    student_id: value(formData, "student_id"),
    offering_id: value(formData, "offering_id"),
    status: value(formData, "status"),
    credits_awarded: value(formData, "credits_awarded") || "0",
    attendance_days_required_override: optionalValue(formData, "attendance_days_required_override"),
    presentation_required_override: optionalBoolean(formData, "presentation_required_override")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("enrolments").insert(parsed);
  if (error) {
    if (isMissingEnrolmentRequirementColumnError(error)) {
      const fallback = enrolmentSchema.omit({
        attendance_days_required_override: true,
        presentation_required_override: true
      }).parse(parsed);
      const { error: retryError } = await supabase.from("enrolments").insert(fallback);
      if (!retryError) {
        revalidatePath("/students");
        revalidatePath(`/students/${parsed.student_id}`);
        return;
      }
      throw new Error(retryError.message);
    }
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${parsed.student_id}`);
}

export async function updateEnrolment(formData: FormData) {
  await requirePermission("manage_course");
  const enrolmentId = idSchema.parse(value(formData, "enrolment_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));
  const parsed = enrolmentSchema.pick({ status: true, credits_awarded: true }).parse({
    status: value(formData, "status"),
    credits_awarded: value(formData, "credits_awarded") || "0"
  });
  const requirementOverrides = enrolmentSchema
    .pick({ attendance_days_required_override: true, presentation_required_override: true })
    .parse({
      attendance_days_required_override: optionalValue(formData, "attendance_days_required_override"),
      presentation_required_override: optionalBoolean(formData, "presentation_required_override")
    });

  const finalMark = optionalValue(formData, "final_mark");
  const grade = optionalValue(formData, "grade");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("enrolments")
    .update({
      ...parsed,
      ...requirementOverrides,
      final_mark: finalMark ? Number(finalMark) : null,
      grade
    })
    .eq("id", enrolmentId);
  if (error) {
    if (isMissingEnrolmentRequirementColumnError(error)) {
      const { error: retryError } = await supabase
        .from("enrolments")
        .update({
          ...parsed,
          final_mark: finalMark ? Number(finalMark) : null,
          grade
        })
        .eq("id", enrolmentId);
      if (!retryError) {
        revalidatePath("/students");
        revalidatePath(`/students/${studentId}`);
        return;
      }
      throw new Error(retryError.message);
    }
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
}

export async function deleteEnrolment(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const enrolmentId = idSchema.parse(value(formData, "enrolment_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("enrolments").delete().eq("id", enrolmentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
}

function optionalPoundsToPence(input: string): number | null {
  return input.length > 0 ? poundsToPence(input) : null;
}

const financeSchema = z.object({
  student_id: z.string().uuid(),
  term_id: z.string().uuid(),
  expected_amount_pence: z.number().int().nonnegative(),
  invoice_status: z.enum(["not_requested", "requested", "sent", "corrected"]),
  invoice_amount_pence: z.number().int().nonnegative().nullable(),
  payment_status: z.enum(["not_due", "outstanding", "paid", "disputed"]),
  paid_amount_pence: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable()
});

function parseFinanceForm(formData: FormData) {
  return financeSchema.parse({
    student_id: value(formData, "student_id"),
    term_id: value(formData, "term_id"),
    expected_amount_pence: poundsToPence(value(formData, "expected_amount")),
    invoice_status: value(formData, "invoice_status") || "not_requested",
    invoice_amount_pence: optionalPoundsToPence(value(formData, "invoice_amount")),
    payment_status: value(formData, "payment_status"),
    paid_amount_pence: optionalPoundsToPence(value(formData, "paid_amount")),
    notes: optionalValue(formData, "notes")
  });
}

export async function createFinanceRecord(formData: FormData) {
  await requirePermission("manage_finance");
  const parsed = parseFinanceForm(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("finance_records").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/finance");
  revalidatePath(`/students/${parsed.student_id}`);
  redirect("/finance?mode=edit");
}

export async function updateFinanceRecord(formData: FormData) {
  await requirePermission("manage_finance");
  const financeRecordId = idSchema.parse(value(formData, "finance_record_id"));
  const parsed = parseFinanceForm(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("finance_records").update(parsed).eq("id", financeRecordId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/finance");
  revalidatePath(`/students/${parsed.student_id}`);
  redirect("/finance?mode=edit");
}

export async function deleteFinanceRecord(formData: FormData) {
  await requirePermission("manage_finance");
  requireDeleteConfirmation(formData);
  const financeRecordId = idSchema.parse(value(formData, "finance_record_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("finance_records").delete().eq("id", financeRecordId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/finance");
  revalidatePath(`/students/${studentId}`);
  redirect("/finance?mode=edit");
}

export async function saveStudentProfileFinance(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  if (profile.role !== "admin") {
    throw new Error("Only admins can amend finance.");
  }

  const studentId = idSchema.parse(value(formData, "student_id"));
  const rowKeys = formData.getAll("finance_row_key").map(String);
  const createKeys = new Set(formData.getAll("finance_create_key").map(String));

  const supabase = await createSupabaseServerClient();
  const { data: enrolments, error: enrolmentsError } = await supabase
    .from("enrolments")
    .select("offering_id")
    .eq("student_id", studentId);
  if (enrolmentsError) {
    throw new Error(enrolmentsError.message);
  }

  const offeringIds = [...new Set((enrolments ?? []).map((enrolment) => String(enrolment.offering_id)))];
  const { data: offerings, error: offeringsError } =
    offeringIds.length > 0
      ? await supabase.from("module_offerings").select("term_id").in("id", offeringIds)
      : { data: [], error: null };
  if (offeringsError) {
    throw new Error(offeringsError.message);
  }

  const eligibleTermIds = new Set((offerings ?? []).map((offering) => String(offering.term_id)));

  for (const rowKey of rowKeys) {
    const recordId = optionalValue(formData, `finance_record_id_${rowKey}`);
    const termId = idSchema.parse(value(formData, `finance_term_id_${rowKey}`));
    if (!recordId && !createKeys.has(rowKey)) {
      continue;
    }

    const parsed = financeSchema.parse({
      student_id: studentId,
      term_id: termId,
      expected_amount_pence: poundsToPence(value(formData, `finance_expected_amount_${rowKey}`)),
      invoice_status: value(formData, `finance_invoice_status_${rowKey}`) || "not_requested",
      invoice_amount_pence: optionalPoundsToPence(value(formData, `finance_invoice_amount_${rowKey}`)),
      payment_status: value(formData, `finance_payment_status_${rowKey}`),
      paid_amount_pence: optionalPoundsToPence(value(formData, `finance_paid_amount_${rowKey}`)),
      notes: optionalValue(formData, `finance_notes_${rowKey}`)
    });

    if (recordId) {
      const { error } = await supabase
        .from("finance_records")
        .update(parsed)
        .eq("id", idSchema.parse(recordId))
        .eq("student_id", studentId);
      if (error) {
        throw new Error(error.message);
      }
      continue;
    }

    if (!eligibleTermIds.has(termId)) {
      throw new Error("Finance records can only be created for this student's enrolled terms.");
    }

    const { error } = await supabase.from("finance_records").insert(parsed);
    if (error) {
      throw new Error(error.message);
    }
  }

  revalidateStudentFinance(studentId);
  redirect(`/students/${studentId}?mode=edit`);
}

export async function importExamResultsJson(formData: FormData) {
  await requirePermission("manage_course");
  const rawJson = value(formData, "exam_results_json");
  if (!rawJson) {
    throw new Error("Paste exam adapter JSON before importing.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    throw new Error("Exam results JSON is not valid.");
  }

  const parsed = parseExamAdapterPayload(payload);
  const data = await getLmsData();
  const normalized = parsed.map((result) => normalizeInboundExamResult(result, data));
  const supabase = await createSupabaseServerClient();
  const acceptedResults = await persistNormalizedExamResults(supabase, normalized);
  const statusUpdates = await syncEnrolmentStatusesForExamResults(supabase, data, acceptedResults);

  revalidatePath("/exams");
  if (statusUpdates.length > 0) {
    revalidatePath("/");
    revalidatePath("/students");
  }
  parsed.forEach((result) => {
    const student = data.students.find((candidate) => {
      const cccuMatch = result.cccuStudentId && candidate.cccuStudentId === result.cccuStudentId;
      const tempMatch = result.temporaryId && candidate.temporaryId === result.temporaryId;
      return cccuMatch || tempMatch;
    });
    if (student) {
      revalidatePath(`/students/${student.id}`);
    }
  });
  statusUpdates.forEach((update) => revalidatePath(`/students/${update.studentId}`));
  redirect("/exams?mode=edit");
}

export async function createManualOverallExamResult(formData: FormData) {
  await requirePermission("manage_course");
  const studentId = idSchema.parse(value(formData, "student_id"));
  const offeringId = idSchema.parse(value(formData, "offering_id"));
  const score = z.coerce.number().min(0).max(100).parse(value(formData, "score"));
  const passMark = z.coerce.number().min(0).max(100).parse(value(formData, "pass_mark") || "50");
  const takenOn = z.string().min(1).parse(value(formData, "taken_on"));
  const attemptNumber = z.coerce.number().int().positive().parse(value(formData, "attempt_number") || "1");
  const data = await getLmsData();
  const student = data.students.find((candidate) => candidate.id === studentId);
  const offering = data.offerings.find((candidate) => candidate.id === offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  if (!student || !offering || !courseModule) {
    throw new Error("Student, offering, or module could not be found.");
  }
  if (courseModule.mode !== "online") {
    throw new Error("Manual overall scores can only be entered for online/coursework modules.");
  }
  if (!data.enrolments.some((enrolment) => enrolment.studentId === studentId && enrolment.offeringId === offeringId)) {
    throw new Error("This student is not enrolled on the selected module offering.");
  }

  const passed = score >= passMark;
  const result = {
    id: `exam-manual-overall-${studentId}-${offeringId}-${attemptNumber}`,
    studentId,
    offeringId,
    componentType: "theory" as const,
    sourceSystem: "manual" as const,
    sourceAttemptId: `manual-overall:${studentId}:${offeringId}:attempt-${attemptNumber}`,
    score,
    passMark,
    passed,
    resitRequired: !passed,
    isResit: attemptNumber > 1,
    attemptNumber,
    resitOfResultId: undefined,
    priorAttemptMissing: attemptNumber > 1,
    takenOn,
    importedAt: new Date().toISOString()
  };

  const supabase = await createSupabaseServerClient();
  await persistNormalizedExamResults(supabase, [{ ok: true, result }]);
  const statusUpdates = await syncEnrolmentStatusesForExamResults(supabase, data, [result]);

  revalidatePath("/exams");
  revalidatePath("/");
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  statusUpdates.forEach((update) => revalidatePath(`/students/${update.studentId}`));
  redirect("/exams?mode=edit");
}

export async function importPracticalExamResultsCsv(formData: FormData) {
  await requirePermission("manage_course");
  const termId = idSchema.parse(value(formData, "term_id"));
  const takenOn = value(formData, "taken_on");
  const passMark = Number(value(formData, "pass_mark") || "50");
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a practical results CSV file to import.");
  }
  if (!takenOn) {
    throw new Error("Choose the practical exam date.");
  }
  if (!Number.isFinite(passMark) || passMark < 0 || passMark > 100) {
    throw new Error("Pass mark must be a number from 0 to 100.");
  }

  const csv = await file.text();
  const parsedCsv = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true
  });
  if (parsedCsv.errors.length > 0) {
    throw new Error(parsedCsv.errors[0]?.message ?? "CSV could not be parsed.");
  }

  const data = await getLmsData();
  const term = data.terms.find((candidate) => candidate.id === termId);
  if (!term) {
    throw new Error("Selected term was not found.");
  }

  const moduleCodeMap = parsePracticalModuleCodeMap(value(formData, "module_code_map"));
  const parsed = practicalCsvRowsToInboundExamResults(parsedCsv.data, {
    termName: term.name,
    takenOn,
    passMark,
    moduleCodeMap
  });
  if (parsed.length === 0) {
    throw new Error("No practical result rows found in the CSV.");
  }

  const normalized = parsed.map((result) => normalizeInboundExamResult(result, data));
  const supabase = await createSupabaseServerClient();
  const acceptedResults = await persistNormalizedExamResults(supabase, normalized);
  const statusUpdates = await syncEnrolmentStatusesForExamResults(supabase, data, acceptedResults);

  revalidatePath("/exams");
  if (statusUpdates.length > 0) {
    revalidatePath("/");
    revalidatePath("/students");
  }
  normalized.forEach((result) => {
    if (result.ok) {
      revalidatePath(`/students/${result.result.studentId}`);
    }
  });
  statusUpdates.forEach((update) => revalidatePath(`/students/${update.studentId}`));
  const accepted = normalized.filter((result) => result.ok).length;
  const rejected = normalized.length - accepted;
  redirect(`/exams?mode=edit&practicalAccepted=${accepted}&practicalRejected=${rejected}`);
}

const examPortalMappingSchema = z.object({
  portal_exam_id: z.string().min(1).max(160),
  exam_title: z.string().nullable(),
  term_id: z.string().uuid(),
  module_id: z.string().uuid().nullable(),
  component_type: z.enum(["theory", "practical"]),
  portal_exam_kind: z.enum(["module_theory", "physics_equipment"]),
  physics_required: z.boolean(),
  active: z.boolean()
}).refine((mapping) => {
  if (mapping.portal_exam_kind === "physics_equipment") {
    return mapping.module_id === null;
  }
  return mapping.module_id !== null;
}, {
  message: "Module theory mappings require a module; physics/equipment mappings must not have one.",
  path: ["module_id"]
});

function selectedExamPortalMapping(formData: FormData): { portalExamId: string; examTitle: string | null } {
  const selectedExam = optionalValue(formData, "portal_exam_selection");
  if (!selectedExam) {
    return {
      portalExamId: value(formData, "portal_exam_id"),
      examTitle: optionalValue(formData, "exam_title")
    };
  }

  const parsed = z.object({
    exam_id: z.string().min(1).max(160),
    exam_title: z.string().nullable().optional()
  }).parse(JSON.parse(selectedExam));

  return {
    portalExamId: parsed.exam_id,
    examTitle: parsed.exam_title ?? null
  };
}

function parseExamPortalMapping(formData: FormData) {
  const selectedExam = selectedExamPortalMapping(formData);
  return examPortalMappingSchema.parse({
    portal_exam_id: selectedExam.portalExamId,
    exam_title: selectedExam.examTitle,
    term_id: value(formData, "term_id"),
    module_id: optionalValue(formData, "module_id"),
    component_type: "theory",
    portal_exam_kind: value(formData, "portal_exam_kind") || "module_theory",
    physics_required: formData.get("physics_required") === "on",
    active: formData.get("active") === "on"
  });
}

export async function createExamPortalMapping(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = parseExamPortalMapping(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("exam_portal_mappings").insert(parsed);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/exams");
  redirect("/exams?mode=edit");
}

export async function updateExamPortalMapping(formData: FormData) {
  await requirePermission("manage_course");
  const mappingId = idSchema.parse(value(formData, "mapping_id"));
  const parsed = parseExamPortalMapping(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("exam_portal_mappings").update(parsed).eq("id", mappingId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/exams");
  redirect("/exams?mode=edit");
}

const examPortalResultSchema = z.object({
  token_id: z.string().min(1),
  token: z.string().nullable().optional(),
  lms_student_id: z.string().min(1).nullable().optional(),
  lms_course_id: z.string().nullable().optional(),
  student_name: z.string().min(1),
  session_id: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().min(1),
  answered: z.number().int().nonnegative().nullable().optional(),
  score: z.number().nonnegative(),
  total: z.number().positive(),
  percentage: z.number().min(0).max(100),
  integrity_event_count: z.number().int().nonnegative().default(0)
});

const examPortalResponseSchema = z.object({
  exam_id: z.string().min(1),
  exam_title: z.string().nullable().optional(),
  released: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  available_for_lms: z.boolean().optional(),
  submissions_reviewed_at: z.string().nullable().optional(),
  result_count: z.number().int().nonnegative().optional(),
  results: z.array(examPortalResultSchema).optional()
});

async function fetchExamPortalResults(portalExamId: string) {
  const endpoint = process.env.EXAM_PORTAL_LMS_RESULTS_URL;
  const secret = process.env.EXAM_PORTAL_LMS_API_SECRET;
  if (!endpoint || !secret) {
    throw new Error("Set EXAM_PORTAL_LMS_RESULTS_URL and EXAM_PORTAL_LMS_API_SECRET in the LMS backend environment.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ exam_id: portalExamId }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Exam Portal sync failed with HTTP ${response.status}.`);
  }

  const parsed = examPortalResponseSchema.parse(await response.json());
  const results = parsed.results ?? [];

  return {
    ...parsed,
    released: parsed.released ?? false,
    available_for_lms: parsed.available_for_lms ?? parsed.released ?? false,
    result_count: parsed.result_count ?? results.length,
    results
  };
}

type PortalSubmissionRow = {
  id: string;
  mapping_id: string;
  cccu_student_id: string | null;
  student_id: string | null;
  token_id: string;
  source_session_id: string | null;
  completed_at: string | null;
  percentage: number;
};

type ExamResultUpsertRow = {
  student_id: string;
  offering_id: string;
  component_type: "theory";
  source_system: "theory_portal";
  source_attempt_id: string;
  score: number;
  pass_mark: number;
  passed: boolean;
  resit_required: boolean;
  is_resit: boolean;
  attempt_number: number;
  resit_of_result_id: string | null;
  prior_attempt_missing: boolean;
  taken_on: string;
  imported_at: string;
};

type TheoryRecomputeIssue = {
  status: "missing_offering" | "missing_original_offering" | "missing_physics";
  message: string;
};

function cccuIdFromPortalResult(result: z.infer<typeof examPortalResultSchema>): string | null {
  if (result.lms_student_id) {
    return result.lms_student_id.trim();
  }

  const embeddedId = result.student_name.match(/(?:^|\D)(\d{9})(?:\D|$)/);
  return embeddedId?.[1] ?? null;
}

function submissionMatchKey(row: Pick<PortalSubmissionRow, "cccu_student_id" | "student_id">): string | null {
  if (row.cccu_student_id) {
    return `cccu:${row.cccu_student_id}`;
  }
  if (row.student_id) {
    return `student:${row.student_id}`;
  }
  return null;
}

function latestSubmissionByStudent(rows: PortalSubmissionRow[]): Map<string, PortalSubmissionRow> {
  const latest = new Map<string, PortalSubmissionRow>();
  rows.forEach((row) => {
    const key = submissionMatchKey(row);
    if (!key) {
      return;
    }
    const existing = latest.get(key);
    if (!existing || String(row.completed_at ?? "") > String(existing.completed_at ?? "")) {
      latest.set(key, row);
    }
  });
  return latest;
}

async function recomputeTheoryResultsForTerm(termId: string): Promise<Map<string, TheoryRecomputeIssue>> {
  const supabase = await createSupabaseServerClient();
  const data = await getLmsData();
  const { data: mappings, error: mappingsError } = await supabase
    .from("exam_portal_mappings")
    .select("id, portal_exam_id, module_id, portal_exam_kind, physics_required")
    .eq("term_id", termId)
    .eq("active", true);
  if (mappingsError) {
    throw new Error(mappingsError.message);
  }

  const moduleMappings = (mappings ?? []).filter((mapping) => mapping.portal_exam_kind === "module_theory" && mapping.module_id);
  const physicsMappings = (mappings ?? []).filter((mapping) => mapping.portal_exam_kind === "physics_equipment");
  const issuesByMapping = new Map<string, TheoryRecomputeIssue>();
  if (moduleMappings.length === 0) {
    return issuesByMapping;
  }

  const mappingIds = (mappings ?? []).map((mapping) => String(mapping.id));
  const { data: submissions, error: submissionsError } = await supabase
    .from("exam_portal_submissions")
    .select("id, mapping_id, cccu_student_id, student_id, token_id, source_session_id, completed_at, percentage")
    .in("mapping_id", mappingIds);
  if (submissionsError) {
    throw new Error(submissionsError.message);
  }

  const submissionsByMapping = new Map<string, PortalSubmissionRow[]>();
  ((submissions ?? []) as PortalSubmissionRow[]).forEach((submission) => {
    submissionsByMapping.set(submission.mapping_id, [...(submissionsByMapping.get(submission.mapping_id) ?? []), submission]);
  });

  const latestPhysicsByStudent = latestSubmissionByStudent(
    physicsMappings.flatMap((mapping) => submissionsByMapping.get(String(mapping.id)) ?? [])
  );

  const rows: ExamResultUpsertRow[] = [];
  const missingPhysicsByMapping = new Map<string, number>();
  const missingOriginalOfferingByMapping = new Map<string, number>();
  for (const mapping of moduleMappings) {
    const latestModuleByStudent = latestSubmissionByStudent(submissionsByMapping.get(String(mapping.id)) ?? []);
    latestModuleByStudent.forEach((moduleSubmission) => {
      if (!moduleSubmission.student_id) {
        return;
      }
      const matchKey = submissionMatchKey(moduleSubmission);
      if (!matchKey) {
        return;
      }
      const physicsSubmission = latestPhysicsByStudent.get(matchKey);
      if (mapping.physics_required && !physicsSubmission) {
        missingPhysicsByMapping.set(String(mapping.id), (missingPhysicsByMapping.get(String(mapping.id)) ?? 0) + 1);
        return;
      }
      const finalPercentage = mapping.physics_required
        ? (Number(moduleSubmission.percentage) + Number(physicsSubmission?.percentage ?? 0)) / 2
        : Number(moduleSubmission.percentage);
      const sourceAttemptId = `${mapping.portal_exam_id}:${moduleSubmission.token_id}`;
      const resolved = resolveExamResultForStudent(
        {
          studentId: moduleSubmission.student_id,
          moduleId: String(mapping.module_id),
          sittingTermId: termId,
          componentType: "theory",
          sourceSystem: "theory_portal",
          sourceAttemptId,
          score: Number(finalPercentage.toFixed(2)),
          passMark: 50,
          takenOn: String(moduleSubmission.completed_at).slice(0, 10)
        },
        data
      );
      if (!resolved.ok) {
        missingOriginalOfferingByMapping.set(String(mapping.id), (missingOriginalOfferingByMapping.get(String(mapping.id)) ?? 0) + 1);
        return;
      }
      rows.push({
        student_id: resolved.result.studentId,
        offering_id: resolved.result.offeringId,
        component_type: "theory",
        source_system: "theory_portal",
        source_attempt_id: resolved.result.sourceAttemptId,
        score: resolved.result.score,
        pass_mark: resolved.result.passMark,
        passed: resolved.result.passed,
        resit_required: resolved.result.resitRequired,
        is_resit: resolved.result.isResit,
        attempt_number: resolved.result.attemptNumber,
        resit_of_result_id: resolved.result.resitOfResultId ?? null,
        prior_attempt_missing: resolved.result.priorAttemptMissing,
        taken_on: resolved.result.takenOn,
        imported_at: resolved.result.importedAt
      });
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("exam_results").upsert(rows, { onConflict: "source_system,source_attempt_id" });
    if (error) {
      throw new Error(error.message);
    }
    await syncEnrolmentStatusesForExamResults(
      supabase,
      data,
      rows.map((row) => ({
        id: `exam-${row.source_attempt_id}`,
        studentId: row.student_id,
        offeringId: row.offering_id,
        componentType: row.component_type,
        sourceSystem: row.source_system,
        sourceAttemptId: row.source_attempt_id,
        score: row.score,
        passMark: row.pass_mark,
        passed: row.passed,
        resitRequired: row.resit_required,
        isResit: row.is_resit,
        attemptNumber: row.attempt_number,
        resitOfResultId: row.resit_of_result_id ?? undefined,
        priorAttemptMissing: row.prior_attempt_missing,
        takenOn: row.taken_on,
        importedAt: row.imported_at
      }))
    );
  }

  for (const [mappingId, count] of missingPhysicsByMapping.entries()) {
    issuesByMapping.set(mappingId, {
      status: "missing_physics",
      message: `${count} module submissions are missing a physics/equipment score.`
    });
  }
  for (const [mappingId, count] of missingOriginalOfferingByMapping.entries()) {
    issuesByMapping.set(mappingId, {
      status: "missing_original_offering",
      message: `${count} matched submissions have no same-term enrolment or earlier enrolment for this mapped module, so exam results were not created for those submissions.`
    });
  }

  for (const [mappingId, issue] of issuesByMapping.entries()) {
    const { error } = await supabase
      .from("exam_portal_mappings")
      .update({
        last_sync_status: issue.status,
        last_sync_message: issue.message
      })
      .eq("id", mappingId);
    if (error) {
      throw new Error(error.message);
    }
  }

  return issuesByMapping;
}

export async function syncExamPortalMapping(formData: FormData) {
  await requirePermission("manage_course");
  const mappingId = idSchema.parse(value(formData, "mapping_id"));
  const supabase = await createSupabaseServerClient();

  const { data: mapping, error: mappingError } = await supabase
    .from("exam_portal_mappings")
    .select("*")
    .eq("id", mappingId)
    .single();
  if (mappingError) {
    throw new Error(mappingError.message);
  }

  const portalResponse = await fetchExamPortalResults(String(mapping.portal_exam_id));
  if (!portalResponse.available_for_lms) {
    const { error } = await supabase
      .from("exam_portal_mappings")
      .update({
        exam_title: portalResponse.exam_title ?? mapping.exam_title,
        last_synced_at: new Date().toISOString(),
        last_sync_status: "not_available_for_lms",
        last_sync_message: "Exam Portal has not marked this exam as reviewed/available for LMS import."
      })
      .eq("id", mappingId);
    if (error) {
      throw new Error(error.message);
    }
    revalidatePath("/exams");
    redirect("/exams?mode=edit");
  }

  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("id, cccu_student_id");
  if (studentsError) {
    throw new Error(studentsError.message);
  }
  const studentIdByCccu = new Map(
    (students ?? [])
      .filter((student) => typeof student.cccu_student_id === "string" && student.cccu_student_id.length > 0)
      .map((student) => [String(student.cccu_student_id), String(student.id)])
  );

  const submissionRows = portalResponse.results.map((result) => {
    const cccuStudentId = cccuIdFromPortalResult(result);
    return {
      mapping_id: mappingId,
      portal_exam_id: portalResponse.exam_id,
      token_id: result.token_id,
      token: result.token ?? null,
      cccu_student_id: cccuStudentId,
      student_id: cccuStudentId ? (studentIdByCccu.get(cccuStudentId) ?? null) : null,
      student_name: result.student_name,
      source_session_id: result.session_id ?? null,
      started_at: result.started_at ?? null,
      completed_at: result.completed_at,
      answered: result.answered ?? null,
      score: result.score,
      total: result.total,
      percentage: result.percentage,
      integrity_event_count: result.integrity_event_count
    };
  });

  if (submissionRows.length > 0) {
    const { error: submissionsError } = await supabase
      .from("exam_portal_submissions")
      .upsert(submissionRows, { onConflict: "portal_exam_id,token_id" });
    if (submissionsError) {
      throw new Error(submissionsError.message);
    }
  }

  const recomputeIssues = await recomputeTheoryResultsForTerm(String(mapping.term_id));

  const unmatched = submissionRows.filter((row) => row.student_id === null).length;
  const recomputeIssue = recomputeIssues.get(mappingId);
  const syncStatus = recomputeIssue?.status ?? (unmatched > 0 ? "imported_with_unmatched_students" : "imported");
  const syncMessage = recomputeIssue
    ? `${submissionRows.length} submissions imported. ${recomputeIssue.message}${unmatched > 0 ? ` ${unmatched} unmatched CCCU IDs.` : ""}`
    : `${submissionRows.length} submissions imported. ${unmatched} unmatched CCCU IDs.`;
  const { error: updateError } = await supabase
    .from("exam_portal_mappings")
    .update({
      exam_title: portalResponse.exam_title ?? mapping.exam_title,
      last_synced_at: new Date().toISOString(),
      last_sync_status: syncStatus,
      last_sync_message: syncMessage
    })
    .eq("id", mappingId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath("/exams");
  revalidatePath("/");
  revalidatePath("/students");
  redirect("/exams?mode=edit");
}

export async function resolveExamPortalSubmission(formData: FormData) {
  await requirePermission("manage_course");
  const submissionId = idSchema.parse(value(formData, "submission_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));
  const supabase = await createSupabaseServerClient();

  const { data: submission, error: submissionError } = await supabase
    .from("exam_portal_submissions")
    .select("id, mapping_id, cccu_student_id")
    .eq("id", submissionId)
    .single();
  if (submissionError) {
    throw new Error(submissionError.message);
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, cccu_student_id")
    .eq("id", studentId)
    .single();
  if (studentError) {
    throw new Error(studentError.message);
  }

  const { data: mapping, error: mappingError } = await supabase
    .from("exam_portal_mappings")
    .select("id, term_id")
    .eq("id", submission.mapping_id)
    .single();
  if (mappingError) {
    throw new Error(mappingError.message);
  }

  const { error: updateError } = await supabase
    .from("exam_portal_submissions")
    .update({
      student_id: student.id,
      cccu_student_id: student.cccu_student_id ?? submission.cccu_student_id
    })
    .eq("id", submissionId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  const recomputeIssues = await recomputeTheoryResultsForTerm(String(mapping.term_id));

  const { data: submissions, error: countError } = await supabase
    .from("exam_portal_submissions")
    .select("id, student_id")
    .eq("mapping_id", mapping.id);
  if (countError) {
    throw new Error(countError.message);
  }

  const imported = submissions?.length ?? 0;
  const unmatched = (submissions ?? []).filter((row) => !row.student_id).length;
  const recomputeIssue = recomputeIssues.get(String(mapping.id));
  const { error: mappingUpdateError } = await supabase
    .from("exam_portal_mappings")
    .update({
      last_sync_status: recomputeIssue?.status ?? (unmatched > 0 ? "imported_with_unmatched_students" : "imported"),
      last_sync_message: recomputeIssue
        ? `${imported} submissions imported. ${recomputeIssue.message}${unmatched > 0 ? ` ${unmatched} unmatched CCCU IDs.` : ""}`
        : `${imported} submissions imported. ${unmatched} unmatched CCCU IDs.`
    })
    .eq("id", mapping.id);
  if (mappingUpdateError) {
    throw new Error(mappingUpdateError.message);
  }

  revalidatePath("/exams");
  revalidatePath("/");
  revalidatePath("/students");
  revalidatePath(`/students/${student.id}`);
  redirect("/exams?mode=edit");
}

export async function generateFinanceRecordsForTerm(formData: FormData) {
  await requirePermission("manage_finance");
  const termId = idSchema.parse(value(formData, "term_id"));

  const supabase = await createSupabaseServerClient();
  const { data: offerings, error: offeringsError } = await supabase
    .from("module_offerings")
    .select("id, price_pence")
    .eq("term_id", termId);
  if (offeringsError) {
    throw new Error(offeringsError.message);
  }

  const offeringPriceById = new Map((offerings ?? []).map((offering) => [String(offering.id), Number(offering.price_pence)]));
  const offeringIds = [...offeringPriceById.keys()];
  if (offeringIds.length === 0) {
    revalidatePath("/finance");
    redirect("/finance?mode=edit");
    return;
  }

  const { data: enrolments, error: enrolmentsError } = await supabase
    .from("enrolments")
    .select("student_id, offering_id, status")
    .in("offering_id", offeringIds);
  if (enrolmentsError) {
    throw new Error(enrolmentsError.message);
  }

  const expectedByStudent = new Map<string, number>();
  (enrolments ?? [])
    .filter((enrolment) => enrolment.status !== "deferred")
    .forEach((enrolment) => {
      const studentId = String(enrolment.student_id);
      expectedByStudent.set(
        studentId,
        (expectedByStudent.get(studentId) ?? 0) + (offeringPriceById.get(String(enrolment.offering_id)) ?? 0)
      );
    });

  if (expectedByStudent.size === 0) {
    revalidatePath("/finance");
    redirect("/finance?mode=edit");
    return;
  }

  const { error } = await supabase.from("finance_records").upsert(
    [...expectedByStudent.entries()].map(([studentId, expectedAmountPence]) => ({
      student_id: studentId,
      term_id: termId,
      expected_amount_pence: expectedAmountPence
    })),
    { onConflict: "student_id,term_id" }
  );
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/finance");
  [...expectedByStudent.keys()].forEach((studentId) => revalidatePath(`/students/${studentId}`));
  redirect("/finance?mode=edit");
}

const attendanceSessionSchema = z.object({
  term_id: z.string().uuid(),
  session_date: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  location: z.string().min(2).max(160)
});

function selectedStudentIds(formData: FormData): string[] {
  return formData
    .getAll("expected_student_ids")
    .map((entryValue) => String(entryValue).trim())
    .filter(Boolean);
}

async function replaceExpectedAttendance(sessionId: string, studentIds: string[]) {
  const supabase = await createSupabaseServerClient();
  const uniqueStudentIds = [...new Set(studentIds)];

  const { error: deleteError } = await supabase.from("expected_attendance").delete().eq("session_id", sessionId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (uniqueStudentIds.length === 0) {
    return;
  }

  const { error } = await supabase.from("expected_attendance").insert(
    uniqueStudentIds.map((studentId) => ({
      session_id: sessionId,
      student_id: studentId
    }))
  );
  if (error) {
    throw new Error(error.message);
  }
}

export async function createAttendanceSession(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = attendanceSessionSchema.parse({
    term_id: value(formData, "term_id"),
    session_date: value(formData, "session_date"),
    starts_at: value(formData, "starts_at"),
    ends_at: value(formData, "ends_at"),
    location: value(formData, "location")
  });

  const expectedStudentIds = selectedStudentIds(formData);

  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from("attendance_sessions")
    .insert({
      ...parsed,
      offering_id: null
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(error.message);
  }

  await replaceExpectedAttendance(String(session.id), expectedStudentIds);

  revalidatePath("/attendance");
  revalidatePath("/reception");
}

export async function updateAttendanceSession(formData: FormData) {
  await requirePermission("manage_course");
  const sessionId = idSchema.parse(value(formData, "session_id"));
  const parsed = attendanceSessionSchema.parse({
    term_id: value(formData, "term_id"),
    session_date: value(formData, "session_date"),
    starts_at: value(formData, "starts_at"),
    ends_at: value(formData, "ends_at"),
    location: value(formData, "location")
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("attendance_sessions").update(parsed).eq("id", sessionId);
  if (error) {
    throw new Error(error.message);
  }

  if (formData.has("expected_student_ids")) {
    await replaceExpectedAttendance(sessionId, selectedStudentIds(formData));
  }

  revalidatePath("/attendance");
  revalidatePath("/reception");
}

export async function deleteAttendanceSession(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const sessionId = idSchema.parse(value(formData, "session_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("attendance_sessions").delete().eq("id", sessionId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/attendance");
  revalidatePath("/reception");
}

const adminAttendanceRecordSchema = z.object({
  session_id: z.string().uuid(),
  student_id: z.string().uuid().optional(),
  student_lookup: z.string().optional(),
  expected: z.boolean(),
  status: z.enum(["attended", "partial", "missed"]).optional(),
  admin_note: z.string().max(500).nullable()
});

async function resolveAttendanceStudentId(
  parsed: z.infer<typeof adminAttendanceRecordSchema>,
  supabase?: Awaited<ReturnType<typeof createSupabaseServerClient>>
): Promise<string> {
  if (parsed.student_id) {
    return parsed.student_id;
  }

  const lookup = parsed.student_lookup?.trim();
  if (!lookup) {
    throw new Error("Select a student before saving attendance.");
  }

  const uuidResult = z.string().uuid().safeParse(lookup);
  if (uuidResult.success) {
    return uuidResult.data;
  }

  const client = supabase ?? (await createSupabaseServerClient());
  const { data, error } = await client
    .from("students")
    .select("id, first_name, last_name, cccu_student_id, temporary_id");
  if (error) {
    throw new Error(error.message);
  }

  const normalizedLookup = lookup.toLowerCase();
  const match = (data ?? []).find((student) => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    return (
      String(student.cccu_student_id ?? "").toLowerCase() === normalizedLookup ||
      String(student.temporary_id ?? "").toLowerCase() === normalizedLookup ||
      fullName === normalizedLookup
    );
  });
  if (!match) {
    throw new Error("Student could not be found.");
  }

  return String(match.id);
}

function revalidateAttendance(studentId?: string) {
  revalidatePath("/");
  revalidatePath("/attendance");
  revalidatePath("/reception");
  if (studentId) {
    revalidatePath(`/students/${studentId}`);
  }
}

function revalidateStudentFinance(studentId: string) {
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
}

function missingAdminNoteColumn(message: string): boolean {
  return message.includes("'admin_note' column") || message.includes("attendance_records.admin_note");
}

async function persistAdminAttendanceRecord({
  parsed,
  profileId,
  supabase
}: {
  parsed: z.infer<typeof adminAttendanceRecordSchema>;
  profileId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  const studentId = await resolveAttendanceStudentId(parsed, supabase);
  const expected = parsed.status === "missed" ? true : parsed.expected;

  if (expected) {
    const { error } = await supabase.from("expected_attendance").upsert({
      session_id: parsed.session_id,
      student_id: studentId
    });
    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from("expected_attendance")
      .delete()
      .eq("session_id", parsed.session_id)
      .eq("student_id", studentId);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (!parsed.status) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("session_id", parsed.session_id)
      .eq("student_id", studentId);
    if (error) {
      throw new Error(error.message);
    }
    return studentId;
  }

  const attendancePayload = {
    session_id: parsed.session_id,
    student_id: studentId,
    status: parsed.status,
    recorded_by_user_id: profileId
  };
  const { error } = await supabase.from("attendance_records").upsert(
    {
      ...attendancePayload,
      admin_note: parsed.admin_note
    },
    {
      onConflict: "session_id,student_id"
    }
  );
  if (error && missingAdminNoteColumn(error.message)) {
    const { error: retryError } = await supabase.from("attendance_records").upsert(attendancePayload, {
      onConflict: "session_id,student_id"
    });
    if (retryError) {
      throw new Error(retryError.message);
    }
    return studentId;
  }
  if (error) {
    throw new Error(error.message);
  }

  return studentId;
}

export async function saveAdminAttendanceRecord(formData: FormData) {
  const profile = await requirePermission("manage_course");
  if (profile.role !== "admin") {
    throw new Error("Only admins can amend attendance.");
  }

  const parsed = adminAttendanceRecordSchema.parse({
    session_id: value(formData, "session_id"),
    student_id: optionalValue(formData, "student_id") ?? undefined,
    student_lookup: optionalValue(formData, "student_lookup") ?? undefined,
    expected: formData.get("expected") === "on",
    status: optionalValue(formData, "status") ?? undefined,
    admin_note: optionalValue(formData, "admin_note")
  });
  const supabase = await createSupabaseServerClient();
  const studentId = await persistAdminAttendanceRecord({ parsed, profileId: profile.id, supabase });

  revalidateAttendance(studentId);
}

export async function deleteAdminAttendanceRecord(formData: FormData) {
  const profile = await requirePermission("manage_course");
  if (profile.role !== "admin") {
    throw new Error("Only admins can delete attendance.");
  }
  requireDeleteConfirmation(formData);
  const sessionId = idSchema.parse(value(formData, "session_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));
  const supabase = await createSupabaseServerClient();

  const { error: recordError } = await supabase
    .from("attendance_records")
    .delete()
    .eq("session_id", sessionId)
    .eq("student_id", studentId);
  if (recordError) {
    throw new Error(recordError.message);
  }

  const { error: expectedError } = await supabase
    .from("expected_attendance")
    .delete()
    .eq("session_id", sessionId)
    .eq("student_id", studentId);
  if (expectedError) {
    throw new Error(expectedError.message);
  }

  revalidateAttendance(studentId);
}

const profileAttendanceStatusSchema = z.enum(["", "expected", "attended", "partial", "missed"]);

export async function saveStudentProfileAttendance(formData: FormData) {
  const profile = await requirePermission("manage_course");
  if (profile.role !== "admin") {
    throw new Error("Only admins can amend attendance.");
  }

  const studentId = idSchema.parse(value(formData, "student_id"));
  const sessionIds = formData.getAll("attendance_session_id").map((entry) => idSchema.parse(String(entry)));
  const statuses = formData.getAll("attendance_status").map((entry) => profileAttendanceStatusSchema.parse(String(entry)));
  const deleteSessionIds = new Set(formData.getAll("attendance_delete_session_id").map((entry) => idSchema.parse(String(entry))));

  if (sessionIds.length !== statuses.length) {
    throw new Error("Attendance form rows are incomplete.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: enrolments, error: enrolmentsError } = await supabase
    .from("enrolments")
    .select("offering_id")
    .eq("student_id", studentId);
  if (enrolmentsError) {
    throw new Error(enrolmentsError.message);
  }

  const offeringIds = [...new Set((enrolments ?? []).map((enrolment) => String(enrolment.offering_id)))];
  if (offeringIds.length === 0 && sessionIds.length > 0) {
    throw new Error("This student has no enrolment terms with teaching sessions.");
  }

  const { data: offerings, error: offeringsError } =
    offeringIds.length > 0
      ? await supabase.from("module_offerings").select("term_id").in("id", offeringIds)
      : { data: [], error: null };
  if (offeringsError) {
    throw new Error(offeringsError.message);
  }

  const termIds = [...new Set((offerings ?? []).map((offering) => String(offering.term_id)))];
  const { data: sessions, error: sessionsError } =
    termIds.length > 0
      ? await supabase.from("attendance_sessions").select("id").in("term_id", termIds)
      : { data: [], error: null };
  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const eligibleSessionIds = new Set((sessions ?? []).map((session) => String(session.id)));
  for (const sessionId of [...sessionIds, ...deleteSessionIds]) {
    if (!eligibleSessionIds.has(sessionId)) {
      throw new Error("Attendance can only be edited for teaching sessions in this student's enrolled terms.");
    }
  }

  for (const [index, sessionId] of sessionIds.entries()) {
    const status = statuses[index];
    const deleteRow = deleteSessionIds.has(sessionId);

    if (deleteRow) {
      const { error: recordError } = await supabase
        .from("attendance_records")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (recordError) {
        throw new Error(recordError.message);
      }
      const { error: expectedError } = await supabase
        .from("expected_attendance")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (expectedError) {
        throw new Error(expectedError.message);
      }
      continue;
    }

    if (!status) {
      const { error: recordError } = await supabase
        .from("attendance_records")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (recordError) {
        throw new Error(recordError.message);
      }
      const { error: expectedError } = await supabase
        .from("expected_attendance")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (expectedError) {
        throw new Error(expectedError.message);
      }
      continue;
    }

    if (status === "expected") {
      const { error: expectedError } = await supabase.from("expected_attendance").upsert({
        session_id: sessionId,
        student_id: studentId
      });
      if (expectedError) {
        throw new Error(expectedError.message);
      }
      const { error: recordError } = await supabase
        .from("attendance_records")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (recordError) {
        throw new Error(recordError.message);
      }
      continue;
    }

    if (status === "missed") {
      const { error: expectedError } = await supabase.from("expected_attendance").upsert({
        session_id: sessionId,
        student_id: studentId
      });
      if (expectedError) {
        throw new Error(expectedError.message);
      }
    } else {
      const { error: expectedError } = await supabase
        .from("expected_attendance")
        .delete()
        .eq("session_id", sessionId)
        .eq("student_id", studentId);
      if (expectedError) {
        throw new Error(expectedError.message);
      }
    }

    const { error } = await supabase.from("attendance_records").upsert(
      {
        session_id: sessionId,
        student_id: studentId,
        status,
        recorded_by_user_id: profile.id
      },
      {
        onConflict: "session_id,student_id"
      }
    );
    if (error) {
      throw new Error(error.message);
    }
  }

  revalidateAttendance(studentId);
  redirect(`/students/${studentId}?mode=edit`);
}

export async function checkInStudent(formData: FormData) {
  const profile = await requirePermission("use_reception");
  const sessionId = idSchema.parse(value(formData, "session_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));
  const supabase = await createSupabaseServerClient();

  const { data: expected, error: expectedError } = await supabase
    .from("expected_attendance")
    .select("session_id")
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (expectedError) {
    throw new Error(expectedError.message);
  }
  if (!expected) {
    throw new Error("Student is not expected for this session.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("attendance_records")
    .select("id, checked_in_at")
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    if (!existing.checked_in_at) {
      const { error } = await supabase
        .from("attendance_records")
        .update({
          status: "attended",
          checked_in_at: new Date().toISOString(),
          recorded_by_user_id: profile.id
        })
        .eq("id", existing.id);
      if (error) {
        throw new Error(error.message);
      }
    }
  } else {
    const { error } = await supabase.from("attendance_records").insert({
      session_id: sessionId,
      student_id: studentId,
      status: "attended",
      checked_in_at: new Date().toISOString(),
      recorded_by_user_id: profile.id
    });
    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/attendance");
  revalidatePath("/reception");
  revalidatePath(`/students/${studentId}`);
}

export async function checkOutStudent(formData: FormData) {
  const profile = await requirePermission("use_reception");
  const sessionId = idSchema.parse(value(formData, "session_id"));
  const studentId = idSchema.parse(value(formData, "student_id"));

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("attendance_records")
    .select("checked_in_at")
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (existingError) {
    throw new Error(existingError.message);
  }

  const checkedOutAt = new Date();
  const checkedInAt = existing?.checked_in_at ? new Date(String(existing.checked_in_at)) : null;
  const threeHoursMs = 3 * 60 * 60 * 1000;
  const status =
    checkedInAt && checkedOutAt.getTime() - checkedInAt.getTime() <= threeHoursMs ? "partial" : "attended";

  const { error } = await supabase
    .from("attendance_records")
    .update({
      status,
      checked_out_at: checkedOutAt.toISOString(),
      recorded_by_user_id: profile.id
    })
    .eq("session_id", sessionId)
    .eq("student_id", studentId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/attendance");
  revalidatePath("/reception");
  revalidatePath(`/students/${studentId}`);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createEncounterLog(formData: FormData) {
  const profile = await requirePermission("record_teaching");
  const parsed = z
    .object({
      student_id: z.string().uuid(),
      offering_id: z.string().uuid(),
      occurred_on: z.string().min(1),
      summary: z.string().min(1),
      concern_level: z.enum(["none", "watch", "support_needed"])
    })
    .parse({
      student_id: value(formData, "student_id"),
      offering_id: value(formData, "offering_id"),
      occurred_on: value(formData, "occurred_on") || todayIsoDate(),
      summary: value(formData, "summary"),
      concern_level: value(formData, "concern_level") || "none"
    });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("encounter_logs").insert({
    ...parsed,
    staff_user_id: profile.id
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/staff");
  revalidatePath(`/students/${parsed.student_id}`);
}

export async function createAssessmentAttempt(formData: FormData) {
  const profile = await requirePermission("record_teaching");
  const definitionId = idSchema.parse(value(formData, "definition_id"));
  const assessedItemIds = formData
    .getAll("assessed_item_ids")
    .map((entryValue) => String(entryValue).trim())
    .filter(Boolean);

  const parsed = z
    .object({
      student_id: z.string().uuid(),
      offering_id: z.string().uuid(),
      occurred_on: z.string().min(1),
      overall_score: z.coerce.number().int(),
      comments: z.string().nullable()
    })
    .parse({
      student_id: value(formData, "student_id"),
      offering_id: value(formData, "offering_id"),
      occurred_on: value(formData, "occurred_on") || todayIsoDate(),
      overall_score: value(formData, "overall_score"),
      comments: optionalValue(formData, "comments")
    });

  const supabase = await createSupabaseServerClient();
  const { data: definition, error: definitionError } = await supabase
    .from("assessment_definitions")
    .select("score_min, score_max, domains")
    .eq("id", definitionId)
    .single();
  if (definitionError) {
    throw new Error(definitionError.message);
  }

  const allowedItemIds = new Set(
    Array.isArray(definition.domains)
      ? definition.domains
          .map((domain) => (typeof domain === "object" && domain !== null && "id" in domain ? String(domain.id) : ""))
          .filter(Boolean)
      : []
  );
  if (assessedItemIds.length === 0) {
    throw new Error("Select at least one assessed item.");
  }
  if (assessedItemIds.some((itemId) => !allowedItemIds.has(itemId))) {
    throw new Error("One or more assessed items are not configured for this assessment.");
  }
  if (parsed.overall_score < Number(definition.score_min) || parsed.overall_score > Number(definition.score_max)) {
    throw new Error(`Overall score must be between ${definition.score_min} and ${definition.score_max}.`);
  }

  const { error } = await supabase.from("assessment_attempts").insert({
    ...parsed,
    definition_id: definitionId,
    staff_user_id: profile.id,
    assessed_item_ids: assessedItemIds,
    scores: {}
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/staff");
  revalidatePath(`/students/${parsed.student_id}`);
}

export async function createPresentationScore(formData: FormData) {
  const profile = await requirePermission("record_teaching");
  const scoreSchema = z.coerce.number().int().min(1).max(5);
  const scores = Object.fromEntries(
    presentationRubricCriteria.map((criterion) => [criterion.id, scoreSchema.parse(value(formData, criterion.id))])
  );
  const totalScore = Object.values(scores).reduce((total, score) => total + score, 0);

  const parsed = z
    .object({
      student_id: z.string().uuid(),
      offering_id: z.string().uuid(),
      occurred_on: z.string().min(1),
      presentation_type: z.enum(["case_presentation", "journal_club"]),
      duration_minutes: z.coerce.number().int().positive(),
      comments: z.string().nullable()
    })
    .parse({
      student_id: value(formData, "student_id"),
      offering_id: value(formData, "offering_id"),
      occurred_on: value(formData, "occurred_on") || todayIsoDate(),
      presentation_type: value(formData, "presentation_type"),
      duration_minutes: value(formData, "duration_minutes"),
      comments: optionalValue(formData, "comments")
    });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("presentation_scores").insert({
    ...parsed,
    staff_user_id: profile.id,
    scores,
    total_score: totalScore
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/staff");
  revalidatePath(`/students/${parsed.student_id}`);
}

function parseAssessmentDomains(formData: FormData) {
  const domains = Array.from({ length: 8 }, (_, index) => {
    const slot = index + 1;
    const label = value(formData, `domain_${slot}_label`);
    if (!label) {
      return null;
    }
    return {
      id:
        optionalValue(formData, `domain_${slot}_id`) ??
        `${label
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40)}_${slot}`,
      label,
      required: true
    };
  }).filter(Boolean);

  return z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(120),
        required: z.boolean()
      })
    )
    .min(1)
    .max(8)
    .parse(domains);
}

const assessmentDefinitionSchema = z.object({
  module_id: z.string().uuid(),
  name: z.string().min(2).max(160),
  score_min: z.coerce.number().int(),
  score_max: z.coerce.number().int(),
  active: z.boolean()
}).refine((definition) => definition.score_min < definition.score_max, {
  message: "Minimum score must be lower than maximum score.",
  path: ["score_max"]
});

export async function createAssessmentDefinition(formData: FormData) {
  await requirePermission("manage_course");
  const parsed = assessmentDefinitionSchema.parse({
    module_id: value(formData, "module_id"),
    name: value(formData, "name"),
    score_min: value(formData, "score_min"),
    score_max: value(formData, "score_max"),
    active: formData.get("active") === "on"
  });
  const domains = parseAssessmentDomains(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("assessment_definitions").insert({
    ...parsed,
    domains
  });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/course");
  revalidatePath("/staff");
}

export async function updateAssessmentDefinition(formData: FormData) {
  await requirePermission("manage_course");
  const definitionId = idSchema.parse(value(formData, "definition_id"));
  const parsed = assessmentDefinitionSchema.parse({
    module_id: value(formData, "module_id"),
    name: value(formData, "name"),
    score_min: value(formData, "score_min"),
    score_max: value(formData, "score_max"),
    active: formData.get("active") === "on"
  });
  const domains = parseAssessmentDomains(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("assessment_definitions")
    .update({
      ...parsed,
      domains
    })
    .eq("id", definitionId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/course");
  revalidatePath("/staff");
}

export async function deleteAssessmentDefinition(formData: FormData) {
  await requirePermission("manage_course");
  requireDeleteConfirmation(formData);
  const definitionId = idSchema.parse(value(formData, "definition_id"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("assessment_definitions").delete().eq("id", definitionId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/course");
  revalidatePath("/staff");
}
