import assert from "node:assert/strict";
import test from "node:test";
import { interruptNextAction } from "./student-browser-faults.mjs";

function fixture() {
  const events = [];
  const page = {
    url: () => "http://127.0.0.1:3100/staff?screen=student",
    route: async (pattern, handler) => { page.pattern = pattern; page.handler = handler; },
    unroute: async (pattern, handler) => { assert.equal(pattern, page.pattern); assert.equal(handler, page.handler); events.push("unroute"); },
  };
  const route = (method = "POST", headers = { "next-action": "synthetic" }) => ({
    request: () => ({ method: () => method, headers: () => headers }),
    continue: async () => { events.push("continue"); },
    abort: async reason => { events.push(`abort:${reason}`); },
    fetch: async options => {
      assert.equal(options.maxRetries, 0); events.push("fetch");
      return { ok: () => true, body: async () => { events.push("body"); } };
    },
  });
  return { page, route, events };
}

test("drops only the next action without sending it, leaving other requests untouched", async () => {
  const { page, route, events } = fixture();
  const verify = await interruptNextAction(page);
  assert.equal(page.pattern(new URL("http://127.0.0.1:3100/staff?screen=entry")), true);
  assert.equal(page.pattern(new URL("http://127.0.0.1:3100/students")), false);
  await page.handler(route("GET"));
  await page.handler(route("POST", {}));
  await page.handler(route());
  await page.handler(route());
  await verify();
  assert.deepEqual(events, ["continue", "continue", "abort:failed", "continue", "unroute"]);
});

test("lost acknowledgement waits for the complete real response before aborting delivery", async () => {
  const { page, route, events } = fixture();
  const verify = await interruptNextAction(page, { afterResponse: true });
  await page.handler(route()); await verify();
  assert.deepEqual(events, ["fetch", "body", "abort:failed", "unroute"]);
});

test("server-side failures are reported rather than mistaken for committed saves", async () => {
  const { page, route, events } = fixture();
  const verify = await interruptNextAction(page, { afterResponse: true });
  await page.handler({ ...route(), fetch: async () => { throw new Error("Server unavailable"); } });
  await assert.rejects(verify(), /Server unavailable/);
  assert.deepEqual(events, ["abort:failed", "unroute"]);
});

test("missing actions fail verification and remove the handler", async () => {
  const { page, events } = fixture();
  const verify = await interruptNextAction(page);
  await assert.rejects(verify(), /not intercepted/);
  assert.deepEqual(events, ["unroute"]);
});

test("fault injection refuses any non-isolated app origin", async () => {
  const { page } = fixture();
  page.url = () => "https://example.com/staff";
  await assert.rejects(interruptNextAction(page), /isolated preview/);
  assert.equal(page.handler, undefined);
});
