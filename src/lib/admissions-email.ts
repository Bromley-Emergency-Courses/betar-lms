import type { JsonRecord, JsonValue } from "@/lib/audit-correspondence";

export const admissionsEmailTemplateKeys = [
  "application_invitation",
  "application_submission_reminder",
  "application_correction_requested",
  "module_preference_window_opened",
  "offer_issued",
  "offer_reissued",
  "offer_withdrawn",
  "rejection",
  "offer_deadline_reminder",
  "offer_lapsed_notice",
  "offer_accepted_confirmation",
  "offer_declined_confirmation",
  "registration_lapsed_notice",
  "registration_reopened_notice"
] as const;

export type AdmissionsEmailTemplateKey = (typeof admissionsEmailTemplateKeys)[number];

export type AdmissionsEmailProvider = "smtp" | "graph";
export type AdmissionsEmailDeliveryMode = "disabled" | "pilot" | "live";

export interface SmtpAdmissionsEmailConfig {
  provider: "smtp";
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  replyTo?: string;
}

export interface GraphAdmissionsEmailConfig {
  provider: "graph";
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
  replyTo?: string;
}

export type AdmissionsEmailConfig = SmtpAdmissionsEmailConfig | GraphAdmissionsEmailConfig;

export interface AdmissionsEmailConfigResult {
  enabled: boolean;
  mode: AdmissionsEmailDeliveryMode;
  config?: AdmissionsEmailConfig;
  missing: string[];
  pilotAllowlist: string[];
  provider: AdmissionsEmailProvider;
}

export interface AdmissionsEmailRecipientIdentity {
  personId: string | null;
  admissionLeadId?: string | null;
  studentId?: string | null;
}

export interface AdmissionsEmailTestRecordMatch {
  person_id: string;
  admission_lead_id: string | null;
  student_id: string | null;
}

export type AdmissionsEmailSafetyResult =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "master_disabled"
        | "recipient_not_allowlisted"
        | "missing_related_record"
        | "related_record_not_marked_fake";
    };

export interface CorrespondenceEmailRenderInput {
  templateKey: string;
  recipientName?: string | null;
  renderedSubject: string;
  renderedBody?: string | null;
  metadata?: JsonRecord | null;
  appUrl?: string;
}

export interface RenderedCorrespondenceEmail {
  subject: string;
  text: string;
  html: string;
}

const smtpRequiredEnvKeys = [
  "ADMISSIONS_EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD"
] as const;

const graphRequiredEnvKeys = [
  "MICROSOFT_GRAPH_TENANT_ID",
  "MICROSOFT_GRAPH_CLIENT_ID",
  "MICROSOFT_GRAPH_CLIENT_SECRET",
  "MICROSOFT_GRAPH_SENDER_EMAIL"
] as const;

function envFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeAdmissionsEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function parseAdmissionsEmailPilotAllowlist(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map(normalizeAdmissionsEmailAddress)
        .filter((email) => email.length > 0)
    )
  ];
}

export function isPilotRecipientAllowlisted(recipient: string, allowlist: readonly string[]): boolean {
  const normalizedRecipient = normalizeAdmissionsEmailAddress(recipient);
  return allowlist.some((email) => normalizeAdmissionsEmailAddress(email) === normalizedRecipient);
}

export function evaluateAdmissionsEmailSafety(input: {
  mode: AdmissionsEmailDeliveryMode;
  pilotAllowlist: readonly string[];
  recipient: string;
  identity: AdmissionsEmailRecipientIdentity;
  testRecords: readonly AdmissionsEmailTestRecordMatch[];
}): AdmissionsEmailSafetyResult {
  if (input.mode === "disabled") {
    return { allowed: false, reason: "master_disabled" };
  }
  if (input.mode === "live") {
    return { allowed: true };
  }
  if (!isPilotRecipientAllowlisted(input.recipient, input.pilotAllowlist)) {
    return { allowed: false, reason: "recipient_not_allowlisted" };
  }
  if (
    !input.identity.personId ||
    (!input.identity.admissionLeadId && !input.identity.studentId)
  ) {
    return { allowed: false, reason: "missing_related_record" };
  }

  const hasFakeRecord = input.testRecords.some(
    (record) =>
      record.person_id === input.identity.personId &&
      ((Boolean(input.identity.admissionLeadId) && record.admission_lead_id === input.identity.admissionLeadId) ||
        (Boolean(input.identity.studentId) && record.student_id === input.identity.studentId))
  );

  return hasFakeRecord
    ? { allowed: true }
    : { allowed: false, reason: "related_record_not_marked_fake" };
}

