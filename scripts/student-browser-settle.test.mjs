import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { trackPageRequests } from "./student-browser-settle.mjs";

test("waits for a streamed request body, not its response headers or an earlier idle state", async () => {
  const page = new EventEmitter();
  const settle = trackPageRequests(page, { quietMs: 1 });
  await settle();
  const request = {};
  page.emit("request", request);
  page.emit("response", request);
  let finished = false;
  const waiting = settle().then(() => { finished = true; });
  await delay(20);
  assert.equal(finished, false);
  page.emit("requestfinished", request);
  await waiting;
  assert.equal(finished, true);
  page.emit("close");
});

test("includes follow-up refresh/prefetch requests and waits for all bodies", async () => {
  const page = new EventEmitter();
  const settle = trackPageRequests(page, { quietMs: 5 });
  const action = {}, refresh = {}, prefetch = {};
  page.emit("request", action);
  let finished = false;
  const waiting = settle().then(() => { finished = true; });
  page.emit("requestfinished", action);
  page.emit("request", refresh);
  page.emit("request", prefetch);
  page.emit("requestfinished", refresh);
  await delay(20);
  assert.equal(finished, false);
  page.emit("requestfinished", prefetch);
  await waiting;
  page.emit("close");
});

test("failed requests finish the wait without removing independent error listeners", async () => {
  const page = new EventEmitter();
  const settle = trackPageRequests(page, { quietMs: 1 });
  const failures = [], request = {};
  page.on("requestfailed", value => failures.push(value));
  page.emit("request", request);
  const waiting = settle();
  page.emit("requestfailed", request);
  await waiting;
  assert.deepEqual(failures, [request]);
  page.emit("close");
});

test("a hung request times out instead of allowing a forced navigation", async () => {
  const page = new EventEmitter();
  const settle = trackPageRequests(page, { quietMs: 1, timeoutMs: 20 });
  page.emit("request", {});
  await assert.rejects(settle(), /1 unfinished/);
  page.emit("close");
});

test("closing a page rejects waiters and removes the tracker listeners", async () => {
  const page = new EventEmitter();
  const settle = trackPageRequests(page);
  const waiting = settle();
  page.emit("close");
  await assert.rejects(waiting, /Page closed/);
  await assert.rejects(settle(), /Page closed/);
  for (const event of ["request", "requestfinished", "requestfailed"]) assert.equal(page.listenerCount(event), 0);
});
