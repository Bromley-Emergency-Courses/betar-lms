"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requirePermission } from "@/lib/auth";
import { parseAdmissionsEmailPilotActionForm } from "@/lib/admissions-email-pilot";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export interface AdmissionsEmailPilotActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

function revalidatePilotSurfaces(recordType: "new_applicant" | "returning_student", entityId: string) {
  revalidatePath("/admissions");
  revalidatePath("/admissions/new-students");
  revalidatePath("/admissions/returning-students");
  if (recordType === "new_applicant") revalidatePath(`/admissions/new-students/${entityId}`);
}

export async function manageAdmissionsEmailPilotRecord(
  _previousState: AdmissionsEmailPilotActionState,
  formData: FormData
): Promise<AdmissionsEmailPilotActionState> {
  await requirePermission("manage_admissions");

  let parsed;
  try {
    parsed = parseAdmissionsEmailPilotActionForm(formData);
  } catch (error) {
    if (error instanceof ZodError) {
      return { status: "error", message: error.issues[0]?.message ?? "Check the pilot-record details." };
    }
    throw error;
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "success",
      message: parsed.intent === "mark" ? "Pilot marker simulated in demo mode." : "Pilot marker removal simulated in demo mode."
    };
  }

  const supabase = await createSupabaseServerClient();
  if (parsed.intent === "mark") {
    const rpcName = parsed.record_type === "new_applicant"
      ? "mark_fake_admission_lead_for_email_pilot"
      : "mark_fake_student_for_email_pilot";
    const rpcArguments = parsed.record_type === "new_applicant"
      ? { p_admission_lead_id: parsed.entity_id, p_label: parsed.label, p_reason: parsed.reason }
      : { p_student_id: parsed.entity_id, p_label: parsed.label, p_reason: parsed.reason };
    const { error } = await supabase.rpc(rpcName, rpcArguments);
    if (error) return { status: "error", message: error.message };
  } else {
    const entityColumn = parsed.record_type === "new_applicant" ? "admission_lead_id" : "student_id";
    const markerResult = await supabase
      .from("admissions_email_test_records")
      .select("id")
      .eq("id", parsed.test_record_id)
      .eq(entityColumn, parsed.entity_id)
      .eq("record_type", parsed.record_type)
      .maybeSingle();
    if (markerResult.error) return { status: "error", message: markerResult.error.message };
    if (!markerResult.data) return { status: "error", message: "The pilot marker no longer belongs to this record." };

    const { error } = await supabase.rpc("unmark_admissions_email_test_record", {
      p_test_record_id: parsed.test_record_id,
      p_reason: parsed.reason
    });
    if (error) return { status: "error", message: error.message };
  }

  revalidatePilotSurfaces(parsed.record_type, parsed.entity_id);
  return {
    status: "success",
    message: parsed.intent === "mark"
      ? "This record is now marked for the controlled email pilot."
      : "The email-pilot marker has been removed."
  };
}
