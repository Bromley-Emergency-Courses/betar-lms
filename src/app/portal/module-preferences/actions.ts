"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientIpAddress } from "@/lib/application-submit";
import { parseModulePreferenceSubmissionForm, type ModulePreferenceSubmissionPayload } from "@/lib/module-preferences";
import { requireStudentProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function preferenceErrorCode(message: string): string {
  if (message.includes("first preference") || message.includes("Duplicate")) {
    return "invalid_order";
  }
  if (message.includes("not open")) {
    return "closed";
  }
  if (message.includes("more than two")) {
    return "too_many";
  }
  if (message.includes("available")) {
    return "unavailable";
  }
  if (message.includes("capacity") || message.includes("full")) {
    return "full";
  }
  if (message.includes("active students")) {
    return "ineligible";
  }
  return "failed";
}

function preferenceWindowAnchor(formData: FormData): string {
  const windowId = String(formData.get("window_id") ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(windowId)
    ? `#window-${windowId}`
    : "";
}

export async function submitModulePreferences(formData: FormData) {
  await requireStudentProfile("/portal/module-preferences");
  let parsed: ModulePreferenceSubmissionPayload;
  try {
    parsed = parseModulePreferenceSubmissionForm(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    redirect(`/portal/module-preferences?preferenceError=${preferenceErrorCode(message)}${preferenceWindowAnchor(formData)}`);
  }

  if (!isSupabaseConfigured()) {
    redirect(`/portal/module-preferences?submitted=demo#window-${parsed.window_id}`);
  }

  const headerStore = await headers();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("submit_module_preferences", {
    p_window_id: parsed.window_id,
    p_offering_ids: parsed.offering_ids,
    p_skip_reason: parsed.skip_reason,
    p_submission_ip_address: getClientIpAddress(headerStore),
    p_submission_user_agent: headerStore.get("user-agent")
  });

  if (error) {
    redirect(`/portal/module-preferences?preferenceError=${preferenceErrorCode(error.message)}#window-${parsed.window_id}`);
  }

  if (!data) {
    redirect(`/portal/module-preferences?preferenceError=full#window-${parsed.window_id}`);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/module-preferences");
  redirect(`/portal/module-preferences?submitted=1#window-${parsed.window_id}`);
}
