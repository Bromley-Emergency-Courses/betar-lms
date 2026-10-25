import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localAppEnvironment, localContainer, localProject, validateLocalSettings, validateLocalProjectConfig } from "./assessment-local-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const workdir = "dev/assessment";
const action = process.argv[2] ?? "check";
const mode = process.argv[3] ?? "shadow";
const port = Number(process.argv[4] ?? 3100);

function execute(binary, argumentsList) {
  return execFileSync(binary, argumentsList, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function localSettings() {
  const running = execute("docker", ["inspect", "--format", "{{.State.Running}}", localContainer]).trim();
  if (running !== "true") throw new Error("The isolated Docker database is not running.");
  return validateLocalSettings(JSON.parse(execute("supabase", ["status", "--workdir", workdir, "--output", "json"])));
}

try {
  validateLocalProjectConfig(readFileSync(`${root}${workdir}/supabase/config.toml`, "utf8"));
  if (action === "start") {
    const migrations = `${root}${workdir}/supabase/migrations`;
    const expected = realpathSync(`${root}supabase/migrations`);
    if (existsSync(migrations)) {
      if (realpathSync(migrations) !== expected) throw new Error("Unexpected local migration directory.");
    } else {
      symlinkSync(expected, migrations, "dir");
    }
    execFileSync("supabase", ["start", "--workdir", workdir, "-x", "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"], { cwd: root, stdio: ["inherit", "pipe", "inherit"] });
    localSettings();
    process.stdout.write(`Isolated project ${localProject} is running. Existing volumes are retained; no reset or seed was run.\n`);
  } else if (action === "migrate") {
    localSettings();
    if (realpathSync(`${root}${workdir}/supabase/migrations`) !== realpathSync(`${root}supabase/migrations`)) throw new Error("Unexpected migration directory.");
    execute("supabase", ["migration", "up", "--local", "--workdir", workdir]);
    process.stdout.write(`Applied pending repository migrations only to ${localProject}. No reset or seed was run.\n`);
  } else if (action === "stop") {
    localSettings();
    execute("supabase", ["stop", "--workdir", workdir]);
    process.stdout.write(`Stopped only ${localProject}; local volumes retained.\n`);
  } else if (action === "check") {
    localSettings();
    const storage = execute("docker", ["ps", "--filter", `name=^supabase_storage_${localProject}$`, "--format", "{{.Names}}"]);
    process.stdout.write(`Verified isolated API 127.0.0.1:56321 and database 127.0.0.1:56322. Storage: ${storage.trim() ? "running" : "not running"}.\n`);
  } else if (action === "serve" || action === "build") {
    const env = localAppEnvironment(localSettings(), mode, port, process.env);
    process.stdout.write(`${action === "serve" ? "Serving" : "Building"} the synthetic development app in ${mode} mode at http://127.0.0.1:${port}. External Portal and email disabled.\n`);
    const server = spawn("npm", action === "serve" ? ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)] : ["run", "build"], { cwd: root, env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
    server.on("error", () => { process.stderr.write("Could not start the local application.\n"); process.exitCode = 1; });
    server.on("exit", code => { process.exitCode = code ?? 1; });
  } else {
    throw new Error("Usage: node scripts/assessment-local.mjs check|start|stop|migrate|serve|build [shadow|live] [3100|3102]");
  }
} catch {
  process.stderr.write("Local assessment command refused or failed. Check Docker, Supabase CLI and the isolated project configuration. No remote fallback is allowed.\n");
  process.exitCode = 1;
}
