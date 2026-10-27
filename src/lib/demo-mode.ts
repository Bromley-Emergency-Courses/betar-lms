export function demoDataAllowed(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export function requireDemoDataAllowed(): void {
  if (!demoDataAllowed()) {
    throw new Error("Demo data is disabled outside development and tests. Configure Supabase before serving the LMS.");
  }
}
