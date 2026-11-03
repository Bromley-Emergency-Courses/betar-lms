import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase";
import { assessmentOperationsPaused } from "./feature";

export const automaticImportPauseMessage = "Automatic exam imports are temporarily paused. Enter scores and resits manually in the student profile.";

export async function automaticExamImportsPaused(): Promise<boolean> {
  if (assessmentOperationsPaused()) return true;
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("assessment_portal_imports_paused");
    return Boolean(error) || data !== false;
  } catch {
    return true;
  }
}

export async function requireAutomaticExamImportsOpen(): Promise<void> {
  if (await automaticExamImportsPaused()) throw new Error(automaticImportPauseMessage);
}
