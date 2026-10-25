import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase";
import type { WorkspaceAttendance } from "./student-workspace";

export async function readStudentAttendance(studentId: string): Promise<WorkspaceAttendance[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_student_attendance", { student_key: studentId });
  if (error) throw new Error(error.message);
  return data;
}
