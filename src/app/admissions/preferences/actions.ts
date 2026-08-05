"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { applicationMagicLinkRedirectUrl } from "@/lib/application-invitations";
import { correspondenceEmailFailed } from "@/lib/email-delivery";
import {
  parseModulePreferenceLifecycleForm,
  parseModulePreferenceSendLinksForm,
  parseModulePreferenceWindowForm
} from "@/lib/module-preferences";
import { requirePermission } from "@/lib/auth";
import { sendPortalMagicLinkEmail } from "@/lib/portal-email";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function preferencesRedirect(result: string, windowId?: string | null): never {
  const anchor = windowId ? `#window-${windowId}` : "";
  redirect(`/admissions/preferences?${result}=1${anchor}`);
}

async function requestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function saveModulePreferenceWindow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseModulePreferenceWindowForm(formData);

  if (!isSupabaseConfigured()) {
    preferencesRedirect("saved_demo", parsed.window_id);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_or_update_module_preference_window", {
    p_window_id: parsed.window_id,
    p_term_id: parsed.term_id,
    p_title: parsed.title,
    p_opens_at: parsed.opens_at,
    p_closes_at: parsed.closes_at,
    p_offering_ids: parsed.offering_ids,
    p_notes: parsed.notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/preferences");
  revalidatePath("/portal");
  revalidatePath("/portal/module-preferences");
  preferencesRedirect("saved", String(data ?? parsed.window_id ?? ""));
}

export async function openModulePreferenceWindow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseModulePreferenceLifecycleForm(formData);

  if (!isSupabaseConfigured()) {
    preferencesRedirect("opened_demo", parsed.window_id);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("open_module_preference_window", {
    p_window_id: parsed.window_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/preferences");
  revalidatePath("/portal");
  revalidatePath("/portal/module-preferences");
  preferencesRedirect("opened", parsed.window_id);
}

export async function sendModulePreferenceWindowLinks(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseModulePreferenceSendLinksForm(formData);

  if (!isSupabaseConfigured()) {
    preferencesRedirect("links_demo", parsed.window_id);
  }

  const supabase = await createSupabaseServerClient();
  const windowResult = await supabase
    .from("module_preference_windows")
    .select("id, title, status, closes_at")
    .eq("id", parsed.window_id)
    .maybeSingle();

  if (windowResult.error) {
    throw new Error(windowResult.error.message);
  }
  if (!windowResult.data || windowResult.data.status !== "open") {
    preferencesRedirect("links_not_open", parsed.window_id);
  }

  const [studentResult, submissionResult] = await Promise.all([
    supabase
      .from("students")
      .select("id, person_id, first_name, last_name, email")
      .eq("status", "active")
      .not("person_id", "is", null)
      .order("last_name"),
    supabase.from("module_preference_submissions").select("student_id").eq("window_id", parsed.window_id)
  ]);

  if (studentResult.error) {
    throw new Error(studentResult.error.message);
  }
  if (submissionResult.error) {
    throw new Error(submissionResult.error.message);
  }

  const submittedStudentIds = new Set((submissionResult.data ?? []).map((row) => String(row.student_id)));
  const missingStudents = (studentResult.data ?? []).filter((student) => !submittedStudentIds.has(String(student.id)));
  const personIds = missingStudents.map((student) => String(student.person_id)).filter(Boolean);
  const identityResult =
    personIds.length > 0
      ? await supabase
          .from("person_auth_identities")
          .select("person_id, email")
          .eq("active", true)
          .eq("actor_type", "student")
          .in("person_id", personIds)
      : { data: [], error: null };

  if (identityResult.error) {
    throw new Error(identityResult.error.message);
  }

  const identityEmailByPersonId = new Map((identityResult.data ?? []).map((row) => [String(row.person_id), String(row.email)]));
  const origin = await requestOrigin();
  const redirectTo = applicationMagicLinkRedirectUrl(origin, "/portal/module-preferences");
  let sentCount = 0;
  let failedCount = 0;
  let disabled = false;

  for (const student of missingStudents) {
    const email = identityEmailByPersonId.get(String(student.person_id));
    if (!email) {
      failedCount += 1;
      continue;
    }

    const deliveryResult = await sendPortalMagicLinkEmail({
      email,
      recipientName: `${String(student.first_name ?? "")} ${String(student.last_name ?? "")}`.trim(),
      subject: String(windowResult.data.title ?? "BETAR module preferences"),
      templateKey: "module_preference_window_opened",
      redirectTo,
      metadata: {
        preference_window_id: parsed.window_id,
        preference_closes_at: String(windowResult.data.closes_at)
      }
    });

    if (deliveryResult.status === "disabled") {
      disabled = true;
      break;
    }

    if (correspondenceEmailFailed(deliveryResult)) {
      failedCount += 1;
    } else {
      sentCount += 1;
    }
  }

  revalidatePath("/admissions/preferences");
  revalidatePath("/portal/module-preferences");

  if (disabled) {
    preferencesRedirect("links_email_disabled", parsed.window_id);
  }

  if (failedCount > 0) {
    preferencesRedirect(sentCount > 0 ? "links_partial" : "links_failed", parsed.window_id);
  }

  preferencesRedirect("links_sent", parsed.window_id);
}

export async function closeModulePreferenceWindow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseModulePreferenceLifecycleForm(formData);

  if (!isSupabaseConfigured()) {
    preferencesRedirect("closed_demo", parsed.window_id);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("close_module_preference_window", {
    p_window_id: parsed.window_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/preferences");
  revalidatePath("/portal");
  revalidatePath("/portal/module-preferences");
  preferencesRedirect("closed", parsed.window_id);
}

export async function confirmModulePreferenceWindow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseModulePreferenceLifecycleForm(formData);

  if (!isSupabaseConfigured()) {
    preferencesRedirect("confirmed_demo", parsed.window_id);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("confirm_module_preference_window", {
    p_window_id: parsed.window_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/preferences");
  revalidatePath("/portal");
  revalidatePath("/portal/module-preferences");
  preferencesRedirect("confirmed", parsed.window_id);
}
