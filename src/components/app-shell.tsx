import Link from "next/link";
import {
  Banknote,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  FileDown,
  FileUp,
  Home,
  LogOut,
  Stethoscope,
  UserCheck,
  Users
} from "lucide-react";
import { requireCurrentStaffProfile } from "@/lib/auth";
import { visibleNavigationForRole } from "@/lib/access";
import { signOut } from "@/app/login/actions";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/students", label: "Students", icon: Users },
  { href: "/admissions", label: "Admissions", icon: UserCheck },
  { href: "/course", label: "Course", icon: BookOpen },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/staff", label: "Staff", icon: Stethoscope },
  { href: "/finance", label: "Finance", icon: Banknote },
  { href: "/exams", label: "Exams", icon: ClipboardList },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/exports", label: "Exports", icon: FileDown }
];

export async function AppShell({
  title,
  subtitle,
  titleMedia,
  actions,
  children
}: {
  title: string;
  subtitle?: string;
  titleMedia?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const profile = await requireCurrentStaffProfile();
  const visibleItems = new Set(visibleNavigationForRole(profile.role));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div className="brand-title">
            <strong>BETAR LMS</strong>
            <span>PGCert POCUS</span>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {navItems.filter((item) => visibleItems.has(item.label)).map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Icon size={17} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form action={signOut} className="sidebar-account">
          <div>
            <strong>{profile.fullName}</strong>
            <span>{profile.role}</span>
          </div>
          <button className="icon-button" title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </form>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            {titleMedia}
            <div>
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="toolbar">{actions}</div> : null}
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function PageIcon({ children }: { children: React.ReactNode }) {
  return <span className="icon-box">{children}</span>;
}
