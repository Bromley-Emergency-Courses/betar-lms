import type { UserRole } from "@/lib/types";

export type Permission =
  | "manage_everything"
  | "view_students"
  | "manage_course"
  | "manage_finance"
  | "manage_admissions"
  | "record_teaching"
  | "use_reception";

const permissionsByRole: Record<UserRole, Permission[]> = {
  admin: [
    "manage_everything",
    "view_students",
    "manage_course",
    "manage_finance",
    "manage_admissions",
    "record_teaching",
    "use_reception"
  ],
  teacher: ["view_students", "record_teaching"],
  reception: ["use_reception"]
};

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsByRole[role].includes("manage_everything") || permissionsByRole[role].includes(permission);
}

export function assertCan(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Role ${role} is not permitted to ${permission}.`);
  }
}

export function visibleNavigationForRole(role: UserRole): string[] {
  if (role === "admin") {
    return ["Dashboard", "Students", "Admissions", "Course", "Attendance", "Staff", "Finance", "Exams", "Imports", "Exports"];
  }
  if (role === "teacher") {
    return ["Dashboard", "Students", "Staff"];
  }
  return ["Reception"];
}