function emailDeliveryMode(
  env: Record<string, string | undefined>,
  enabled: boolean
): { mode: AdmissionsEmailDeliveryMode; invalid: boolean } {
  if (!enabled) {
    return { mode: "disabled", invalid: false };
  }

  const configuredMode = optionalEnv(env.ADMISSIONS_EMAIL_MODE)?.toLowerCase();
  if (!configuredMode || configuredMode === "pilot") {
    return { mode: "pilot", invalid: false };
  }
  if (configuredMode === "live") {
    return { mode: "live", invalid: false };
  }

  return { mode: "pilot", invalid: true };
}

function emailProvider(env: Record<string, string | undefined>): AdmissionsEmailProvider {
  const configuredProvider = optionalEnv(env.ADMISSIONS_EMAIL_PROVIDER)?.toLowerCase();
  if (configuredProvider === "graph") {
    return "graph";
  }
  if (configuredProvider === "smtp") {
    return "smtp";
  }

  return graphRequiredEnvKeys.some((key) => optionalEnv(env[key])) ? "graph" : "smtp";
}

function stringMetadata(metadata: JsonRecord, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDate(value: JsonValue | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "Europe/London"
  }).format(date);
}

function greeting(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? `Dear ${trimmed},` : "Dear applicant,";
}

function portalUrl(appUrl: string): string {
  return new URL("/portal", appUrl).toString();
}

function registrationUrl(appUrl: string): string {
  return new URL("/portal/registration", appUrl).toString();
}

function applicationUrl(appUrl: string): string {
  return new URL("/apply/application", appUrl).toString();
}

function applicantLoginUrl(appUrl: string): string {
  return new URL("/apply/login", appUrl).toString();
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlEscapeWithLinks(value: string): string {
  const urlPattern = /https?:\/\/[^\s<>]+/g;
  let html = "";
  let cursor = 0;

  for (const match of value.matchAll(urlPattern)) {
    const matchedUrl = match[0];
    const matchIndex = match.index;
    const url = matchedUrl.replace(/[.,;:!?]+$/, "");
    const trailingPunctuation = matchedUrl.slice(url.length);

    html += htmlEscape(value.slice(cursor, matchIndex));
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        const escapedUrl = htmlEscape(url);
        html += `<a href="${escapedUrl}">${escapedUrl}</a>`;
      } else {
        html += htmlEscape(url);
      }
    } catch {
      html += htmlEscape(url);
    }
    html += htmlEscape(trailingPunctuation);
    cursor = matchIndex + matchedUrl.length;
  }

  return html + htmlEscape(value.slice(cursor));
}

