import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const LAUNCHPAD = "https://launchpad.37signals.com";

const app = new Hono();

/** Escape untrusted text before embedding it in HTML. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1.25rem;color:#1c1c1c}
  h1{font-size:1.4rem} code,pre{background:#f4f4f5;border-radius:6px}
  code{padding:.15rem .35rem} pre{padding:1rem;overflow:auto;word-break:break-all;white-space:pre-wrap}
  .btn{display:inline-block;background:#1a7f37;color:#fff;text-decoration:none;padding:.6rem 1rem;border-radius:8px}
  .muted{color:#666;font-size:.9rem} .warn{color:#9a3412}
</style></head><body>${body}</body></html>`;
}

/** The exact redirect URI registered on the integration. Must match on both legs. */
function redirectUri(host: string): string {
  return process.env.BC_REDIRECT_URI?.trim() || `https://${host}/callback`;
}

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.BC_CLIENT_ID?.trim();
  const clientSecret = process.env.BC_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

app.get("/healthz", (c) => c.text("ok"));

app.get("/", (c) => {
  const configured = credentials() !== null;
  return c.html(
    page(
      "Basecamp Token Helper",
      `<h1>Basecamp Token Helper</h1>
      <p>Authorize this app with your Basecamp account to get an access token for
      the <code>basecamp-exporter</code> CLI.</p>
      ${
        configured
          ? `<p><a class="btn" href="/login">Connect Basecamp</a></p>`
          : `<p class="warn">Server is missing <code>BC_CLIENT_ID</code> / <code>BC_CLIENT_SECRET</code>.</p>`
      }`,
    ),
  );
});

app.get("/login", (c) => {
  const creds = credentials();
  if (!creds) return c.html(page("Not configured", `<p class="warn">Missing client credentials.</p>`), 500);

  const state = crypto.randomUUID();
  setCookie(c, "bc_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });

  const url = new URL(`${LAUNCHPAD}/authorization/new`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri(c.req.header("host") ?? ""));
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

app.get("/callback", async (c) => {
  const creds = credentials();
  if (!creds) return c.html(page("Not configured", `<p class="warn">Missing client credentials.</p>`), 500);

  const error = c.req.query("error");
  if (error) return c.html(page("Authorization failed", `<h1>Authorization failed</h1><p class="warn">${esc(error)}</p>`), 400);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, "bc_state");
  if (!code || !state || state !== cookieState) {
    return c.html(page("Invalid request", `<h1>Invalid request</h1><p class="warn">Missing code or state mismatch. <a href="/login">Try again</a>.</p>`), 400);
  }

  const res = await fetch(`${LAUNCHPAD}/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri(c.req.header("host") ?? ""),
      code,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return c.html(page("Token exchange failed", `<h1>Token exchange failed</h1><pre>${esc(`${res.status} ${res.statusText}\n${detail}`)}</pre>`), 502);
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const expiresDays = Math.round((tokens.expires_in ?? 1_209_600) / 86_400);

  return c.html(
    page(
      "Your Basecamp access token",
      `<h1>✅ Authorized</h1>
      <p>Paste this into <code>BC_TOKEN</code> in your local <code>.env</code>:</p>
      <pre>${esc(tokens.access_token)}</pre>
      <p class="muted">Expires in ~${expiresDays} days. Re-visit this page to get a fresh token.</p>
      ${
        tokens.refresh_token
          ? `<details><summary class="muted">Refresh token (advanced)</summary><pre>${esc(tokens.refresh_token)}</pre></details>`
          : ""
      }
      <p class="warn">This token grants access to your Basecamp account — keep it secret.</p>`,
    ),
  );
});

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
};
