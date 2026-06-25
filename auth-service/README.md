# basecamp-auth-service

A tiny [Hono](https://hono.dev) service that completes the Basecamp OAuth
authorization-code flow and shows you an access token to paste into the
`basecamp-exporter` CLI's `BC_TOKEN`. Built to run on Railway so the OAuth
**redirect URI is a stable public HTTPS URL** and the `client_secret` lives on the
server, not your laptop.

## Routes

| Route        | Purpose                                                            |
| ------------ | ------------------------------------------------------------------ |
| `/`          | Landing page with a "Connect Basecamp" button                      |
| `/login`     | Redirects to Basecamp's authorize page (sets a `state` cookie)     |
| `/callback`  | Exchanges the `code` for tokens and displays the access token      |
| `/healthz`   | Health check (`ok`)                                                |

## Run locally

```bash
bun install
cp .env.example .env   # fill BC_CLIENT_ID / BC_CLIENT_SECRET
bun start              # http://localhost:3000
```

## Docker

```bash
bun install                                   # generate bun.lock first
docker build -t basecamp-auth-service .
docker run --rm -p 3000:3000 \
  -e BC_CLIENT_ID=... -e BC_CLIENT_SECRET=... \
  basecamp-auth-service
```

## Deploy on Railway

1. New service → deploy this repo, set **Root Directory** to `auth-service`
   (Railway auto-detects the `Dockerfile`).
2. Set variables: `BC_CLIENT_ID`, `BC_CLIENT_SECRET`, and `BC_REDIRECT_URI`
   (e.g. `https://<your-service>.up.railway.app/callback`). `PORT` is provided by
   Railway automatically.
3. Register that same `/callback` URL as the **Redirect URI** on your integration
   at <https://launchpad.37signals.com/integrations>.
4. Visit the service URL → **Connect Basecamp** → copy the token into the CLI's
   `.env` as `BC_TOKEN`.
