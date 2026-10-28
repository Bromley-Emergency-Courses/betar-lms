import assert from "node:assert/strict";

export async function interruptNextAction(page, { afterResponse = false } = {}) {
  const current = new URL(page.url());
  assert.equal(current.origin, "http://127.0.0.1:3100", "Fault injection is limited to the isolated preview.");
  const pattern = url => url.origin === current.origin && url.pathname === current.pathname;
  let consumed = false;
  let failure;
  const handler = async route => {
    const request = route.request();
    if (consumed || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    consumed = true;
    try {
      if (afterResponse) {
        const response = await route.fetch({ maxRetries: 0 });
        assert.equal(response.ok(), true);
        await response.body();
      }
    } catch (error) { failure = error; }
    finally { await route.abort("failed"); }
  };
  await page.route(pattern, handler);
  return async () => {
    await page.unroute(pattern, handler);
    assert.equal(consumed, true, "The intended Server Action was not intercepted.");
    if (failure) throw failure;
  };
}
