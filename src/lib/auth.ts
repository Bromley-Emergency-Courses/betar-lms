import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission } from "@/lib/access";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import type { UserRole } from "@/lib/types";

export interface StaffProfile {
  id: string;
  fullName: string;
  role: UserRole;
  active: boolean;
}

export const getCurrentStaffProfile = cache(async (): Promise<StaffProfile | null> => {
  if (!isSupabaseConfigured()) {
    return {
      id: "demo-admin",
      fullName: "Demo Admin",
      role: "admin",
      active: true
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .eq("active", true)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    fullName: data.full_name,
    role: data.role,
    active: data.active
  };
});

export async function requireCurrentStaffProfile(): Promise<StaffProfile> {
  const profile = await getCurrentStaffProfile();
  if (!profile) {
    redirect("/login");
  }
  return profile;
}

export async function requirePermission(permission: Permission): Promise<StaffProfile> {
  const profile = await requireCurrentStaffProfile();
  if (!can(profile.role, permission)) {
    redirect(profile.role === "reception" ? "/reception" : "/");
  }
  return profile;
}
