const callbackFieldNames = ["next", "token_hash", "type", "invitation_id", "claim_nonce"] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function shouldConfirmPortalEmailCallback(searchParams: URLSearchParams): boolean {
  return Boolean(searchParams.get("token_hash"));
}

export function renderPortalAuthConfirmationPage(searchParams: URLSearchParams): string {
  const fields = callbackFieldNames
    .map((name) => {
      const value = searchParams.get(name);
      return value === null
        ? ""
        : `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Continue to BETAR</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      color: #1f2421;
      background: #f7f5f0;
    }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(100%, 420px);
      background: #ffffff;
      border: 1px solid #ded9cf;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 20px 48px rgba(31, 36, 33, 0.12);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 24px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 20px;
      color: #5c625d;
      line-height: 1.5;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: #1f2421;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      padding: 12px 16px;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid #8fb3ff;
      outline-offset: 2px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Continue to BETAR</h1>
    <p>For security, confirm this sign-in request to open your application.</p>
    <form method="post" action="/auth/callback">
      ${fields}
      <button type="submit">Continue</button>
    </form>
  </main>
</body>
</html>`;
}
