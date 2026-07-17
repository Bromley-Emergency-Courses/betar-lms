import { GraduationCap, LogIn } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentStaffProfile } from "@/lib/auth";
import { signInWithPassword } from "./actions";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const profile = await getCurrentStaffProfile();
  if (profile) {
    redirect(params.next && params.next.startsWith("/") ? params.next : "/");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand" style={{ color: "#1f2421", borderBottomColor: "var(--line)", padding: 0 }}>
          <div className="brand-mark">B</div>
          <div className="brand-title">
            <strong>BETAR LMS</strong>
            <span style={{ color: "var(--muted)" }}>Staff sign in</span>
          </div>
        </div>

        <div>
          <div className="icon-box">
            <GraduationCap size={20} />
          </div>
          <h1>Sign in</h1>
          <p className="muted">Use your BETAR LMS staff account.</p>
        </div>

        {params.error ? <p className="login-error">{params.error}</p> : null}

        <form className="grid" action={signInWithPassword}>
          <input type="hidden" name="next" value={params.next ?? "/"} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" className="input" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" className="input" type="password" autoComplete="current-password" required />
          </div>
          <button className="button primary">
            <LogIn size={16} />
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
