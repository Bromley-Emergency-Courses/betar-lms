"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildApplicationDocumentObjectPath,
  getApplicationDocumentSlotDefinition,
  parseApplicationDocumentUploadForm,
  validateApplicationDocumentUpload
} from "@/lib/application-documents";
import {
  parseApplicationCorrectionDocumentUploadForm,
  parseResubmitApplicationCorrectionsForm,
  parseSaveApplicationCorrectionResponseForm
} from "@/lib/application-corrections";
import { parseApplicationDraftForm } from "@/lib/application-drafts";
import {
  findUnsavedApplicationDraftChanges,
  getClientIpAddress,
  parseSubmitApplicationForm,
  type ApplicationSubmitSavedDraftSnapshot
} from "@/lib/application-submit";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

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

export async function uploadApplicationDocument(formData: FormData) {
  const profile = await requireApplicantProfile("/apply/application");
  const parsed = parseApplicationDocumentUploadForm(formData);
  const file = formData.get("document");

  if (!(file instanceof File)) {
    throw new Error("Choose a file to upload.");
  }

  const definition = getApplicationDocumentSlotDefinition(parsed.slot_key);
  const validation = validateApplicationDocumentUpload({ file, slotKey: parsed.slot_key });
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?document=demo");
  }

  if (!isSupabaseServiceRoleConfigured()) {
    throw new Error("Supabase service role storage is required for application document uploads.");
  }

  const supabase = await createSupabaseServerClient();
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const objectPath = buildApplicationDocumentObjectPath(
    profile.personId,
    parsed.application_id,
    parsed.slot_key,
    validation.sanitizedFilename,
    randomUUID()
  );

  const { error: uploadError } = await supabaseAdmin.storage.from(definition.bucket).upload(objectPath, file, {
    contentType: validation.contentType,
    upsert: false
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { error: recordError } = await supabase.rpc("record_application_document_upload", {
    p_application_id: parsed.application_id,
    p_slot_key: parsed.slot_key,
    p_bucket: definition.bucket,
    p_object_path: objectPath,
    p_original_filename: file.name,
    p_sanitized_filename: validation.sanitizedFilename,
    p_content_type: validation.contentType,
    p_size_bytes: file.size
  });

  if (recordError) {
    await supabaseAdmin.storage.from(definition.bucket).remove([objectPath]);
    throw new Error(recordError.message);
  }

  revalidatePath("/apply/application");
  redirect("/apply/application?document=uploaded");
}

export async function uploadApplicationCorrectionDocument(formData: FormData) {
  const profile = await requireApplicantProfile("/apply/application");
  const parsed = parseApplicationCorrectionDocumentUploadForm(formData);
  const file = formData.get("document");

  if (!(file instanceof File)) {
    throw new Error("Choose a replacement file to upload.");
  }

  const definition = getApplicationDocumentSlotDefinition(parsed.slot_key);
  const validation = validateApplicationDocumentUpload({ file, slotKey: parsed.slot_key });
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?correction_document=demo");
  }

  if (!isSupabaseServiceRoleConfigured()) {
    throw new Error("Supabase service role storage is required for correction document uploads.");
  }

  const supabase = await createSupabaseServerClient();
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const objectPath = buildApplicationDocumentObjectPath(
    profile.personId,
    parsed.application_id,
    parsed.slot_key,
    validation.sanitizedFilename,
    randomUUID()
  );

  const { error: uploadError } = await supabaseAdmin.storage.from(definition.bucket).upload(objectPath, file, {
    contentType: validation.contentType,
    upsert: false
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { error: recordError } = await supabase.rpc("record_application_correction_document_upload", {
    p_item_id: parsed.item_id,
    p_bucket: definition.bucket,
    p_object_path: objectPath,
    p_original_filename: file.name,
    p_sanitized_filename: validation.sanitizedFilename,
    p_content_type: validation.contentType,
    p_size_bytes: file.size,
    p_response_note: parsed.response_note
  });

  if (recordError) {
    await supabaseAdmin.storage.from(definition.bucket).remove([objectPath]);
    throw new Error(recordError.message);
  }

  revalidatePath("/apply/application");
  revalidatePath("/admissions/reviews");
  redirect("/apply/application?correction_document=uploaded");
}

export async function submitApplication(formData: FormData) {
  await requireApplicantProfile("/apply/application");
  const parsed = parseSubmitApplicationForm(formData);
  const currentDraft = parseApplicationDraftForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?submitted=demo");
  }

  const headerStore = await headers();
  const supabase = await createSupabaseServerClient();

  const [applicationResult, choiceResult, supportNeedsResult] = await Promise.all([
    supabase
      .from("applications")
      .select(
        `
          admission_lead_id,
          programme,
          intended_start_term_id,
          title,
          first_name,
          middle_names,
          last_name,
          preferred_name,
          previous_surname,
          date_of_birth,
          previous_study_detail,
          partner_student_id,
          email,
          phone,
          address_line_1,
          address_line_2,
          city,
          postcode,
          country,
          clinical_role,
          employer,
          department_specialty,
          professional_registration_body,
          professional_registration_number,
          highest_qualification,
          qualification_awarding_body,
          qualification_year,
          qualification_result,
          qualification_country,
          work_experience,
          nationality,
          country_of_birth,
          country_of_residence,
          needs_visa_check,
          visa_notes,
          funding_source,
          funding_organisation,
          funding_contact,
          pocus_previous_experience,
          pocus_motivation,
          pocus_case_improved_management,
          pocus_limitations_case,
          evidence_summary
        `
      )
      .eq("id", parsed.application_id)
      .maybeSingle(),
    supabase
      .from("application_module_offering_choices")
      .select("offering_id")
      .eq("application_id", parsed.application_id)
      .order("choice_order"),
    supabase
      .from("application_support_needs")
      .select("disclosed, support_detail, requested_adjustments")
      .eq("application_id", parsed.application_id)
      .maybeSingle()
  ]);

  if (applicationResult.error) {
    throw new Error(applicationResult.error.message);
  }
  if (choiceResult.error) {
    throw new Error(choiceResult.error.message);
  }
  if (supportNeedsResult.error) {
    throw new Error(supportNeedsResult.error.message);
  }
  if (!applicationResult.data) {
    throw new Error("Application was not found for this applicant.");
  }

  const application = applicationResult.data;
  const supportNeeds = supportNeedsResult.data;
  const savedDraft: ApplicationSubmitSavedDraftSnapshot = {
    admission_lead_id: String(application.admission_lead_id),
    programme: application.programme === "microcredential" ? "microcredential" : "pgcert",
    intended_start_term_id: application.intended_start_term_id ? String(application.intended_start_term_id) : null,
    selected_module_offering_ids: (choiceResult.data ?? []).map((row) => String(row.offering_id)),
    title: application.title,
    first_name: application.first_name,
    middle_names: application.middle_names,
    last_name: application.last_name,
    preferred_name: application.preferred_name,
    previous_surname: application.previous_surname,
    date_of_birth: application.date_of_birth,
    previous_study_detail: application.previous_study_detail,
    partner_student_id: application.partner_student_id,
    email: application.email,
    phone: application.phone,
    address_line_1: application.address_line_1,
    address_line_2: application.address_line_2,
    city: application.city,
    postcode: application.postcode,
    country: application.country,
    clinical_role: application.clinical_role,
    employer: application.employer,
    department_specialty: application.department_specialty,
    professional_registration_body: application.professional_registration_body,
    professional_registration_number: application.professional_registration_number,
    highest_qualification: application.highest_qualification,
    qualification_awarding_body: application.qualification_awarding_body,
    qualification_year: application.qualification_year,
    qualification_result: application.qualification_result,
    qualification_country: application.qualification_country,
    work_experience: application.work_experience,
    nationality: application.nationality,
    country_of_birth: application.country_of_birth,
    country_of_residence: application.country_of_residence,
    needs_visa_check: Boolean(application.needs_visa_check),
    visa_notes: application.visa_notes,
    funding_source:
      application.funding_source === "self_funded" ||
      application.funding_source === "employer_sponsor" ||
      application.funding_source === "nhs_trust" ||
      application.funding_source === "other"
        ? application.funding_source
        : "unknown",
    funding_organisation: application.funding_organisation,
    funding_contact: application.funding_contact,
    support_needs_disclosed: Boolean(supportNeeds?.disclosed),
    support_needs_detail: supportNeeds?.support_detail ?? null,
    support_needs_adjustments: supportNeeds?.requested_adjustments ?? null,
    pocus_previous_experience: application.pocus_previous_experience,
    pocus_motivation: application.pocus_motivation,
    pocus_case_improved_management: application.pocus_case_improved_management,
    pocus_limitations_case: application.pocus_limitations_case,
    evidence_summary: application.evidence_summary
  };

  const changedFields = findUnsavedApplicationDraftChanges(currentDraft, savedDraft);
  if (changedFields.length > 0) {
    throw new Error("Save your latest changes before submitting your application.");
  }

  const { error } = await supabase.rpc("submit_application", {
    p_application_id: parsed.application_id,
    p_declaration_accepted: parsed.declaration_accepted,
    p_ip_address: getClientIpAddress(headerStore),
    p_user_agent: headerStore.get("user-agent")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/apply/application");
  redirect("/apply/application?submitted=1");
}

export async function saveApplicationCorrectionResponse(formData: FormData) {
  await requireApplicantProfile("/apply/application");
  const parsed = parseSaveApplicationCorrectionResponseForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?correction_saved=demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_application_correction_response", {
    p_item_id: parsed.item_id,
    p_proposed_value: parsed.proposed_value ?? null,
    p_replacement_managed_file_id: parsed.replacement_managed_file_id,
    p_response_note: parsed.response_note,
    p_clear_value: parsed.clear_value
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/apply/application");
  revalidatePath("/admissions/reviews");
  redirect("/apply/application?correction_saved=1");
}

export async function resubmitApplicationCorrections(formData: FormData) {
  await requireApplicantProfile("/apply/application");
  const parsed = parseResubmitApplicationCorrectionsForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/apply/application?correction_submitted=demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resubmit_application_corrections", {
    p_request_id: parsed.request_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/apply/application");
  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  redirect("/apply/application?correction_submitted=1");
}
