export const localProject = "assessment-yangon-49";
export const localContainer = `supabase_db_${localProject}`;
export const localApi = "http://127.0.0.1:56321";

export function validateLocalProjectConfig(content) {
  const values = {};
  let section = "";
  for (const line of content.split("\n")) {
    const heading = line.match(/^\[([\w.]+)\]$/);
    if (heading) section = `${heading[1]}.`;
    const entry = line.match(/^([\w_]+)\s*=\s*(.*?)\s*$/);
    if (entry) values[`${section}${entry[1]}`] = entry[2];
  }
  if (values.project_id !== `"${localProject}"` || values["api.port"] !== "56321" || values["db.port"] !== "56322" || values["db.shadow_port"] !== "56320" || values["db.seed.enabled"] !== "false") {
    throw new Error("Refusing an unexpected local project configuration.");
  }
}

export function validateLocalSettings(settings) {
  if (settings.API_URL !== localApi) throw new Error("Refusing an unexpected Supabase API target.");
  const database = new URL(settings.DB_URL);
  if (database.hostname !== "127.0.0.1" || database.port !== "56322" || database.pathname !== "/postgres") {
    throw new Error("Refusing an unexpected database target.");
  }
  if (!settings.ANON_KEY || !settings.SERVICE_ROLE_KEY) throw new Error("The local stack did not supply authentication keys.");
  return settings;
}

export function localAppEnvironment(settings, mode, port, inherited = {}) {
  validateLocalSettings(settings);
  if (!["shadow", "live"].includes(mode)) throw new Error("Choose shadow or live for the isolated app.");
  if (![3100, 3102].includes(port)) throw new Error("Choose local application port 3100 or 3102.");
  return {
    ...inherited,
    NEXT_PUBLIC_SUPABASE_URL: localApi,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: settings.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: settings.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    ASSESSMENT_WORKFLOW_MODE: mode,
    STUDENT_WORKSPACE_ENABLED: "true",
    ADMISSIONS_EMAIL_ENABLED: "false",
    EXAM_PORTAL_LMS_RESULTS_URL: "",
    EXAM_PORTAL_LMS_EXAMS_URL: "",
    EXAM_PORTAL_LMS_API_SECRET: "",
    EXAM_ADAPTER_SHARED_SECRET: ""
  };
}
