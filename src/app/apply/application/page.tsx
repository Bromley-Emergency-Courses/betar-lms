import { FileText, LockKeyhole } from "lucide-react";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ApplicantInvitationSummary {
  id: string;
  email: string;
  status: string;
  invitedAt: string;
  expiresAt: string;
}

async function getApplicantInvitations(personId: string): Promise<ApplicantInvitationSummary[]> {
  if (!isSupabaseConfigured()) {
    return [
      {
        id: "demo-invitation",
        email: "applicant@example.com",
        status: "claimed",
        invitedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_invitations")
    .select("id, email, status, invited_at, expires_at")
    .eq("person_id", personId)
    .order("invited_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    status: String(row.status),
    invitedAt: String(row.invited_at),
    expiresAt: String(row.expires_at)
  }));
}

export default async function ApplicationAccessPage() {
  const profile = await requireApplicantProfile("/apply/application");
  const invitations = await getApplicantInvitations(profile.personId);
  const latestInvitation = invitations[0];

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">Applicant portal</span>
            <h1>Application access</h1>
            <p>
              Signed in as {profile.person.firstName} {profile.person.lastName}. The application form, document uploads, offers, and registration are not active in
              this slice.
            </p>
          </div>
        </div>

        <div className="apply-form-panel">
          <div className="section-header">
            <div>
              <h2>Invitation</h2>
              <p>Magic-link access is active for this applicant identity.</p>
            </div>
            <div className="icon-box">
              <LockKeyhole size={18} />
            </div>
          </div>
          {latestInvitation ? (
            <div className="timeline-item" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <strong>{latestInvitation.email}</strong>
                <p className="muted small">
                  Status: {latestInvitation.status.replaceAll("_", " ")} · Invited{" "}
                  {new Date(latestInvitation.invitedAt).toLocaleDateString("en-GB")} · Expires{" "}
                  {new Date(latestInvitation.expiresAt).toLocaleDateString("en-GB")}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted small">No application invitation is linked to this account yet.</p>
          )}
        </div>

        <div className="apply-form-panel">
          <div className="section-header">
            <div>
              <h2>Application form</h2>
              <p>Draft save and submission will be implemented in a later Phase 1 slice.</p>
            </div>
            <div className="icon-box">
              <FileText size={18} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
