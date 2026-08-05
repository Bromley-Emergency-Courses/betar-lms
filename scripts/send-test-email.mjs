import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import nodemailer from "nodemailer";

const envFiles = [".env.local", ".env"];

for (const envFile of envFiles) {
  const path = resolve(process.cwd(), envFile);
  if (!existsSync(path)) {
    continue;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function flagEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function emailProvider() {
  const configured = optionalEnv("ADMISSIONS_EMAIL_PROVIDER")?.toLowerCase();
  if (configured === "graph" || configured === "smtp") {
    return configured;
  }

  return optionalEnv("MICROSOFT_GRAPH_TENANT_ID") || optionalEnv("MICROSOFT_GRAPH_CLIENT_ID") ? "graph" : "smtp";
}

const toArg = argValue("--to") ?? process.argv.slice(2).filter((arg) => !arg.startsWith("--")).join(",");
const recipients = toArg
  .split(",")
  .map((recipient) => recipient.trim())
  .filter(Boolean);

if (recipients.length === 0) {
  console.error("Usage: npm run email:test -- --to internal@example.org,gmail@example.com,user@nhs.net");
  process.exit(1);
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const now = new Date().toISOString();
const subject = argValue("--subject") ?? `BETAR admissions mailbox test ${now}`;
const text = [
  "This is a BETAR LMS admissions email delivery test.",
  `Sent at: ${now}`,
  `App URL: ${appUrl}`,
  "Please confirm whether this arrived in inbox, focused inbox, other, junk, quarantine, or not at all."
].join("\n\n");

async function graphErrorMessage(response) {
  const body = await response.text();
  if (!body) {
    return `Microsoft Graph request failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(body);
    const code = parsed.error?.code ? `${parsed.error.code}: ` : "";
    return `${code}${parsed.error?.message ?? body}`;
  } catch {
    return body;
  }
}

async function getGraphAccessToken() {
  const tenantId = optionalEnv("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = optionalEnv("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = optionalEnv("MICROSOFT_GRAPH_CLIENT_SECRET");
  const missing = [
    ["MICROSOFT_GRAPH_TENANT_ID", tenantId],
    ["MICROSOFT_GRAPH_CLIENT_ID", clientId],
    ["MICROSOFT_GRAPH_CLIENT_SECRET", clientSecret]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error(`Missing required Microsoft Graph env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default"
    })
  });

  if (!response.ok) {
    throw new Error(await graphErrorMessage(response));
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Microsoft Graph token response did not include an access token.");
  }

  return payload.access_token;
}

async function sendGraphTests() {
  const senderEmail = optionalEnv("MICROSOFT_GRAPH_SENDER_EMAIL");
  if (!senderEmail) {
    console.error("Missing required Microsoft Graph env var: MICROSOFT_GRAPH_SENDER_EMAIL");
    process.exit(1);
  }

  const accessToken = await getGraphAccessToken();
  for (const recipient of recipients) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: "Text",
            content: text
          },
          toRecipients: [
            {
              emailAddress: {
                address: recipient
              }
            }
          ],
          replyTo: optionalEnv("ADMISSIONS_EMAIL_REPLY_TO")
            ? [
                {
                  emailAddress: {
                    address: optionalEnv("ADMISSIONS_EMAIL_REPLY_TO")
                  }
                }
              ]
            : undefined
        },
        saveToSentItems: true
      })
    });

    if (!response.ok) {
      throw new Error(`${recipient}: ${await graphErrorMessage(response)}`);
    }

    console.log(`${recipient}: sent via Microsoft Graph`);
  }
}

async function sendSmtpTests() {
  const required = ["ADMISSIONS_EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required SMTP env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("SMTP_PORT must be a valid TCP port.");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? flagEnabled(process.env.SMTP_SECURE) : port === 465,
    requireTLS: true,
    tls: {
      minVersion: "TLSv1.2"
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  for (const recipient of recipients) {
    const info = await transporter.sendMail({
      from: process.env.ADMISSIONS_EMAIL_FROM,
      to: recipient,
      replyTo: process.env.ADMISSIONS_EMAIL_REPLY_TO || undefined,
      subject,
      text
    });
    console.log(`${recipient}: sent via SMTP ${info.messageId ?? "(no provider message id)"}`);
  }
}

if (emailProvider() === "graph") {
  await sendGraphTests();
} else {
  await sendSmtpTests();
}
