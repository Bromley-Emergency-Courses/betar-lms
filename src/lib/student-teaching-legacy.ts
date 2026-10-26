import "server-only";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { teachingCommandSchema, type TeachingOptions } from "./student-teaching";

export async function saveLegacyTeaching(input: Record<string, unknown>) {
  await requirePermission("record_teaching");
  const client = await createSupabaseServerClient();
  const options = await client.rpc("read_student_teaching_options", { student_key: input.student_id });
  if (options.error) throw new Error(options.error.message);
  const current = options.data as TeachingOptions;
  const offerings = input.kind === "presentation" ? current.presentations ?? current.offerings : current.offerings;
  const offering = offerings.find(candidate => candidate.id === input.offering_id);
  if (!offering) throw new Error("This enrolment is not eligible for teaching. Reload the staff workspace; historical records remain readable.");
  const definition = current.definitions.find(candidate => candidate.id === input.definition_id && candidate.moduleId === offering.moduleId);
  const command = teachingCommandSchema.parse({ ...input, offering_token: offering.token,
    ...(input.kind === "formative" ? { definition_token: definition?.token } : {}) });
  const result = await client.rpc("create_student_teaching_record", { command });
  if (result.error) throw new Error(result.error.message);
  if (result.data?.status === "duplicate") throw new Error("You have already scored this presentation. Edit your existing submission instead.");
}
