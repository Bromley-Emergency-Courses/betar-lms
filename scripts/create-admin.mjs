import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!fs.existsSync(path)) {
    return;
  }

  const content = fs.readFileSync(path, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return;
    }
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").replace(/^"|"$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

async function findUserByEmail(supabase, email) {
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return found;
    }

    if (data.users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

function generatedPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}aA1!`;
}

async function main() {
  loadEnvFile(".env.local");

  const email = process.argv[2]?.trim();
  const fullName = process.argv[3]?.trim() || "BETAR Admin";
  const password = process.argv[4] || generatedPassword();
  const passwordWasGenerated = process.argv[4] === undefined;

  if (!email || !email.includes("@")) {
    console.error("Usage: npm run admin:create -- admin@example.com \"Full Name\" [password]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  let user = await findUserByEmail(supabase, email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName
      }
    });
    if (error) {
      throw error;
    }
    user = data.user;
  }

  const { error: profileError } = await supabase.from("staff_profiles").upsert({
    id: user.id,
    full_name: fullName,
    role: "admin",
    active: true
  });

  if (profileError) {
    throw profileError;
  }

  console.log(`Admin ready: ${email}`);
  if (passwordWasGenerated) {
    console.log(`Temporary password: ${password}`);
  }
  console.log("Ask the user to change this password after first sign-in.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
