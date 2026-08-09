import { describe, expect, it } from "vitest";
import { getAdmissionsEmailConfig, renderCorrespondenceEmail } from "@/lib/admissions-email";

describe("admissions email configuration", () => {
  it("stays disabled until the explicit feature flag is enabled", () => {
    expect(getAdmissionsEmailConfig({ ADMISSIONS_EMAIL_ENABLED: "false" }).enabled).toBe(false);
  });

  it("reports missing SMTP settings when enabled", () => {
    expect(getAdmissionsEmailConfig({ ADMISSIONS_EMAIL_ENABLED: "true", ADMISSIONS_EMAIL_PROVIDER: "smtp" })).toEqual({
      enabled: true,
      provider: "smtp",
      missing: ["ADMISSIONS_EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"]
    });
  });

  it("parses complete SMTP settings", () => {
    expect(
      getAdmissionsEmailConfig({
        ADMISSIONS_EMAIL_ENABLED: "true",
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
    expect(getAdmissionsEmailConfig({ ADMISSIONS_EMAIL_ENABLED: "true", ADMISSIONS_EMAIL_PROVIDER: "graph" })).toEqual({
      enabled: true,
      provider: "graph",
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
