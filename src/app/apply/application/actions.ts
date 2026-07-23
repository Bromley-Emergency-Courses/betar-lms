"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseApplicationDraftForm } from "@/lib/application-drafts";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export async function saveApplicationDraft(formData: FormData) {
  await requireApplicantProfile("/apply/application");
  const parsed = parseApplicationDraftForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?saved=demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_application_draft", {
    p_admission_lead_id: parsed.admission_lead_id,
    p_programme: parsed.programme,
    p_module_interest_ids: parsed.module_interest_ids,
    p_clinical_role: parsed.clinical_role,
    p_employer: parsed.employer,
    p_professional_registration: parsed.professional_registration,
    p_highest_qualification: parsed.highest_qualification,
    p_qualification_awarding_body: parsed.qualification_awarding_body,
    p_qualification_year: parsed.qualification_year,
    p_work_experience: parsed.work_experience,
    p_personal_statement: parsed.personal_statement
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/apply/application");
  redirect("/apply/application?saved=1");
}
