export function trackPageRequests(page, { quietMs = 500, timeoutMs = 15000 } = {}) {
  const pending = new Set();
  const waiters = new Set();
  let closed = false;
  const started = request => { pending.add(request); notify(); };
  const ended = request => { pending.delete(request); notify(); };
  function notify() { for (const update of waiters) update(); }
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  page.once("close", () => {
    closed = true;
    page.off("request", started);
    page.off("requestfinished", ended);
    page.off("requestfailed", ended);
    notify();
  });
  return function settle() {
    return new Promise((resolve, reject) => {
      let quietTimer;
      const deadline = setTimeout(() => finish(new Error(`Page requests did not settle within ${timeoutMs}ms (${pending.size} unfinished).`)), timeoutMs);
      function finish(error) {
        clearTimeout(quietTimer);
        clearTimeout(deadline);
        waiters.delete(update);
        if (error) reject(error);
        else resolve();
      }
      function update() {
        clearTimeout(quietTimer);
        if (closed) finish(new Error("Page closed before requests settled."));
        else if (!pending.size) quietTimer = setTimeout(() => finish(), quietMs);
      }
      waiters.add(update);
      update();
    });
  };
}
