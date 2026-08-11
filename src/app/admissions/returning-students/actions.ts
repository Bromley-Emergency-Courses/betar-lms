"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import {
  parseAddReturningStudentCycleParticipantForm,
  parseConfigureReturningStudentCycleStatusGroupsForm,
  parseCreateReturningStudentCycleForm,
  parseReturningStudentCycleActionForm,
  parseReturningStudentCycleParticipantActionForm,
  parseReturningStudentCyclePlannedCapacityForm
} from "@/lib/returning-student-cycles";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function cycleRedirect(cycleId: string | null, result: string): never {
  const query = new URLSearchParams({ [result]: "1" });
  if (cycleId) query.set("cycle", cycleId);
  redirect(`/admissions/returning-students?${query.toString()}`);
}

function revalidateReturningStudentCycle() {
  revalidatePath("/admissions/returning-students");
  revalidatePath("/admissions");
}

export async function createReturningStudentCycle(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseCreateReturningStudentCycleForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(null, "created_demo");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_returning_student_cycle", {
    p_target_term_id: parsed.target_term_id,
    p_status_groups: parsed.status_groups
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(String(data), "created");
}

export async function configureReturningStudentCycleStatusGroups(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseConfigureReturningStudentCycleStatusGroupsForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, "configured_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("configure_returning_student_cycle_status_groups", {
    p_cycle_id: parsed.cycle_id,
    p_status_groups: parsed.status_groups
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, "configured");
}

async function runCycleAction(
  formData: FormData,
  rpcName:
    | "apply_returning_student_cycle_eligibility_refresh"
    | "refresh_returning_student_cycle_offerings"
    | "open_returning_student_cycle"
    | "begin_returning_student_cycle_review",
  result: string
) {
  await requirePermission("manage_admissions");
  const parsed = parseReturningStudentCycleActionForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, `${result}_demo`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(rpcName, { p_cycle_id: parsed.cycle_id });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, result);
}

export async function applyReturningStudentEligibilityRefresh(formData: FormData) {
  return runCycleAction(formData, "apply_returning_student_cycle_eligibility_refresh", "eligibility_refreshed");
}

export async function refreshReturningStudentCycleOfferings(formData: FormData) {
  return runCycleAction(formData, "refresh_returning_student_cycle_offerings", "offerings_refreshed");
}

export async function openReturningStudentCycle(formData: FormData) {
  return runCycleAction(formData, "open_returning_student_cycle", "opened");
}

export async function beginReturningStudentCycleReview(formData: FormData) {
  return runCycleAction(formData, "begin_returning_student_cycle_review", "review_started");
}

export async function addReturningStudentCycleParticipant(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseAddReturningStudentCycleParticipantForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, "participant_added_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_returning_student_cycle_participant", {
    p_cycle_id: parsed.cycle_id,
    p_student_id: parsed.student_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, "participant_added");
}

export async function removeReturningStudentCycleParticipant(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseReturningStudentCycleParticipantActionForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, "participant_removed_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_returning_student_cycle_participant", {
    p_participant_id: parsed.participant_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, "participant_removed");
}

export async function confirmReturningStudentAdditionalStudy(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseReturningStudentCycleParticipantActionForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, "additional_study_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("confirm_returning_student_additional_study", {
    p_participant_id: parsed.participant_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, "additional_study_confirmed");
}

export async function setReturningStudentCyclePlannedCapacity(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseReturningStudentCyclePlannedCapacityForm(formData);

  if (!isSupabaseConfigured()) cycleRedirect(parsed.cycle_id, "capacity_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_returning_cycle_offering_planned_capacity", {
    p_cycle_offering_id: parsed.cycle_offering_id,
    p_planned_capacity: parsed.planned_capacity,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateReturningStudentCycle();
  cycleRedirect(parsed.cycle_id, "capacity_updated");
}
