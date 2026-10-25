import Link from "next/link";
import type { Student } from "@/lib/types";
import { externalStudentIdentifier, studentDisplayName } from "@/lib/rules";

export function StudentLink({ student, href }: { student: Student; href?: string }) {
  return (
    <Link href={href ?? `/students/${student.id}`}>
      <strong>{studentDisplayName(student)}</strong>
      <br />
      <span className="muted small">{externalStudentIdentifier(student)}</span>
    </Link>
  );
}
