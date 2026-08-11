import { LayoutDashboard, RotateCcw, UserCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import styles from "@/components/admissions-workspace.module.css";
import { returningStudentAdmissionsWorkspaceEnabled } from "@/lib/admissions-feature";

export type AdmissionsWorkspaceLocation = "overview" | "new_students" | "returning_students" | "batch";

export function AdmissionsLocalNavigation({
  active,
  newAttention,
  returningAttention
}: {
  active: AdmissionsWorkspaceLocation;
  newAttention?: number;
  returningAttention?: number;
}) {
  const items: Array<{
    key: Exclude<AdmissionsWorkspaceLocation, "batch">;
    href: string;
    label: string;
    icon: LucideIcon;
    count?: number;
  }> = [
    { key: "overview", href: "/admissions", label: "Overview", icon: LayoutDashboard },
    { key: "new_students", href: "/admissions/new-students", label: "New students", icon: UserCheck, count: newAttention },
    ...(returningStudentAdmissionsWorkspaceEnabled()
      ? [{ key: "returning_students" as const, href: "/admissions/returning-students", label: "Returning students", icon: RotateCcw, count: returningAttention }]
      : [])
  ];

  return (
    <nav className={styles.localNav} aria-label="Admissions sections">
      {items.map((item) => {
        const Icon = item.icon;
        const current = active === item.key;
        return (
          <Link className={current ? styles.activeNav : undefined} href={item.href} aria-current={current ? "page" : undefined} key={item.key}>
            <Icon size={14} aria-hidden="true" />
            {item.label}
            {typeof item.count === "number" && item.count > 0 ? <span className={styles.navBadge}>{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
