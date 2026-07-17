import Link from "next/link";
import type { Student } from "@/lib/types";
import { externalStudentIdentifier, studentDisplayName } from "@/lib/rules";

export function StudentLink({ student }: { student: Student }) {
  return (
    <Link href={`/students/${student.id}`}>
      <strong>{studentDisplayName(student)}</strong>
      <br />
      <span className="muted small">{externalStudentIdentifier(student)}</span>
    </Link>
  );
}
