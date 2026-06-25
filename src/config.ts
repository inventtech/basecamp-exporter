/**
 * Runtime configuration, sourced from environment variables.
 * Bun auto-loads `.env` / `.env.local`, so no dotenv dependency is needed.
 */
/** A ready-to-use config for API calls: the token has already been resolved. */
export interface Config {
  accountId: string;
  token: string;
  userAgent: string;
}

/** Always-required settings for talking to the Basecamp API. */
export interface BaseConfig {
  accountId: string;
  userAgent: string;
}

/** Credentials for the OAuth flow + token refresh (your registered integration). */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const DEFAULT_USER_AGENT = "Basecamp Exporter (basecamp-exporter)";
const DEFAULT_REDIRECT_URI = "http://localhost:3333/callback";

export function loadBaseConfig(): BaseConfig {
  const accountId = process.env.BC_ACCOUNT_ID?.trim();
  const userAgent = process.env.BC_USER_AGENT?.trim() || DEFAULT_USER_AGENT;

  if (!accountId) {
    throw new Error(
      "Missing required environment variable: BC_ACCOUNT_ID.\n" +
        "Copy .env.example to .env and fill it in (see README.md).",
    );
  }
  return { accountId, userAgent };
}

export function loadOAuthCredentials(): OAuthCredentials {
  const clientId = process.env.BC_CLIENT_ID?.trim();
  const clientSecret = process.env.BC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.BC_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;

  const missing: string[] = [];
  if (!clientId) missing.push("BC_CLIENT_ID");
  if (!clientSecret) missing.push("BC_CLIENT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing OAuth credential(s): ${missing.join(", ")}.\n` +
        "Register an integration at https://launchpad.37signals.com/integrations " +
        "to get a client id/secret, then add them to .env.",
    );
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri };
}
