"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function safeNextPath(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signInWithPassword(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect(safeNextPath(formData.get("next")));
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password are required")}&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  redirect("/login");
}
