"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildAdmissionsRegistrationDocumentObjectPath,
  getAdmissionsRegistrationDocumentSlotDefinition,
  parseAdmissionsRegistrationDocumentUploadForm,
  parseAdmissionsRegistrationDraftForm,
  parseBeginAdmissionsRegistrationForm,
  parseSubmitAdmissionsRegistrationForm,
  validateAdmissionsRegistrationDocumentUpload
} from "@/lib/admissions-registration";
import { getClientIpAddress } from "@/lib/application-submit";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

export async function beginAdmissionsRegistration(formData: FormData) {
  await requireApplicantProfile("/portal/registration");
  const parsed = parseBeginAdmissionsRegistrationForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/portal/registration?started=demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("begin_admissions_registration", {
    p_offer_id: parsed.offer_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/registration");
  redirect("/portal/registration?started=1");
}

export async function saveAdmissionsRegistration(formData: FormData) {
  await requireApplicantProfile("/portal/registration");
  const parsed = parseAdmissionsRegistrationDraftForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/portal/registration?saved=demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_admissions_registration", {
    p_registration_id: parsed.registration_id,
    p_title: parsed.title,
    p_first_name: parsed.first_name,
    p_middle_names: parsed.middle_names,
    p_last_name: parsed.last_name,
    p_preferred_name: parsed.preferred_name,
    p_previous_surname: parsed.previous_surname,
    p_date_of_birth: parsed.date_of_birth,
    p_email: parsed.email,
    p_phone: parsed.phone,
    p_address_line_1: parsed.address_line_1,
    p_address_line_2: parsed.address_line_2,
    p_city: parsed.city,
    p_postcode: parsed.postcode,
    p_country: parsed.country,
    p_module_confirmation_accepted: parsed.module_confirmation_accepted
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/registration");
  redirect("/portal/registration?saved=1");
}

export async function uploadAdmissionsRegistrationDocument(formData: FormData) {
  const profile = await requireApplicantProfile("/portal/registration");
  const parsed = parseAdmissionsRegistrationDocumentUploadForm(formData);
  const file = formData.get("document");

  if (!(file instanceof File)) {
    throw new Error("Choose a file to upload.");
  }

  const definition = getAdmissionsRegistrationDocumentSlotDefinition(parsed.slot_key);
  const validation = validateAdmissionsRegistrationDocumentUpload({ file, slotKey: parsed.slot_key });
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  if (!isSupabaseConfigured()) {
    redirect("/portal/registration?document=demo");
  }

  if (!isSupabaseServiceRoleConfigured()) {
    throw new Error("Supabase service role storage is required for registration document uploads.");
  }

  const supabase = await createSupabaseServerClient();
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const objectPath = buildAdmissionsRegistrationDocumentObjectPath(
    profile.personId,
    parsed.registration_id,
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

  const { error: recordError } = await supabase.rpc("record_admissions_registration_document_upload", {
    p_registration_id: parsed.registration_id,
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

  revalidatePath("/portal");
  revalidatePath("/portal/registration");
  redirect("/portal/registration?document=uploaded");
}

export async function submitAdmissionsRegistration(formData: FormData) {
  await requireApplicantProfile("/portal/registration");
  const parsed = parseSubmitAdmissionsRegistrationForm(formData);
  const draft = parseAdmissionsRegistrationDraftForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/portal/registration?submitted=demo");
  }

  const headerStore = await headers();
  const supabase = await createSupabaseServerClient();

  const termsResult = await supabase
    .from("admissions_registration_terms_versions")
    .select("version, terms_hash")
    .eq("active", true)
    .maybeSingle();

  if (termsResult.error) {
    throw new Error(termsResult.error.message);
  }
  if (!termsResult.data) {
    throw new Error("No active registration terms version is configured.");
  }

  const { error: saveError } = await supabase.rpc("save_admissions_registration", {
    p_registration_id: draft.registration_id,
    p_title: draft.title,
    p_first_name: draft.first_name,
    p_middle_names: draft.middle_names,
    p_last_name: draft.last_name,
    p_preferred_name: draft.preferred_name,
    p_previous_surname: draft.previous_surname,
    p_date_of_birth: draft.date_of_birth,
    p_email: draft.email,
    p_phone: draft.phone,
    p_address_line_1: draft.address_line_1,
    p_address_line_2: draft.address_line_2,
    p_city: draft.city,
    p_postcode: draft.postcode,
    p_country: draft.country,
    p_module_confirmation_accepted: draft.module_confirmation_accepted
  });

  if (saveError) {
    throw new Error(saveError.message);
  }

  const { error } = await supabase.rpc("submit_admissions_registration", {
    p_registration_id: parsed.registration_id,
    p_terms_accepted: parsed.terms_accepted,
    p_terms_version: String(termsResult.data.version),
    p_terms_hash: String(termsResult.data.terms_hash),
    p_ip_address: getClientIpAddress(headerStore),
    p_user_agent: headerStore.get("user-agent")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/registration");
  redirect("/portal/registration?submitted=1");
}
