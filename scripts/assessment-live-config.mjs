export const liveProject = "assessment-yangon-live-rehearsal";
export const liveContainer = `supabase_db_${liveProject}`;
export const liveWorkdir = "dev/assessment-live";

export function validateLiveProject(content) {
  let section = ""; const values = {};
  for (const line of content.split("\n")) {
    const heading = line.match(/^\[([\w.]+)\]$/); if (heading) section = `${heading[1]}.`;
    const entry = line.match(/^([\w_]+)\s*=\s*(.*?)\s*$/); if (entry) values[`${section}${entry[1]}`] = entry[2];
  }
  if (values.project_id !== `"${liveProject}"` || values["api.port"] !== "57321" || values["db.port"] !== "57322" || values["db.shadow_port"] !== "57320" || values["db.seed.enabled"] !== "false") throw new Error("Refusing an unexpected live-rehearsal project.");
}

export function validateLiveSettings(settings) {
  const database = new URL(settings.DB_URL);
  if (settings.API_URL !== "http://127.0.0.1:57321" || database.hostname !== "127.0.0.1" || database.port !== "57322" || database.pathname !== "/postgres" || !settings.ANON_KEY || !settings.SERVICE_ROLE_KEY) throw new Error("Refusing an unexpected live-rehearsal target.");
  return settings;
}

export function liveAppEnvironment(settings, mode, workspace = true, inherited = {}) {
  validateLiveSettings(settings);
  if (!["off", "shadow", "live"].includes(mode)) throw new Error("Invalid rehearsal mode.");
  return { ...inherited, NEXT_PUBLIC_SUPABASE_URL: settings.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: settings.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: settings.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3102",
    ASSESSMENT_WORKFLOW_MODE: mode, STUDENT_WORKSPACE_ENABLED: String(workspace), ASSESSMENT_LOCAL_LIVE_REHEARSAL: "true",
    ADMISSIONS_EMAIL_ENABLED: "false", EXAM_PORTAL_LMS_RESULTS_URL: "", EXAM_PORTAL_LMS_EXAMS_URL: "", EXAM_PORTAL_LMS_API_SECRET: "", EXAM_ADAPTER_SHARED_SECRET: "" };
}
