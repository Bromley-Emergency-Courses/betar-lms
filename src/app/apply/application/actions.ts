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
    p_intended_start_term_id: parsed.intended_start_term_id,
    p_selected_module_offering_ids: parsed.selected_module_offering_ids,
    p_title: parsed.title,
    p_first_name: parsed.first_name,
    p_middle_names: parsed.middle_names,
    p_last_name: parsed.last_name,
    p_preferred_name: parsed.preferred_name,
    p_previous_surname: parsed.previous_surname,
    p_date_of_birth: parsed.date_of_birth,
    p_previous_study_detail: parsed.previous_study_detail,
    p_partner_student_id: parsed.partner_student_id,
    p_email: parsed.email,
    p_phone: parsed.phone,
    p_address_line_1: parsed.address_line_1,
    p_address_line_2: parsed.address_line_2,
    p_city: parsed.city,
    p_postcode: parsed.postcode,
    p_country: parsed.country,
    p_clinical_role: parsed.clinical_role,
    p_employer: parsed.employer,
    p_department_specialty: parsed.department_specialty,
    p_professional_registration_body: parsed.professional_registration_body,
    p_professional_registration_number: parsed.professional_registration_number,
    p_highest_qualification: parsed.highest_qualification,
    p_qualification_awarding_body: parsed.qualification_awarding_body,
    p_qualification_year: parsed.qualification_year,
    p_qualification_result: parsed.qualification_result,
    p_qualification_country: parsed.qualification_country,
    p_work_experience: parsed.work_experience,
    p_nationality: parsed.nationality,
    p_country_of_birth: parsed.country_of_birth,
    p_country_of_residence: parsed.country_of_residence,
    p_needs_visa_check: parsed.needs_visa_check,
    p_visa_notes: parsed.visa_notes,
    p_funding_source: parsed.funding_source,
    p_funding_organisation: parsed.funding_organisation,
    p_funding_contact: parsed.funding_contact,
    p_support_needs_disclosed: parsed.support_needs_disclosed,
    p_support_needs_detail: parsed.support_needs_detail,
    p_support_needs_adjustments: parsed.support_needs_adjustments,
    p_pocus_previous_experience: parsed.pocus_previous_experience,
    p_pocus_motivation: parsed.pocus_motivation,
    p_pocus_case_improved_management: parsed.pocus_case_improved_management,
    p_pocus_limitations_case: parsed.pocus_limitations_case,
    p_evidence_summary: parsed.evidence_summary
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/apply/application");
  redirect("/apply/application?saved=1");
}
