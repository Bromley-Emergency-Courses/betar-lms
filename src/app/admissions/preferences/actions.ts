"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  parseModulePreferenceLifecycleForm,
  parseModulePreferenceWindowForm
} from "@/lib/module-preferences";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function preferencesRedirect(result: string, windowId?: string | null): never {
  const anchor = windowId ? `#window-${windowId}` : "";
  redirect(`/admissions/preferences?${result}=1${anchor}`);
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
