import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("view_students");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, photo_path")
    .eq("id", id)
    .single();
  if (studentError || !student?.photo_path) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { data, error: downloadError } = await supabase.storage
    .from("student-photos")
    .download(student.photo_path);
  if (downloadError || !data) {
    return NextResponse.json({ error: "Photo could not be downloaded" }, { status: 404 });
  }

  return new Response(data, {
    headers: {
      "content-type": data.type || "image/jpeg",
      "cache-control": "private, max-age=300"
    }
  });
}
