import assert from "node:assert/strict";
import test from "node:test";
import { studentBrowser } from "./student-browser.mjs";

test("student checks default to Chromium and explicitly select each supported engine", () => {
  assert.equal(studentBrowser().name(), "chromium");
  for (const name of ["chromium", "firefox", "webkit"]) assert.equal(studentBrowser(name).name(), name);
});

test("unknown browser names fail instead of silently running a different engine", () => {
  for (const name of ["", "safari", "Chrome", "constructor", "all"]) assert.throws(() => studentBrowser(name), /Choose chromium, firefox or webkit/);
});
