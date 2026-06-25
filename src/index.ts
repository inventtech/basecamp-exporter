#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadBaseConfig, loadOAuthCredentials, type Config } from "./config.ts";
import { fetchTodos, type TodoStatus } from "./basecamp.ts";
import { writeXlsx } from "./excel.ts";
import { resolveAccessToken, runAuthFlow, identifyToken } from "./auth.ts";

const HELP = `basecamp-export — export Basecamp to-dos to Excel (.xlsx)

Usage:
  bun start auth              Authorize via OAuth, then cache the token (.bc-auth.json)
  bun start -- [options]      Export to-dos to .xlsx

Options:
  -o, --out <path>     Output .xlsx path (default: exports/basecamp-todos-<date>.xlsx)
      --since <date>   Only to-dos updated on/after this date (e.g. 2026-01-01)
      --months <n>     Shorthand for --since <n> months ago
      --completed      Include completed to-dos (default: only open)
      --status <s>     active | archived | trashed (default: active)
      --bucket <id>    Restrict to a project (bucket) ID; repeatable
  -h, --help           Show this help

Environment (see .env.example):
  BC_ACCOUNT_ID, BC_USER_AGENT        always required
  BC_CLIENT_ID, BC_CLIENT_SECRET      required for \`auth\` (register an integration)
  BC_REDIRECT_URI                     optional (default http://localhost:3333/callback)
  BC_TOKEN                            optional manual token (overrides cached OAuth token)
`;

const VALID_STATUS: TodoStatus[] = ["active", "archived", "trashed"];

function defaultOutPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `exports/basecamp-todos-${date}.xlsx`;
}

function resolveSince(since?: string, months?: string): Date | undefined {
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid --since date: ${since}`);
    return d;
  }
  if (months) {
    const n = Number(months);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --months value: ${months}`);
    return new Date(Date.now() - n * 30 * 864e5);
  }
  return undefined;
}

async function authCommand() {
  const creds = loadOAuthCredentials();
  const base = loadBaseConfig();
  console.error(`Starting OAuth flow (redirect ${creds.redirectUri})...`);

  const tokens = await runAuthFlow(creds);
  console.log(
    `Authorized. Tokens cached in .bc-auth.json (access token expires ${new Date(tokens.expires_at).toLocaleString()}).`,
  );

  // Best-effort: confirm the token can actually reach the configured account.
  try {
    const accounts = await identifyToken(tokens.access_token, base.userAgent);
    const match = accounts.find((a) => String(a.id) === base.accountId);
    if (match) {
      console.log(`Token can access account ${match.id} "${match.name}" (product: ${match.product}).`);
    } else {
      const ids = accounts.map((a) => a.id).join(", ") || "none";
      console.error(`Warning: BC_ACCOUNT_ID=${base.accountId} is not in this token's accounts (${ids}).`);
    }
  } catch {
    /* verification is optional; ignore failures */
  }
}

async function main() {
  const sub = Bun.argv[2];
  if (sub === "auth") {
    await authCommand();
    return;
  }

  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: "string", short: "o" },
      since: { type: "string" },
      months: { type: "string" },
      completed: { type: "boolean", default: false },
      status: { type: "string" },
      bucket: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const status = (values.status ?? "active") as TodoStatus;
  if (!VALID_STATUS.includes(status)) {
    throw new Error(`Invalid --status: ${status}. Expected one of ${VALID_STATUS.join(", ")}.`);
  }

  const base = loadBaseConfig();
  const token = await resolveAccessToken();
  const config: Config = { ...base, token };
  const since = resolveSince(values.since, values.months);
  const buckets = values.bucket?.map((b) => Number(b)).filter((n) => Number.isFinite(n));
  const outPath = values.out ?? defaultOutPath();

  console.error(`Fetching to-dos (status=${status}${values.completed ? ", incl. completed" : ""}${since ? `, since ${since.toISOString().slice(0, 10)}` : ""})...`);

  const todos = await fetchTodos(config, {
    since,
    completed: values.completed,
    status,
    buckets: buckets?.length ? buckets : undefined,
    onProgress: (count) => process.stderr.write(`\r  fetched ${count}...`),
  });
  process.stderr.write("\n");

  if (todos.length === 0) {
    console.error("No to-dos matched. Nothing to export.");
    return;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeXlsx(todos, outPath);
  console.log(`Exported ${todos.length} to-dos -> ${outPath}`);
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
