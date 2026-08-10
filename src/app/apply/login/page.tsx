import { Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { Field } from "@/components/forms";
import { getCurrentPortalProfile } from "@/lib/portal-auth";
import { safePortalNextPath } from "@/lib/portal-access";
import { sendApplicantMagicLink } from "./actions";

export default async function ApplicantLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; sent?: string; demo?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safePortalNextPath(params.next ?? "/apply/application");
  const profile = await getCurrentPortalProfile();
  if (profile) {
    redirect(next);
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand" style={{ color: "#1f2421", borderBottomColor: "var(--line)", padding: 0 }}>
          <div className="brand-mark">B</div>
          <div className="brand-title">
            <strong>BETAR</strong>
            <span style={{ color: "var(--muted)" }}>Applicant access</span>
          </div>
        </div>

        <div>
          <div className="icon-box">
            <Mail size={20} />
          </div>
          <h1>Check your email</h1>
          <p className="muted">Enter the email address used for your BETAR application invitation. Email sign-in links are single-use, so request a fresh one whenever you return.</p>
        </div>

        {params.error ? <p className="login-error">{params.error}</p> : null}
        {params.sent ? (
          <p className="apply-success" role="status">
            If the address has an active invitation, a sign-in link has been sent.
            {params.demo === "1" ? " Demo mode is running without Supabase email delivery." : ""}
            {params.demo !== "1"
              ? " If this is your first access and no message arrives, use the latest application invitation email or ask admissions staff to resend it."
              : ""}
          </p>
        ) : null}

        <form className="grid" action={sendApplicantMagicLink}>
          <input type="hidden" name="next" value={next} />
          <Field label="Email" htmlFor="applicant-email">
            <input id="applicant-email" name="email" className="input" type="email" autoComplete="email" required />
          </Field>
          <button className="button primary">
            <Mail size={16} />
            Send sign-in link
          </button>
        </form>
      </section>
    </main>
  );
}
