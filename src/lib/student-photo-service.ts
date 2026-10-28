import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";
import { validateStudentPhotoSignature, type PhotoSnapshot } from "./student-photo";

type PhotoResult = { ok: true; message: string } | { ok: false; error: string };
const inputSchema = z.object({ student_id: z.uuid(), expected_revision: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().max(2147483647)), operation: z.enum(["upload", "remove"]), confirm_remove: z.boolean() });

async function cleanupPhoto(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, path: string): Promise<string> {
  try {
    const students = await client.from("students").select("id").eq("photo_path", path).limit(1);
    const documents = await client.from("managed_files").select("id").eq("bucket", "student-photos").eq("object_path", path).limit(1);
    if (students.error || documents.error) return " Storage cleanup could not be confirmed; the private file is retained for administrator review.";
    if (students.data?.length || documents.data?.length) return " The previous private file is retained because another record references it.";
    const result = await client.storage.from("student-photos").remove([path]);
    return result.error ? " Storage cleanup needs administrator review; the private file may remain." : "";
  } catch { return " Storage cleanup could not be confirmed; the private file may remain."; }
}

export async function saveStudentPhotoChange(fields: FormData): Promise<PhotoResult> {
  await requirePermission("manage_everything");
  const parsed = inputSchema.safeParse({ student_id: fields.get("student_id"), expected_revision: fields.get("expected_revision"), operation: fields.get("operation"), confirm_remove: fields.get("confirm_remove") === "yes" });
  if (!parsed.success) return { ok: false, error: "Reopen the photo editor to review the current student and photo." };
  const input = parsed.data;
  if (input.operation === "remove" && !input.confirm_remove) return { ok: false, error: "Confirm removing the current profile photo." };
  let uploadedPath: string | null = null;
  try {
    const file = fields.get("photo");
    if (input.operation === "upload") {
      if (!(file instanceof File)) return { ok: false, error: "Choose a student photo to upload." };
      await validateStudentPhotoSignature(file);
    }
    const client = await createSupabaseServerClient();
    const snapshot = await client.rpc("read_student_photo_workspace", { student_key: input.student_id });
    if (snapshot.error) throw new Error(snapshot.error.message);
    if ((snapshot.data as PhotoSnapshot).revision !== input.expected_revision) return { ok: false, error: "Student or photo changed. Discard this draft and reopen to review the latest photo." };
    if (input.operation === "upload" && file instanceof File) {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      uploadedPath = `${input.student_id}/workspace/${crypto.randomUUID()}.${extension}`;
      const upload = await client.storage.from("student-photos").upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (upload.error) throw new Error("Photo upload could not be confirmed. The current photo has not been changed; retry or reopen the editor.");
    }
    const result = await client.rpc("save_student_photo", { student_key: input.student_id, expected_revision: input.expected_revision, object_path: uploadedPath, removal_confirmed: input.operation === "remove" });
    if (result.error) {
      let cleanup = "";
      if (uploadedPath && ["P0001", "23503", "23505", "42501", "22023"].includes(result.error.code)) cleanup = await cleanupPhoto(client, uploadedPath);
      return { ok: false, error: `${result.error.message} Your selection has been kept.${cleanup}` };
    }
    const previousPath = (result.data as { previousPath: string | null }).previousPath;
    const cleanup = previousPath ? await cleanupPhoto(client, previousPath) : "";
    revalidatePath("/", "layout");
    return { ok: true, message: `${input.operation === "remove" ? "Profile photo removed." : "Profile photo saved."}${cleanup}` };
  } catch (error) {
    return { ok: false, error: `${error instanceof Error ? error.message : "The photo change could not be confirmed."}${uploadedPath ? " Reopen the editor to check the saved photo before retrying. An unconfirmed private upload is retained rather than risk deleting a saved photo." : ""}` };
  }
}
