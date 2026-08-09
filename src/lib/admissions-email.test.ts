import { describe, expect, it } from "vitest";
import {
  evaluateAdmissionsEmailSafety,
  getAdmissionsEmailConfig,
  parseAdmissionsEmailPilotAllowlist,
  renderCorrespondenceEmail
} from "@/lib/admissions-email";

describe("admissions email configuration", () => {
  it("stays disabled until the explicit feature flag is enabled", () => {
    expect(getAdmissionsEmailConfig({ ADMISSIONS_EMAIL_ENABLED: "false" })).toMatchObject({
      enabled: false,
      mode: "disabled",
      pilotAllowlist: []
    });
  });

  it("defaults enabled delivery to pilot and requires an allowlist", () => {
    expect(getAdmissionsEmailConfig({ ADMISSIONS_EMAIL_ENABLED: "true", ADMISSIONS_EMAIL_PROVIDER: "smtp" })).toEqual({
      enabled: true,
      mode: "pilot",
      provider: "smtp",
      pilotAllowlist: [],
      missing: [
        "ADMISSIONS_EMAIL_PILOT_ALLOWLIST",
        "ADMISSIONS_EMAIL_FROM",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD"
      ]
    });
  });

  it("parses complete SMTP settings", () => {
    expect(
      getAdmissionsEmailConfig({
        ADMISSIONS_EMAIL_ENABLED: "true",
        ADMISSIONS_EMAIL_MODE: "pilot",
        ADMISSIONS_EMAIL_PILOT_ALLOWLIST: " Owner+Applicant@Example.org ",
        ADMISSIONS_EMAIL_PROVIDER: "smtp",
        ADMISSIONS_EMAIL_FROM: "BETAR Admissions <admissions@example.org>",
        ADMISSIONS_EMAIL_REPLY_TO: "admissions@example.org",
        SMTP_HOST: "smtp.office365.com",
        SMTP_PORT: "587",
        SMTP_USER: "admissions@example.org",
        SMTP_PASSWORD: "secret"
      }).config
    ).toMatchObject({
      provider: "smtp",
      enabled: true,
      from: "BETAR Admissions <admissions@example.org>",
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      user: "admissions@example.org",
      replyTo: "admissions@example.org"
    });
  });

  it("reports missing Microsoft Graph settings when enabled", () => {
    expect(getAdmissionsEmailConfig({
      ADMISSIONS_EMAIL_ENABLED: "true",
      ADMISSIONS_EMAIL_MODE: "live",
      ADMISSIONS_EMAIL_PROVIDER: "graph"
    })).toEqual({
      enabled: true,
      mode: "live",
      provider: "graph",
      pilotAllowlist: [],
      missing: [
        "MICROSOFT_GRAPH_TENANT_ID",
        "MICROSOFT_GRAPH_CLIENT_ID",
        "MICROSOFT_GRAPH_CLIENT_SECRET",
        "MICROSOFT_GRAPH_SENDER_EMAIL"
      ]
    });
  });

  it("parses complete Microsoft Graph settings", () => {
    expect(
      getAdmissionsEmailConfig({
        ADMISSIONS_EMAIL_ENABLED: "true",
        ADMISSIONS_EMAIL_MODE: "live",
        ADMISSIONS_EMAIL_PROVIDER: "graph",
        MICROSOFT_GRAPH_TENANT_ID: "tenant-id",
        MICROSOFT_GRAPH_CLIENT_ID: "client-id",
        MICROSOFT_GRAPH_CLIENT_SECRET: "secret",
        MICROSOFT_GRAPH_SENDER_EMAIL: "admissions@example.org",
        ADMISSIONS_EMAIL_REPLY_TO: "admissions@example.org"
      }).config
    ).toMatchObject({
      provider: "graph",
      enabled: true,
      tenantId: "tenant-id",
      clientId: "client-id",
      clientSecret: "secret",
      senderEmail: "admissions@example.org",
      replyTo: "admissions@example.org"
    });
  });

  it("normalizes and deduplicates pilot recipients", () => {
    expect(
      parseAdmissionsEmailPilotAllowlist(" Owner@Example.org,student@example.org,owner@example.org ")
    ).toEqual(["owner@example.org", "student@example.org"]);
  });

  it("requires both an allowlisted address and matching fake related record in pilot mode", () => {
    const base = {
      mode: "pilot" as const,
      pilotAllowlist: ["owner@example.org"],
      recipient: "OWNER@example.org",
      identity: {
        personId: "person-1",
        admissionLeadId: "lead-1",
        studentId: null
      },
      testRecords: [
        { person_id: "person-1", admission_lead_id: "lead-1", student_id: null }
      ]
    };

    expect(evaluateAdmissionsEmailSafety(base)).toEqual({ allowed: true });
    expect(
      evaluateAdmissionsEmailSafety({ ...base, recipient: "genuine@example.org" })
    ).toEqual({ allowed: false, reason: "recipient_not_allowlisted" });
    expect(
      evaluateAdmissionsEmailSafety({ ...base, testRecords: [] })
    ).toEqual({ allowed: false, reason: "related_record_not_marked_fake" });
    expect(
      evaluateAdmissionsEmailSafety({
        ...base,
        identity: { personId: "person-1", admissionLeadId: null, studentId: null }
      })
    ).toEqual({ allowed: false, reason: "missing_related_record" });
  });

  it("requires a deliberate live mode to bypass pilot-only checks", () => {
    expect(
      evaluateAdmissionsEmailSafety({
        mode: "live",
        pilotAllowlist: [],
        recipient: "genuine@example.org",
        identity: { personId: null },
        testRecords: []
      })
    ).toEqual({ allowed: true });
  });
});

