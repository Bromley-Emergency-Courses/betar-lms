"use server";

import { redirect } from "next/navigation";
import { parsePublicEnquiryForm } from "@/lib/admissions-enquiry";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export async function submitPublicEnquiry(formData: FormData) {
  const parsed = parsePublicEnquiryForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/apply?submitted=1&demo=1");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_public_admission_enquiry", {
    p_first_name: parsed.first_name,
    p_last_name: parsed.last_name,
    p_email: parsed.email,
    p_phone: parsed.phone,
    p_programme: parsed.programme,
    p_module_interest_ids: parsed.module_interest_ids,
    p_notes: parsed.notes
  });

  if (error) {
    throw new Error(error.message);
  }

  redirect("/apply?submitted=1");
}
