# basecamp-exporter

Export [Basecamp](https://3.basecamp.com) to-dos to an Excel (`.xlsx`) file via the
Basecamp API. It pulls to-dos across **every project in one pass** (the recordings
endpoint), filters client-side by date/status, sorts them by **Updated At (newest
first)**, and **highlights** the Created At / Updated At cells that fall in the
current month.

The repo has two parts:

- **root** — the export CLI (Bun + TypeScript).
- **[`auth-service/`](auth-service/)** — a small Hono web app (deployable to Railway)
  that runs the Basecamp OAuth flow and hands you an access token. Use it when you
  can't register a `localhost` redirect URI.

## Requirements

- [Bun](https://bun.sh) 1.2+
- A Basecamp account and an OAuth 2.0 access token (see [Getting a token](#getting-a-token))

## Setup

```bash
bun install
cp .env.example .env   # then fill in the values
```

`.env`:

| Variable                            | What it is                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `BC_ACCOUNT_ID`                     | The number in your Basecamp URL: `https://3.basecamp.com/<ACCOUNT_ID>/...` |
| `BC_USER_AGENT`                     | Required by Basecamp — must identify your app + a contact email           |
| `BC_TOKEN`                          | OAuth access token (see below)                                            |
| `BC_TOKEN_REFRESH`                  | Optional refresh token; with `BC_TOKEN` + client creds, enables auto-refresh |
| `BC_CLIENT_ID` / `BC_CLIENT_SECRET` | OAuth integration credentials (needed for refresh and `bun start auth`)   |
| `BC_REDIRECT_URI`                   | Optional; defaults to `http://localhost:3333/callback`                    |

Bun loads `.env` automatically; no `dotenv` needed.

## Getting a token

Basecamp uses OAuth 2.0 (Basic auth is gone). Register an integration at
<https://launchpad.37signals.com/integrations> to get a **Client ID** / **Client
Secret**, then get a token one of these ways:

### Option A — Hosted auth service (recommended)

Some accounts reject a `http://localhost` redirect URI. The bundled
[`auth-service/`](auth-service/) sidesteps that: deploy it (e.g. on Railway), set its
public `/callback` URL as the integration's Redirect URI, then open the service in a
browser, **Connect Basecamp**, and copy the token it shows into `BC_TOKEN`. See
[`auth-service/README.md`](auth-service/README.md) for deployment.

For unattended runs, also copy the refresh token into `BC_TOKEN_REFRESH` and set
`BC_CLIENT_ID` / `BC_CLIENT_SECRET` — the CLI then refreshes `BC_TOKEN` automatically
once it expires (Basecamp access tokens last 14 days).

### Option B — Local OAuth flow

If you *can* register `http://localhost:3333/callback` as the Redirect URI, run the
flow locally — it opens your browser, captures the redirect, and caches the token in
`.bc-auth.json` (gitignored), refreshing it automatically:

```bash
bun start auth
```

## Usage

```bash
# All open to-dos across the account
bun start

# Last month, including completed ones, to a custom file
bun start -- --months 1 --completed -o exports/last-month.xlsx

# Everything updated since a date
bun start -- --since 2026-01-01

# Archived to-dos for two specific projects
bun start -- --status archived --bucket 123456 --bucket 234567
```

| Option           | Description                                                |
| ---------------- | ---------------------------------------------------------- |
| `-o, --out`      | Output path (default `exports/basecamp-todos-<date>.xlsx`) |
| `--since <date>` | Only to-dos updated on/after this date                     |
| `--months <n>`   | Shorthand for "since N months ago"                         |
| `--completed`    | Include completed to-dos (default: only open)              |
| `--status <s>`   | `active` (default), `archived`, or `trashed`               |
| `--bucket <id>`  | Restrict to a project (bucket) ID; repeatable              |

> Note: `bun start` passes flags through, so put script flags after `--`.
> Running the file directly (`bun run src/index.ts --months 1`) needs no `--`.

## Output

A single `To-dos` sheet with columns: Project, To-do List, Title, Completed,
Assignees, Due On, Created At, Updated At, URL. Rows are sorted by **Updated At,
newest first**; the header is frozen and auto-filter is enabled. Created At /
Updated At cells dated in the **current calendar month** are highlighted yellow.

## Development

```bash
bun test                       # run all tests
bun test src/excel.test.ts     # run a single test file
bun run typecheck              # tsc --noEmit
```

See [`CLAUDE.md`](CLAUDE.md) for architecture and the Basecamp API gotchas that drive
the design.