describe("admissions correspondence rendering", () => {
  it("renders offer email content with portal URL and deadline", () => {
    const rendered = renderCorrespondenceEmail({
      templateKey: "offer_issued",
      recipientName: "Asha Patel",
      renderedSubject: "Your BETAR application offer",
      appUrl: "https://lms.example.org",
      metadata: {
        offer_reference: "BETAR-2026-ABC123",
        deadline_at: "2026-08-18T12:00:00Z"
      }
    });

    expect(rendered.subject).toBe("Your BETAR application offer");
    expect(rendered.text).toContain("Dear Asha Patel,");
    expect(rendered.text).toContain("BETAR-2026-ABC123");
    expect(rendered.text).toContain("18 August 2026");
    expect(rendered.text).toContain("https://lms.example.org/portal");
    expect(rendered.html).toContain("<p>");
  });

  it("renders a reissued offer with its replacement deadline", () => {
    const rendered = renderCorrespondenceEmail({
      templateKey: "offer_reissued",
      recipientName: "Asha Patel",
      renderedSubject: "Your BETAR offer has been reissued",
      appUrl: "https://lms.example.org",
      metadata: {
        offer_reference: "BETAR-2026-ABC123",
        deadline_at: "2026-09-01T12:00:00Z"
      }
    });

    expect(rendered.text).toContain("has been reissued");
    expect(rendered.text).toContain("1 September 2026");
    expect(rendered.text).toContain("https://lms.example.org/portal");
  });

  it("renders an offer withdrawal without exposing its internal reason", () => {
    const rendered = renderCorrespondenceEmail({
      templateKey: "offer_withdrawn",
      recipientName: "Asha Patel",
      renderedSubject: "Your BETAR offer has been withdrawn",
      metadata: {
        offer_reference: "BETAR-2026-ABC123",
        internal_reason: "Sensitive internal context"
      }
    });

    expect(rendered.text).toContain("has been withdrawn");
    expect(rendered.text).toContain("reply to this email");
    expect(rendered.text).not.toContain("Sensitive internal context");
  });

  it("renders application invitation and preference links with supplied action links", () => {
    const invitation = renderCorrespondenceEmail({
      templateKey: "application_invitation",
      recipientName: "Applicant",
      renderedSubject: "Your BETAR application invitation",
      metadata: {
        action_link: "https://auth.example.test/invite"
      }
    });
    const preferences = renderCorrespondenceEmail({
      templateKey: "module_preference_window_opened",
      recipientName: "Student",
      renderedSubject: "September preferences",
      metadata: {
        action_link: "https://auth.example.test/preferences",
        preference_closes_at: "2026-08-20T12:00:00Z"
      }
    });

    expect(invitation.text).toContain("https://auth.example.test/invite");
    expect(preferences.text).toContain("https://auth.example.test/preferences");
    expect(preferences.text).toContain("20 August 2026");
  });

  it("renders a correction request with its due date and secure application link", () => {
    const rendered = renderCorrespondenceEmail({
      templateKey: "application_correction_requested",
      recipientName: "Asha Patel",
      renderedSubject: "Action required for your BETAR application",
      appUrl: "https://lms.example.org",
      metadata: {
        action_link: "https://auth.example.test/correction",
        due_at: "2026-08-23T12:00:00Z"
      }
    });

    expect(rendered.text).toContain("23 August 2026");
    expect(rendered.text).toContain("https://auth.example.test/correction");
    expect(rendered.text).toContain("authoritative record");
  });

  it("uses the immutable reviewed body snapshot for operational correspondence", () => {
    const rendered = renderCorrespondenceEmail({
      templateKey: "application_invitation",
      renderedSubject: "Reviewed subject",
      renderedBody: "Hello Asha,\n\nThis is the exact reviewed message.",
      metadata: { action_link: "https://should-not-replace-the-snapshot.example.org" }
    });

    expect(rendered.text).toBe("Hello Asha,\n\nThis is the exact reviewed message.");
    expect(rendered.html).toContain("This is the exact reviewed message.");
    expect(rendered.text).not.toContain("should-not-replace");
  });

  it("rejects unsupported template keys", () => {
    expect(() =>
      renderCorrespondenceEmail({
        templateKey: "unknown",
        recipientName: "Applicant",
        renderedSubject: "Unknown"
      })
    ).toThrow("Unsupported admissions email template");
  });
});
