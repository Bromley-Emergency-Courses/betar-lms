"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import type { PhotoSnapshot } from "@/lib/student-photo";
import { saveStudentPhotoChange } from "@/lib/student-photo-service";

export async function loadWorkspacePhoto(studentId: string): Promise<{ ok: true; snapshot: PhotoSnapshot } | { ok: false; error: string }> {
  await requirePermission("manage_everything");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  try {
    const client = await createSupabaseServerClient();
    const result = await client.rpc("read_student_photo_workspace", { student_key: z.uuid().parse(studentId) });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, snapshot: result.data };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Photo details could not be loaded." }; }
}

export async function saveWorkspacePhoto(fields: FormData) {
  await requirePermission("manage_everything");
  if (!studentWorkspaceEnabled()) return { ok: false as const, error: "The student workspace is disabled." };
  return saveStudentPhotoChange(fields);
}