function textToHtml(text: string): string {
  return text
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.split("\n").map(htmlEscapeWithLinks).join("<br />")}</p>`)
    .join("\n");
}

export function getAdmissionsEmailConfig(
  env: Record<string, string | undefined> = process.env
): AdmissionsEmailConfigResult {
  const provider = emailProvider(env);
  const enabled = envFlag(env.ADMISSIONS_EMAIL_ENABLED);
  const { mode, invalid: invalidMode } = emailDeliveryMode(env, enabled);
  const pilotAllowlist = parseAdmissionsEmailPilotAllowlist(env.ADMISSIONS_EMAIL_PILOT_ALLOWLIST);
  if (!enabled) {
    return { enabled: false, mode, missing: [], pilotAllowlist, provider };
  }

  const safetyMissing = [
    ...(invalidMode ? ["ADMISSIONS_EMAIL_MODE"] : []),
    ...(mode === "pilot" && pilotAllowlist.length === 0 ? ["ADMISSIONS_EMAIL_PILOT_ALLOWLIST"] : [])
  ];

  if (provider === "graph") {
    const missing = [...safetyMissing, ...graphRequiredEnvKeys.filter((key) => !optionalEnv(env[key]))];
    if (missing.length > 0) {
      return { enabled: true, mode, missing: [...new Set(missing)], pilotAllowlist, provider };
    }

    return {
      enabled: true,
      mode,
      missing: [],
      pilotAllowlist,
      provider,
      config: {
        provider,
        enabled: true,
        tenantId: optionalEnv(env.MICROSOFT_GRAPH_TENANT_ID)!,
        clientId: optionalEnv(env.MICROSOFT_GRAPH_CLIENT_ID)!,
        clientSecret: optionalEnv(env.MICROSOFT_GRAPH_CLIENT_SECRET)!,
        senderEmail: optionalEnv(env.MICROSOFT_GRAPH_SENDER_EMAIL)!,
        replyTo: optionalEnv(env.ADMISSIONS_EMAIL_REPLY_TO)
      }
    };
  }

  const missing = [...safetyMissing, ...smtpRequiredEnvKeys.filter((key) => !optionalEnv(env[key]))];
  const parsedPort = Number(env.SMTP_PORT);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    missing.push("SMTP_PORT");
  }

  if (missing.length > 0) {
    return { enabled: true, mode, missing: [...new Set(missing)], pilotAllowlist, provider };
  }

  const secure = env.SMTP_SECURE
    ? envFlag(env.SMTP_SECURE)
    : parsedPort === 465;

  return {
    enabled: true,
    mode,
    missing: [],
    pilotAllowlist,
    provider,
    config: {
      provider,
      enabled: true,
      host: optionalEnv(env.SMTP_HOST)!,
      port: parsedPort,
      secure,
      user: optionalEnv(env.SMTP_USER)!,
      password: optionalEnv(env.SMTP_PASSWORD)!,
      from: optionalEnv(env.ADMISSIONS_EMAIL_FROM)!,
      replyTo: optionalEnv(env.ADMISSIONS_EMAIL_REPLY_TO)
    }
  };
}

export function isSupportedAdmissionsTemplateKey(templateKey: string): templateKey is AdmissionsEmailTemplateKey {
  return admissionsEmailTemplateKeys.some((key) => key === templateKey);
}

export function renderCorrespondenceEmail(input: CorrespondenceEmailRenderInput): RenderedCorrespondenceEmail {
  const metadata = input.metadata ?? {};
  const appUrl = input.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const portal = portalUrl(appUrl);
  const registration = registrationUrl(appUrl);
  const deadline =
    formatDate(metadata.application_deadline_at) ??
    formatDate(metadata.deadline_at) ??
    formatDate(metadata.registration_deadline_at) ??
    formatDate(metadata.preference_closes_at) ??
    formatDate(metadata.due_at);
  const offerReference = stringMetadata(metadata, "offer_reference");
  const subject = input.renderedSubject.trim();
  const intro = greeting(input.recipientName);

  if (input.renderedBody?.trim()) {
    const actionLink = stringMetadata(metadata, "action_link");
    const deadlineState = stringMetadata(metadata, "application_deadline_state");
    const deadlineGuidance = deadlineState === "overdue"
      ? deadline
        ? `The application deadline was ${deadline}. If you still wish to apply, please contact BETAR Admissions; staff can extend the cohort deadline.`
        : "The application deadline has passed. If you still wish to apply, please contact BETAR Admissions."
      : deadline
        ? `Please complete and submit your application by ${deadline}.`
        : "Please complete and submit your application as soon as possible.";
    const text = input.renderedBody
      .trim()
      .replaceAll("{{action_link}}", actionLink ?? "[secure link unavailable]")
      .replaceAll("{{applicant_login_link}}", applicantLoginUrl(appUrl))
      .replaceAll("{{application_deadline}}", deadline ?? "the published application deadline")
      .replaceAll("{{deadline_guidance}}", deadlineGuidance);
    return { subject, text, html: textToHtml(text) };
  }

  let text: string;
  switch (input.templateKey) {
    case "offer_issued":
      text = [
        intro,
        `We are pleased to let you know that your BETAR application has received an offer${offerReference ? ` (${offerReference})` : ""}.`,
        deadline
          ? `Please sign in to the applicant portal to review and respond to your offer by ${deadline}.`
          : "Please sign in to the applicant portal to review and respond to your offer.",
        portal,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_reissued":
      text = [
        intro,
        `Your BETAR offer${offerReference ? ` (${offerReference})` : ""} has been reissued.`,
        deadline
          ? `Please sign in to the applicant portal to review and respond by ${deadline}.`
          : "Please sign in to the applicant portal to review and respond.",
        portal,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_withdrawn":
      text = [
        intro,
        `Your BETAR offer${offerReference ? ` (${offerReference})` : ""} has been withdrawn by the admissions team.`,
        "If you need to discuss this outcome, please reply to this email.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "application_invitation":
      text = [
        intro,
        "You have been invited to complete your BETAR application.",
        deadline
          ? `Please complete and submit your application by ${deadline}.`
          : "Please complete your application as soon as possible.",
        "Use the secure link below to sign in and continue your application.",
        stringMetadata(metadata, "action_link") ?? portal,
        `This link is single-use. To return later, request a fresh sign-in link at ${applicantLoginUrl(appUrl)}.`,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "application_submission_reminder":
      text = [
        intro,
        "Our records show that your BETAR application has not yet been submitted.",
        deadline
          ? `Please complete and submit your application by ${deadline}.`
          : "Please complete and submit your application as soon as possible.",
        `Request a fresh secure sign-in link at ${applicantLoginUrl(appUrl)}.`,
        "If you have already contacted the admissions team about your application, please disregard this reminder.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "application_correction_requested":
      text = [
        intro,
        "We need you to correct specific information in your BETAR application.",
        deadline
          ? `Please use the secure link below to review the request and resubmit your corrections by ${deadline}.`
          : "Please use the secure link below to review the request and resubmit your corrections.",
        stringMetadata(metadata, "action_link") ?? applicationUrl(appUrl),
        `This link is single-use. To return later, request a fresh sign-in link at ${applicantLoginUrl(appUrl)}.`,
        "The secure application page is the authoritative record of the requested changes.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "module_preference_window_opened":
      text = [
        intro,
        "Module preferences are now open for your next BETAR term.",
        deadline
          ? `Please sign in to the student portal and submit your choices by ${deadline}.`
          : "Please sign in to the student portal and submit your choices.",
        stringMetadata(metadata, "action_link") ?? new URL("/portal/module-preferences", appUrl).toString(),
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "rejection":
      text = [
        intro,
        "Thank you for your BETAR application. After review, we are not able to make you an offer for this intake.",
        "If you have questions about the outcome, please reply to this email and the admissions team will respond.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_deadline_reminder":
      text = [
        intro,
        deadline
          ? `This is a reminder that your BETAR offer response is due by ${deadline}.`
          : "This is a reminder that your BETAR offer response deadline is approaching.",
        "Please sign in to the applicant portal to accept or decline your offer.",
        portal,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_lapsed_notice":
      text = [
        intro,
        "Your BETAR offer has now lapsed because the response deadline has passed.",
        "If you still want to discuss your application, please reply to this email.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_accepted_confirmation":
      text = [
        intro,
        "Thank you for accepting your BETAR offer.",
        "Your next step is to complete registration in the portal.",
        registration,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "offer_declined_confirmation":
      text = [
        intro,
        "This confirms that you have declined your BETAR offer.",
        "If this was a mistake, please reply to this email.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "registration_lapsed_notice":
      text = [
        intro,
        "Your BETAR registration has lapsed because the registration deadline has passed.",
        "If you still want to complete registration, please reply to this email.",
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    case "registration_reopened_notice":
      text = [
        intro,
        deadline
          ? `Your BETAR registration has been reopened. Please complete it by ${deadline}.`
          : "Your BETAR registration has been reopened.",
        registration,
        "Regards,\nBETAR Admissions"
      ].join("\n\n");
      break;
    default:
      throw new Error(`Unsupported admissions email template: ${input.templateKey}`);
  }

  return {
    subject,
    text,
    html: textToHtml(text)
  };
}
