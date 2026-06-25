import { loadOAuthCredentials, type OAuthCredentials } from "./config.ts";

const LAUNCHPAD = "https://launchpad.37signals.com";
/** Token cache, relative to the current working directory. Gitignored. */
const TOKEN_CACHE = ".bc-auth.json";
const DEFAULT_EXPIRES_IN = 1_209_600; // 14 days, per Basecamp docs
/** Refresh this long before actual expiry to avoid using a token mid-flight. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/** Persisted token set. `expires_at` is derived from the response `expires_in`. */
export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO 8601
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Pure mapping from a token endpoint response to a persisted `TokenSet`. */
export function buildTokenSet(res: TokenResponse, fallbackRefresh?: string): TokenSet {
  const expiresAt = new Date(Date.now() + (res.expires_in ?? DEFAULT_EXPIRES_IN) * 1000);
  const refresh = res.refresh_token ?? fallbackRefresh;
  if (!res.access_token || !refresh) {
    throw new Error("Token endpoint did not return the expected access/refresh tokens.");
  }
  return { access_token: res.access_token, refresh_token: refresh, expires_at: expiresAt.toISOString() };
}

async function readCache(): Promise<TokenSet | null> {
  const file = Bun.file(TOKEN_CACHE);
  if (!(await file.exists())) return null;
  return (await file.json()) as TokenSet;
}

async function writeCache(tokens: TokenSet): Promise<void> {
  await Bun.write(TOKEN_CACHE, JSON.stringify(tokens, null, 2) + "\n");
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${LAUNCHPAD}/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status} ${res.statusText}): ${body}`);
  }
  return (await res.json()) as TokenResponse;
}

async function exchangeCode(creds: OAuthCredentials, code: string): Promise<TokenSet> {
  const res = await postToken({
    grant_type: "authorization_code",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: creds.redirectUri,
    code,
  });
  return buildTokenSet(res);
}

async function refreshTokens(creds: OAuthCredentials, refreshToken: string): Promise<TokenSet> {
  // Basecamp's refresh response omits a new refresh_token, so we keep the old one.
  const res = await postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  return buildTokenSet(res, refreshToken);
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* browser couldn't be opened automatically; the URL is printed instead */
  }
}

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;padding:2rem">${body}`, {
    headers: { "Content-Type": "text/html" },
  });
}

/** Spin up a one-shot local server, capture the OAuth `code` from the redirect. */
function waitForCode(redirectUri: string, expectedState: string): Promise<string> {
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port) || 80;
  const callbackPath = redirect.pathname || "/";

  return new Promise<string>((resolve, reject) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== callbackPath) return new Response("Not found", { status: 404 });

        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        const finish = (cb: () => void) => {
          clearTimeout(timer);
          setTimeout(() => server.stop(true), 100);
          cb();
        };

        if (error) {
          finish(() => reject(new Error(`Authorization denied: ${error}`)));
          return html("Authorization failed. You can close this tab and return to the terminal.");
        }
        if (state !== expectedState) {
          finish(() => reject(new Error("OAuth state mismatch — aborting for safety.")));
          return html("State mismatch. Please retry from the terminal.");
        }
        if (!code) return new Response("Missing authorization code", { status: 400 });

        finish(() => resolve(code));
        return html("Authorized! You can close this tab and return to the terminal.");
      },
    });

    const timer = setTimeout(() => {
      server.stop(true);
      reject(new Error("Timed out waiting for the OAuth callback."));
    }, CALLBACK_TIMEOUT_MS);

    const authUrl =
      `${LAUNCHPAD}/authorization/new?response_type=code` +
      `&client_id=${encodeURIComponent(currentClientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(expectedState)}`;

    console.error(`Listening on ${redirectUri} for the OAuth callback...`);
    console.error(`If your browser didn't open, visit:\n  ${authUrl}\n`);
    openBrowser(authUrl);
  });
}

// `waitForCode` needs the client id to build the auth URL; set by `runAuthFlow`.
let currentClientId = "";

/** Run the interactive authorization-code flow and cache the resulting tokens. */
export async function runAuthFlow(creds: OAuthCredentials): Promise<TokenSet> {
  currentClientId = creds.clientId;
  const state = crypto.randomUUID();
  const code = await waitForCode(creds.redirectUri, state);
  const tokens = await exchangeCode(creds, code);
  await writeCache(tokens);
  return tokens;
}

/**
 * Best-effort extraction of the `expires_at` embedded in a Basecamp access token.
 * The token is a signed `<base64 payload>--<signature>` blob whose payload contains
 * a JSON fragment with `expires_at`. Returns null if it can't be parsed, in which
 * case callers should treat the token as due for a refresh.
 */
export function decodeBasecampExpiry(token: string): string | null {
  try {
    const payload = token.split("--")[0] ?? "";
    const decoded = Buffer.from(payload, "base64").toString("latin1");
    const match = decoded.match(/"expires_at":"([^"]+)"/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a usable access token for API calls. Resolution order:
 *  1. `BC_TOKEN` + `BC_TOKEN_REFRESH` env vars: use `BC_TOKEN` while valid (by its
 *     embedded expiry), otherwise refresh it via the refresh token + client creds.
 *  2. `BC_TOKEN` alone: used as-is, never refreshed.
 *  3. The OAuth token cached by `bun start auth`, refreshed automatically.
 * Throws with guidance if none is available.
 */
export async function resolveAccessToken(): Promise<string> {
  const manual = process.env.BC_TOKEN?.trim();
  const envRefresh = process.env.BC_TOKEN_REFRESH?.trim();

  if (manual && envRefresh) {
    const expiresAt = decodeBasecampExpiry(manual);
    const stillValid = expiresAt !== null && Date.parse(expiresAt) - Date.now() > REFRESH_SKEW_MS;
    if (stillValid) return manual;
    const refreshed = await refreshTokens(loadOAuthCredentials(), envRefresh);
    return refreshed.access_token;
  }

  if (manual) return manual;

  const cache = await readCache();
  if (!cache) {
    throw new Error(
      "No access token available. Run `bun start auth` to authorize, or set BC_TOKEN in .env.",
    );
  }

  const stillValid = Date.parse(cache.expires_at) - Date.now() > REFRESH_SKEW_MS;
  if (stillValid) return cache.access_token;

  const refreshed = await refreshTokens(loadOAuthCredentials(), cache.refresh_token);
  await writeCache(refreshed);
  return refreshed.access_token;
}

export interface BasecampAccount {
  id: number;
  name: string;
  product: string;
  href: string;
}

/** Look up which accounts a token can access (for post-auth verification). */
export async function identifyToken(accessToken: string, userAgent: string): Promise<BasecampAccount[]> {
  const res = await fetch(`${LAUNCHPAD}/authorization.json`, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`authorization.json failed (${res.status})`);
  const data = (await res.json()) as { accounts?: BasecampAccount[] };
  return data.accounts ?? [];
}
