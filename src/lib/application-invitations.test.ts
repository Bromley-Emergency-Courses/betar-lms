import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationAccessClaimedAction,
  applicationInvitationAllowedLeadStages,
  applicationInvitedAction,
  applicationInvitationTemplateKey,
  applicationMagicLinkRedirectUrl,
  canIssueApplicationInvitationForLead,
  isIssuedApplicationInvitation,
  parseApplicantMagicLinkForm,
  parseStaffInvitationForm
} from "@/lib/application-invitations";
import type { AdmissionLeadStage } from "@/lib/types";

describe("application invitations", () => {
  it("normalizes applicant magic-link requests and preserves safe next paths", () => {
    const formData = new FormData();
    formData.set("email", " APPLICANT@EXAMPLE.NHS.UK ");
    formData.set("next", "/apply/application");

    expect(parseApplicantMagicLinkForm(formData)).toEqual({
      email: "applicant@example.nhs.uk",
      next: "/apply/application"
    });
  });

  it("rejects staff invitation forms without a lead id", () => {
    expect(() => parseStaffInvitationForm(new FormData())).toThrow();
  });

  it("builds invitation-bound callback URLs with staff-route next paths removed", () => {
    expect(applicationMagicLinkRedirectUrl("https://lms.example.test", "/students")).toBe(
      "https://lms.example.test/auth/callback?next=%2Fportal"
    );
    expect(
      applicationMagicLinkRedirectUrl("https://lms.example.test", "/apply/application", {
        invitation_id: "11111111-1111-4111-8111-111111111111",
        claim_nonce: "nonce-1"
      })
    ).toBe(
      "https://lms.example.test/auth/callback?next=%2Fapply%2Fapplication&invitation_id=11111111-1111-4111-8111-111111111111&claim_nonce=nonce-1"
    );
  });

  it("recognizes the issue invitation RPC response shape", () => {
    expect(
      isIssuedApplicationInvitation({
        invitation_id: "invitation-1",
        claim_nonce: "nonce-1",
        lead_id: "lead-1",
        person_id: "person-1",
        email: "applicant@example.nhs.uk",
        expires_at: "2026-08-06T12:00:00Z"
      })
    ).toBe(true);
    expect(isIssuedApplicationInvitation({ email: "applicant@example.nhs.uk" })).toBe(false);
  });

  it("allows invitations only for active early-stage leads", () => {
    const stages: AdmissionLeadStage[] = [
      "interest",
      "application_invited",
      "submitted",
      "reviewed",
      "offered",
      "rejected",
      "accepted",
      "offer_declined",
      "offer_lapsed",
      "archived"
    ];

    expect(applicationInvitationAllowedLeadStages).toEqual(["interest", "application_invited"]);
    expect(
      stages.filter((stage) =>
        canIssueApplicationInvitationForLead({
          stage,
          archived: false,
          convertedStudentId: undefined
        })
      )
    ).toEqual(["interest", "application_invited"]);
    expect(
      canIssueApplicationInvitationForLead({
        stage: "interest",
        archived: true,
        convertedStudentId: undefined
      })
    ).toBe(false);
    expect(
      canIssueApplicationInvitationForLead({
        stage: "application_invited",
        archived: false,
        convertedStudentId: "student-1"
      })
    ).toBe(false);
  });

  it("keeps invitation persistence separate from full application forms", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0020_application_invitations_magic_link.sql"),
      "utf8"
    );

    expect(migration).toContain("create table public.application_invitations");
    expect(migration).toContain("claim_nonce_hash text not null");
    expect(migration).toContain("create or replace function public.issue_application_invitation");
    expect(migration).toContain("create or replace function public.claim_application_invitation_for_auth_user(");
    expect(migration).toContain("p_invitation_id uuid default null");
    expect(migration).toContain("p_claim_nonce text default null");
    expect(migration).toContain(`'${applicationInvitedAction}'`);
    expect(migration).toContain(`'${applicationAccessClaimedAction}'`);
    expect(migration).toContain(`'${applicationInvitationTemplateKey}'`);
    expect(migration).toContain("grant execute on function public.issue_application_invitation");
    expect(migration).toContain("grant execute on function public.claim_application_invitation_for_auth_user(uuid, text)");
    expect(migration).toContain("portal users read own application invitations");
    expect(migration).toContain("if not public.is_admin() then");
    expect(migration).toContain("if v_lead.stage not in ('interest', 'application_invited') then");
    expect(migration).toContain("where id = p_invitation_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("if v_invitation.status <> 'pending' then");
    expect(migration).toContain("if v_invitation.expires_at <= now() then");
    expect(migration).toContain("if lower(v_invitation.email) <> v_email then");
    expect(migration).toContain(
      "if v_invitation.claim_nonce_hash <> encode(digest(p_claim_nonce, 'sha256'), 'hex') then"
    );
    expect(migration).toContain(
      "if v_existing_person_id is not null and v_existing_person_id <> v_invitation.person_id then"
    );
    expect(migration).not.toContain("order by invited_at desc");
    expect(migration).not.toContain("create table public.applications");
    expect(migration).not.toContain("create table public.offers");
    expect(migration).not.toContain("create table public.registrations");
  });
});
