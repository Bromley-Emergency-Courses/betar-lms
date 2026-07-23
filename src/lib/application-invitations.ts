import { z } from "zod";
import { safePortalNextPath } from "@/lib/portal-access";
import type { AdmissionLead, AdmissionLeadStage } from "@/lib/types";

export const applicationInvitedAction = "application.invited";
export const applicationAccessClaimedAction = "application.access_claimed";
export const applicationInvitationTemplateKey = "application_invitation";
export const applicationInvitationAllowedLeadStages = ["interest", "application_invited"] as const satisfies readonly AdmissionLeadStage[];

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
const idSchema = z.string().uuid();

export const applicantLoginSchema = z.object({
  email: emailSchema,
  next: z.string().optional().nullable().transform(safePortalNextPath)
});

export const staffInvitationSchema = z.object({
  lead_id: idSchema
});

export interface IssuedApplicationInvitation {
  invitation_id: string;
  claim_nonce: string;
  lead_id: string;
  person_id: string;
  email: string;
  expires_at: string;
}

export function parseApplicantMagicLinkForm(formData: FormData) {
  return applicantLoginSchema.parse({
    email: String(formData.get("email") ?? ""),
    next: String(formData.get("next") ?? "/apply/application")
  });
}

export function parseStaffInvitationForm(formData: FormData) {
  return staffInvitationSchema.parse({
    lead_id: String(formData.get("lead_id") ?? "")
  });
}

export function canIssueApplicationInvitationForLead(
  lead: Pick<AdmissionLead, "stage" | "archived" | "convertedStudentId">
): boolean {
  return (
    !lead.archived &&
    !lead.convertedStudentId &&
    applicationInvitationAllowedLeadStages.some((stage) => stage === lead.stage)
  );
}

export function applicationMagicLinkRedirectUrl(
  origin: string,
  next?: string | null,
  invitation?: Pick<IssuedApplicationInvitation, "invitation_id" | "claim_nonce">
): string {
  const redirectUrl = new URL("/auth/callback", origin);
  redirectUrl.searchParams.set("next", safePortalNextPath(next ?? "/apply/application"));
  if (invitation) {
    redirectUrl.searchParams.set("invitation_id", invitation.invitation_id);
    redirectUrl.searchParams.set("claim_nonce", invitation.claim_nonce);
  }
  return redirectUrl.toString();
}

export function isIssuedApplicationInvitation(value: unknown): value is IssuedApplicationInvitation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof IssuedApplicationInvitation, unknown>>;
  return (
    typeof candidate.invitation_id === "string" &&
    typeof candidate.claim_nonce === "string" &&
    typeof candidate.lead_id === "string" &&
    typeof candidate.person_id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.expires_at === "string"
  );
}
