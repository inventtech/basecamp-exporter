# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Bun + TypeScript CLI that exports Basecamp to-dos to an Excel `.xlsx` file.
It runs straight from TypeScript source via Bun — no build step.

The repo has two deployables:
- **root** — the export CLI (this document's main focus).
- **`auth-service/`** — a small standalone Hono web app (its own `package.json` +
  `Dockerfile`, meant for Railway) that runs the OAuth callback and hands back an
  access token to paste into the CLI's `BC_TOKEN`. It shares no code with the CLI.

## Commands

```bash
bun install            # install dependencies
bun start auth         # OAuth flow: opens browser, caches token to .bc-auth.json
bun start -- <flags>   # run the exporter (flags after `--`; see README for options)
bun run src/index.ts <flags>   # run directly (no `--` needed)
bun test               # run all tests
bun test src/auth.test.ts      # run a single test file
bun run typecheck      # tsc --noEmit (no JS is ever emitted)
```

Bun auto-loads `.env` / `.env.local` (no dotenv dependency). Vars: `BC_ACCOUNT_ID`
+ `BC_USER_AGENT` are always required; `BC_CLIENT_ID` + `BC_CLIENT_SECRET`
(+ optional `BC_REDIRECT_URI`) are needed for `auth`; `BC_TOKEN` is an optional
manual override, and `BC_TOKEN_REFRESH` (alongside `BC_TOKEN` + client creds)
enables env-based auto-refresh. See `.env.example`.

## Architecture

One-directional pipeline, one module per stage:

```
CLI (index.ts) ─ auth ─→ auth.ts (OAuth flow → .bc-auth.json)
              └ export ─→ config + auth.ts (resolve token) → basecamp.ts (fetch) → excel.ts (write .xlsx)
                                   ↑ types.ts (shared shapes)
```

- **`auth.ts`** owns OAuth. `runAuthFlow` does the interactive authorization-code
  flow (spins up `Bun.serve` on the redirect port, opens the browser, exchanges the
  code) and caches a `TokenSet` to `.bc-auth.json`. `resolveAccessToken` picks a token
  in three modes: (1) `BC_TOKEN` + `BC_TOKEN_REFRESH` → use `BC_TOKEN` while valid (its
  expiry is read from the token itself via `decodeBasecampExpiry`), else refresh via the
  refresh token + client creds; (2) `BC_TOKEN` alone → used as-is, never refreshed;
  (3) the `.bc-auth.json` cache → auto-refreshed within 5 min of expiry. `buildTokenSet`
  is the pure, tested response→`TokenSet` mapping. Token endpoints use the standard OAuth
  params (`grant_type=...`), not the legacy `type=web_server`.
- **`config.ts`** reads + validates env: `loadBaseConfig` (account + user-agent,
  always required) and `loadOAuthCredentials` (client id/secret/redirect, for auth).
  `index.ts` combines a `BaseConfig` with the resolved token into the `Config` that
  `fetchTodos` consumes.
- **`basecamp.ts`** is the API client. `fetchTodos(config, opts)` is the single
  entry point; everything else is internal except `nextLink` (exported only for
  testing).
- **`excel.ts`** owns all output formatting. The `COLUMNS` array is the single
  place that defines column order, headers, widths, and how each to-do field maps
  to a cell — change output here, not in the CLI. It sorts rows by `updated_at`
  descending and paints the Created At / Updated At cells yellow (`FFFFFF00`) when
  `isInMonth` says they fall in the current calendar month.
- **`index.ts`** parses flags with Node's `util.parseArgs` (no CLI dependency),
  translates them into `FetchTodosOptions`, and wires the stages together.

## Basecamp API specifics (the non-obvious parts)

These constraints drive the client design and are easy to get wrong:

- **API generation != product version.** The host stays `3.basecampapi.com`
  regardless of the marketing version (Basecamp 3/4/5). The current product is
  Basecamp 5 (May 2026), but the docs at `github.com/basecamp/bc3-api` dropped the
  version label and just call it "the Basecamp API". Do **not** bump the `3` in
  the host or assume a `/v5` prefix exists. (Basecamp 5 added an *official* CLI and
  extended the API for AI agents — that is separate from this tool.)
- **Recordings endpoint, not per-project walking.** We query
  `GET /projects/recordings.json?type=Todo` against
  `https://3.basecampapi.com/<ACCOUNT_ID>`. One paginated query returns to-dos
  from *every* project; each to-do carries its `bucket` (= project) and `parent`
  (= to-do list), so grouping is done client-side. Do not reintroduce
  project-by-project traversal.
- **Auth is OAuth 2.0 Bearer only** (no Basic auth) and Basecamp **rejects
  requests without a descriptive `User-Agent`** that includes a contact email —
  both headers are mandatory on every request.
- **Pagination is via the `Link` header** (`rel="next"`), parsed by `nextLink`.
  There is no `page`/`offset` param to construct manually; follow the header.
- **No server-side date filter.** There is no `since`/`from` param. Results come
  sorted `updated_at desc`, so `fetchTodos` filters client-side and
  **short-circuits pagination** the moment it crosses the `since` cutoff — keep
  this early-return; it avoids downloading the whole account.
- **Default scope is active + incomplete.** Use `completed=true` for completed
  to-dos and `status=archived` / `status=trashed` for non-active ones. `&bucket=`
  (comma-separated IDs) scopes to specific projects.
- **Rate limit** is ~50 requests / 10s; on HTTP 429 the client honors
  `Retry-After` and retries the same URL.

## Tooling & deployment

- **Bun** is the only runtime: package manager (`bun install`), task runner
  (`bun run`/`bun start`), test runner (`bun test`), and it executes `.ts` directly
  (no compile step; `typecheck` is type-checking only).
- **`auth-service/`** deploys to **Railway** and builds from its `Dockerfile`
  (`oven/bun:1-alpine`). Deploy with `cd auth-service && bun run deploy`
  (= `railway up -s basecamp-auth`); the directory is already `railway link`-ed to the
  `basecamp-auth` service. **Docker** is only needed to build/run the image locally.
  Live service: `https://basecamp-auth-production.up.railway.app`.
- Secrets live in `.env` / Railway variables (`BC_CLIENT_SECRET`, tokens) and are
  gitignored — never commit them. Generated `exports/*.xlsx` (real Basecamp data) and
  `.bc-auth.json` are gitignored too.

## Conventions

- Strict TypeScript with `noUncheckedIndexedAccess`. Relative imports use explicit
  `.ts` extensions (`allowImportingTsExtensions`); keep that style.
- All code, comments, and commit messages in English (en-US).
