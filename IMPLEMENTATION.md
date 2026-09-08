# SecureShare — Three-Domain Split: Implementation Runbook

**Status:** planned, not yet applied.
**Trigger:** read this file and execute it when told.

**Genetech Solutions — Your AI Solution Partner**

---

## Contents

| # | Section |
|---|---|
| 0 | [Goal and target state](#0--goal-and-target-state) |
| 1 | [Prerequisites — check before starting](#1--prerequisites--check-before-starting) |
| 2 | [Code changes](#2--code-changes) |
| 3 | [Commit and push to GitHub](#3--commit-and-push-to-github) |
| 4 | [Redeploy on the server](#4--redeploy-on-the-server) |
| 5 | [Verification](#5--verification) |
| 6 | [Rollback](#6--rollback) |
| 7 | [Gotchas](#7--gotchas--read-before-executing) |

---

# 0 — Goal and target state

Three hostnames, each saying what it is.

| Domain | Serves | Port | What appears there |
|---|---|---|---|
| `priv-staff.genetechsolutions.com` | `dist/staff` | **4173** | login, `/create`, `/request`, dashboard, audit |
| `priv.genetechsolutions.com` | `dist/public` | **4174** | `/s/<token>` — secrets **we send out** |
| `priv-req.genetechsolutions.com` | `dist/public` | **4174** | `/r/<token>` — credentials **we ask for** |

```
  employee at /create   ->  link reads  https://priv.genetechsolutions.com/s/<token>
  employee at /request  ->  link reads  https://priv-req.genetechsolutions.com/r/<token>
  employee signs in at              https://priv-staff.genetechsolutions.com
```

## What changes from today

| | Now | After |
|---|---|---|
| `priv.` serves | `dist/staff` (4173) | **`dist/public` (4174)** |
| `priv-req.` serves | `dist/public` (4174) | `dist/public` (4174) — unchanged |
| `priv-staff.` | does not exist | **`dist/staff` (4173)** |
| Link generation | one variable for both | **two variables, one per flow** |

**Only `priv.` swaps its bundle.** That single swap is what removes the staff login page from the domain clients receive links on.

## What does NOT change

- **PM2 stays at two processes.** `priv.` and `priv-req.` both proxy to 4174, the same `serve` instance. No third process.
- **No frontend code change.** Verified: `Frontend/src/` hardcodes no application domain — only a marketing link in the footer and an email placeholder in `Create.tsx`.
- **No database change.** Tokens are opaque; the hostname is never stored.
- **The security boundary is unchanged.** It was always staff-bundle vs public-bundle, and both public hostnames serve the same bundle with zero staff code in it.

---

# 1 — Prerequisites — check before starting

## DNS

All three must resolve to the server before touching nginx or certbot:

```bash
dig +short priv-staff.genetechsolutions.com
dig +short priv.genetechsolutions.com
dig +short priv-req.genetechsolutions.com
```

`priv-staff` is the new record. **If it does not resolve, stop** — certbot will fail its challenge and consume a rate-limit attempt.

## Server access

```
host: 66.51.159.99   port: 8022   user: dev01
repo: ~/Secure-Share
```

Helper already written: `scratchpad/ssh.py` (reads a script on stdin). The NAT drops sessions
often — retry loops are expected, they are not failures.

## Record current state, for rollback

```bash
cd ~/Secure-Share
cp .env .env.bak.$(date +%s)
sudo cp -r /etc/nginx/sites-available /root/nginx-sites-backup-$(date +%F)
git log --oneline -1
```

---

# 2 — Code changes

Four files. Roughly ten lines of real change.

## 2.1 — `Backend/config.py`

One variable becomes two, with a fallback chain so an un-updated `.env` still boots.

**Find (around line 14):**

```python
# The origin staff use (CORS + CSRF Origin check).
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
# The origin baked into share links — the PUBLIC host clients open. In a
# two-hostname deployment this differs from FRONTEND_ORIGIN.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", FRONTEND_ORIGIN)
```

**Replace with:**

```python
# The origin staff use (CORS + CSRF Origin check). The STAFF hostname.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

# The two client-facing origins. They are separate because the two flows are
# separate products from the client's point of view:
#
#   SECRET_BASE_URL   /s/<token>   we SEND a credential to them
#   REQUEST_BASE_URL  /r/<token>   we ASK them for a credential
#
# Both serve the same public bundle, so this is a naming boundary, not a
# security one -- the security boundary is staff-bundle vs public-bundle and
# lives in the build, not in DNS.
#
# PUBLIC_BASE_URL is the pre-split name and is honoured as a fallback, so a
# deployment whose .env has not been updated keeps working with both link types
# on one host rather than failing to start.
# `or`, NOT os.getenv(name, default). docker-compose passes an EMPTY STRING for
# an unset variable written as ${VAR:-}, and os.getenv then returns "" rather
# than the default -- which would emit links like "/s/<token>" with no host at
# all. `or` treats empty and absent identically, which is what we want.
_PUBLIC_FALLBACK = os.getenv("PUBLIC_BASE_URL") or FRONTEND_ORIGIN
SECRET_BASE_URL = os.getenv("SECRET_BASE_URL") or _PUBLIC_FALLBACK
REQUEST_BASE_URL = os.getenv("REQUEST_BASE_URL") or _PUBLIC_FALLBACK
```

> Do **not** delete `PUBLIC_BASE_URL` from the environment or compose files. The
> fallback is what makes this change safe to deploy before `.env` is updated.

## 2.2 — `Backend/routes_sender.py` (~line 105)

**Find:**

```python
    # The URL comes from PUBLIC_BASE_URL, not from the staff member's own origin,
    # so a link created on the internal host still points at the public one.
    return schemas.CreateOut(
        token=token, tid=tid, url=f"{config.PUBLIC_BASE_URL}/s/{token}", expires_at=expires_at
    )
```

**Replace with:**

```python
    # The URL comes from SECRET_BASE_URL, not from the staff member's own origin,
    # so a link created on the internal host still points at the client one.
    return schemas.CreateOut(
        token=token, tid=tid, url=f"{config.SECRET_BASE_URL}/s/{token}", expires_at=expires_at
    )
```

## 2.3 — `Backend/routes_requests.py` (~line 99)

**Find:**

```python
        url=f"{config.PUBLIC_BASE_URL}/r/{token}",
```

**Replace with:**

```python
        # REQUEST_BASE_URL, not SECRET_BASE_URL: this link asks a client to send
        # US a credential, and goes out on the request hostname.
        url=f"{config.REQUEST_BASE_URL}/r/{token}",
```

## 2.4 — `docker-compose.yml` (~line 66)

The backend container only sees variables listed here. Without this the new
settings never reach it and both link types silently fall back to one host.

**Find:**

```yaml
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:5173}
```

**Replace with:**

```yaml
      # Pre-split fallback. Kept so an old .env still works.
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:5173}
      # /s/<token> links -- secrets we send to clients.
      SECRET_BASE_URL: ${SECRET_BASE_URL:-}
      # /r/<token> links -- credentials we ask clients for.
      REQUEST_BASE_URL: ${REQUEST_BASE_URL:-}
```

> ⚠️ `${VAR:-}` passes an **empty string**, not an absent variable. That is
> exactly why `config.py` in 2.1 uses `os.getenv(...) or fallback` rather than
> `os.getenv(name, default)` — the latter returns `""` here and would emit links
> like `/s/<token>` with no host. The two changes are a pair; applying 2.4
> without 2.1 breaks link generation.
>
> Section 5.2 prints the resolved values and catches it either way.

## 2.5 — `deploy/nginx.conf` (reference copy in the repo)

Rewrite to three server blocks. This file is documentation — the live configs on
the server are per-domain files (section 4.3) — but keep it accurate.

```nginx
#   priv-staff.genetechsolutions.com  ->  127.0.0.1:4173   dist/staff
#   priv.genetechsolutions.com        ->  127.0.0.1:4174   dist/public  (/s/)
#   priv-req.genetechsolutions.com    ->  127.0.0.1:4174   dist/public  (/r/)
#   /api/ on ALL THREE                ->  127.0.0.1:8000
```

Each block keeps `client_max_body_size 8m` and all four `proxy_set_header` lines.

## 2.6 — `deploy/env.production.example`

```ini
FRONTEND_ORIGIN=https://priv-staff.genetechsolutions.com
SECRET_BASE_URL=https://priv.genetechsolutions.com
REQUEST_BASE_URL=https://priv-req.genetechsolutions.com
ALLOWED_HOSTS=priv-staff.genetechsolutions.com,priv.genetechsolutions.com,priv-req.genetechsolutions.com,backend
```

Leave `PUBLIC_BASE_URL` in the file, commented, noting it is the pre-split fallback.

## 2.7 — Local check before committing

```bash
cd "F:/Arqam/link sharing app/Frontend"
npx tsc -b --pretty false        # must print nothing
npm run build                    # both bundles must build
```

The frontend is untouched, but build it anyway — it costs 30 seconds and proves
nothing was disturbed.

---

# 3 — Commit and push to GitHub

**Repo:** `https://github.com/Arqam-Ansari-123/Secure-Share.git`, branch `main`.

## 3.1 — Secret scan first, always

The patterns are **read out of the local `.env`** rather than written here — a
runbook that hardcodes the secrets it scans for is itself a leak, and this way the
check stays correct after any rotation.

```bash
cd "F:/Arqam/link sharing app"
git add -A
git diff --cached --name-status

python - <<'PY'
import io, subprocess
staged = subprocess.run(['git','diff','--cached'], capture_output=True, text=True).stdout
env = io.open('.env', encoding='utf-8').read()
vals = []
for line in env.splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        if any(t in k for t in ('PASSWORD','SECRET','PEPPER')) and len(v.strip()) >= 8:
            vals.append((k, v.strip()))
bad = [k for k, v in vals if v in staged]
print('secrets checked :', len(vals))
print('LEAKED          :', bad if bad else 'none')
PY

git diff --cached --name-only | grep -cx '.env'    # -> 0
git diff --cached --name-only | grep -cx 'IT.md'   # -> 0
git diff --cached --name-only | grep -cE 'node_modules|Frontend/dist'   # -> 0
```

`LEAKED: none` and three zeros, or stop and investigate.

**Every one must be `0`.** If any is not, stop and investigate.

```bash
git check-ignore -q .env  && echo ".env ignored"
git check-ignore -q IT.md && echo "IT.md ignored"
```

## 3.2 — Commit

```bash
git commit -F - <<'MSG'
Split share and request links onto separate client domains

/create links now go out on priv., /request links on priv-req., and the
staff application moves to priv-staff. Each hostname now describes the one
thing it does.

PUBLIC_BASE_URL drove both link types, so the split needs a config change:
SECRET_BASE_URL (/s/) and REQUEST_BASE_URL (/r/), with PUBLIC_BASE_URL kept
as a fallback so a deployment whose .env has not been updated keeps working
instead of failing to start.

priv. changes which bundle it serves -- staff to public. That is the point
of the change: a client receiving a share link can no longer reach the staff
login page, because that code is not on the domain at all.

Both public hostnames proxy to the same port and the same bundle, so PM2
stays at two processes and no frontend change is needed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

## 3.3 — Push

```bash
git push origin main
```

> `git push` has been **blocked by the permission classifier** in past sessions.
> If it is refused, stop and ask the user to run that one command, then continue
> from section 4. Do not attempt to work around it.

## 3.4 — Confirm it landed

```bash
git fetch origin
git rev-parse main
git rev-parse origin/main        # must match
```

---

# 4 — Redeploy on the server

## 4.1 — Pull the code

The server has one long-standing local edit — `Frontend/ecosystem.config.cjs`,
the `/usr/bin/serve` absolute path. That fix is now in the repo, so the local copy
can be discarded safely.

```bash
cd ~/Secure-Share
git status --porcelain          # expect: M Frontend/ecosystem.config.cjs
git checkout -- Frontend/ecosystem.config.cjs
git pull origin main
git log --oneline -1
```

Confirm the PM2 path survived the pull:

```bash
grep -n "script:" Frontend/ecosystem.config.cjs     # must show /usr/bin/serve
```

## 4.2 — Update `.env`

```bash
cd ~/Secure-Share
cp .env .env.bak.$(date +%s)

sed -i 's|^FRONTEND_ORIGIN=.*|FRONTEND_ORIGIN=https://priv-staff.genetechsolutions.com|' .env
sed -i 's|^ALLOWED_HOSTS=.*|ALLOWED_HOSTS=priv-staff.genetechsolutions.com,priv.genetechsolutions.com,priv-req.genetechsolutions.com,backend|' .env

# replace the single PUBLIC_BASE_URL line with the two new ones
sed -i 's|^PUBLIC_BASE_URL=.*|SECRET_BASE_URL=https://priv.genetechsolutions.com\nREQUEST_BASE_URL=https://priv-req.genetechsolutions.com|' .env

grep -E '^(FRONTEND_ORIGIN|SECRET_BASE_URL|REQUEST_BASE_URL|ALLOWED_HOSTS)=' .env
```

Expected:

```
FRONTEND_ORIGIN=https://priv-staff.genetechsolutions.com
SECRET_BASE_URL=https://priv.genetechsolutions.com
REQUEST_BASE_URL=https://priv-req.genetechsolutions.com
ALLOWED_HOSTS=priv-staff.genetechsolutions.com,priv.genetechsolutions.com,priv-req.genetechsolutions.com,backend
```

⚠️ **`ALLOWED_HOSTS` must list all three.** A missing entry returns a bare
`400 Invalid host header` with **nothing in the logs** — it looks exactly like an
outage.

## 4.3 — nginx

Live configs are per-domain files created by IT, in
`/etc/nginx/sites-available/`, each with an HTTP→HTTPS redirect block and a
`443 ssl` block.

**Step A — `priv.` must now serve the PUBLIC bundle.** This is the one line that
matters most in the whole change:

```bash
sudo sed -i 's|proxy_pass http://127.0.0.1:4173;|proxy_pass http://127.0.0.1:4174;|' \
  /etc/nginx/sites-available/priv.genetechsolutions.com

grep -n "proxy_pass" /etc/nginx/sites-available/priv.genetechsolutions.com
```

`/api/` must stay `8000`; only the `location /` line becomes `4174`. **Check both
lines** — the `sed` above rewrites every 4173, and there should only be one.

**Step B — create the staff vhost.** Copy the existing `priv.` file, then change
the name and port:

```bash
sudo cp /etc/nginx/sites-available/priv.genetechsolutions.com \
        /etc/nginx/sites-available/priv-staff.genetechsolutions.com

sudo sed -i 's|priv\.genetechsolutions\.com|priv-staff.genetechsolutions.com|g' \
  /etc/nginx/sites-available/priv-staff.genetechsolutions.com
sudo sed -i 's|proxy_pass http://127.0.0.1:4174;|proxy_pass http://127.0.0.1:4173;|' \
  /etc/nginx/sites-available/priv-staff.genetechsolutions.com
```

⚠️ The copy also rewrites `ssl_certificate` paths to a
`priv-staff.genetechsolutions.com` directory that does not exist yet. **Point them
back at the existing certificate until certbot runs in step C**, or `nginx -t`
fails:

```bash
sudo sed -i 's|/etc/letsencrypt/live/priv-staff.genetechsolutions.com/|/etc/letsencrypt/live/priv.genetechsolutions.com/|' \
  /etc/nginx/sites-available/priv-staff.genetechsolutions.com

sudo ln -sf /etc/nginx/sites-available/priv-staff.genetechsolutions.com \
            /etc/nginx/sites-enabled/priv-staff.genetechsolutions.com
sudo nginx -t
```

`nginx -t` must be clean with **no** `conflicting server name` warnings. If any
appear, an old config is still enabled — check `ls -l /etc/nginx/sites-enabled/`.
There should be exactly three symlinks and nothing else.

```bash
sudo systemctl reload nginx
```

**Step C — extend the certificate to cover the new name.**

```bash
sudo certbot --nginx \
  -d priv.genetechsolutions.com \
  -d priv-req.genetechsolutions.com \
  -d priv-staff.genetechsolutions.com \
  --expand --agree-tos -m webadmin@genetech.co --redirect --non-interactive

sudo certbot certificates
sudo nginx -t && sudo systemctl reload nginx
```

`--expand` adds the name to the existing certificate rather than issuing a
separate one, so renewal stays a single timer.

## 4.4 — Restart the backend

```bash
cd ~/Secure-Share
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

docker inspect secure-share-backend-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(SECRET_BASE_URL|REQUEST_BASE_URL|FRONTEND_ORIGIN|ALLOWED_HOSTS)='
```

`--build` is required — `config.py` changed, and a plain restart reuses the old
image with the old code and says nothing about it.

## 4.5 — Frontend

No source changed, but the bundles must exist and PM2 must be serving them:

```bash
cd ~/Secure-Share/Frontend
ls dist/staff/index.html dist/public/index.html
pm2 restart all && pm2 list
```

Rebuild only if `git pull` touched `Frontend/src`:

```bash
npm ci && npm run build && pm2 restart all
```

---

# 5 — Verification

## 5.1 — Each hostname serves the right bundle

```bash
for h in priv-staff priv priv-req; do
  printf "%-12s " "$h"
  curl -s -o /dev/null -w '%{http_code}\n' -m 10 \
    --resolve $h.genetechsolutions.com:443:127.0.0.1 \
    https://$h.genetechsolutions.com/
done
```

All three: `200`.

**The decisive test — the staff login page must exist on `priv-staff` and be
absent from the other two:**

```bash
for h in priv-staff priv priv-req; do
  printf "%-12s login page: " "$h"
  curl -s -m 10 --resolve $h.genetechsolutions.com:443:127.0.0.1 \
    https://$h.genetechsolutions.com/login | grep -qi "password\|sign in" \
    && echo "PRESENT" || echo "absent"
done
```

Expected:

```
priv-staff   login page: PRESENT
priv         login page: absent      <-- the whole point of this change
priv-req     login page: absent
```

> This is a single-page app, so `/login` returns `index.html` with `200` on every
> host. What differs is whether the **bundle** contains the login code. `priv.`
> and `priv-req.` serve `dist/public`, from which Rollup deleted the staff module
> entirely — so there is nothing to render.

Confirm at the bundle level too:

```bash
cd ~/Secure-Share/Frontend
grep -rl "admin/activity" dist/staff/assets/  | wc -l    # 1
grep -rl "admin/activity" dist/public/assets/ | wc -l    # 0
```

## 5.2 — Links are generated on the right domains

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
  python -c "import config; print('secret :', config.SECRET_BASE_URL); print('request:', config.REQUEST_BASE_URL)"
```

Expected:

```
secret : https://priv.genetechsolutions.com
request: https://priv-req.genetechsolutions.com
```

If either prints the staff host or an empty string, `.env` did not reach the
container — re-check 4.2 and 2.4, then `up -d` again.

## 5.3 — API reachable on all three

```bash
for h in priv-staff priv priv-req; do
  printf "%-12s " "$h"
  curl -s -m 10 --resolve $h.genetechsolutions.com:443:127.0.0.1 \
    https://$h.genetechsolutions.com/api/health; echo
done
```

All three: `{"ok":true,"postgres":true,"redis":true}`.

A `400 Invalid host header` here means that name is missing from `ALLOWED_HOSTS`.

## 5.4 — In a browser, end to end

1. Sign in at `https://priv-staff.genetechsolutions.com` — AD credentials.
2. `/create` a secret. **The link must begin `https://priv.genetechsolutions.com/s/`**
3. Open it in a private window: reveals **once**. Reopen: already viewed.
4. `/request` a credential. **The link must begin `https://priv-req.genetechsolutions.com/r/`**
5. Open that in a private window: the submit form appears.
6. Browse to `https://priv.genetechsolutions.com/login` — **no login form.**
7. Confirm the certificate is valid on all three (no browser warning).

## 5.5 — Old links still work

Links already sent out point at `priv-req.` for **both** flows. `priv-req.` still
serves `dist/public`, which contains both `/s/` and `/r/` routes, so they keep
working. Test one if any are still live.

---

# 6 — Rollback

Fast, and does not need a code revert — the fallback chain handles it.

```bash
cd ~/Secure-Share
cp .env.bak.<timestamp> .env
sudo sed -i 's|proxy_pass http://127.0.0.1:4174;|proxy_pass http://127.0.0.1:4173;|' \
  /etc/nginx/sites-available/priv.genetechsolutions.com
sudo rm -f /etc/nginx/sites-enabled/priv-staff.genetechsolutions.com
sudo nginx -t && sudo systemctl reload nginx
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

With `SECRET_BASE_URL` and `REQUEST_BASE_URL` unset, `config.py` falls back to
`PUBLIC_BASE_URL` and both link types return to one host. The new code is
backward compatible, so it can stay deployed.

To revert the code as well:

```bash
git revert <commit-sha> && git push origin main
```

---

# 7 — Gotchas — read before executing

| # | Trap | Symptom |
|---|---|---|
| 1 | `ALLOWED_HOSTS` missing a name | Bare `400 Invalid host header`, **nothing in the logs** — looks like an outage |
| 2 | `docker compose up` without `--build` | Old `config.py` keeps running; links stay on the old host and no log says why |
| 3 | Copying the `priv.` vhost without fixing `ssl_certificate` | `nginx -t` fails on a missing cert directory |
| 4 | Running certbot before `priv-staff` is in DNS | Challenge fails, consumes a rate-limit attempt |
| 5 | Forgetting `--expand` | Issues a **second** certificate instead of extending the first; two renewal timers, easy to let one lapse |
| 6 | `sed` on `proxy_pass` rewriting `/api/` too | The API stops working on that host. Check **both** `proxy_pass` lines after every sed |
| 7 | Leaving the old `secureshare` nginx config enabled | `conflicting server name ... ignored` — nginx silently discards blocks |
| 8 | Not adding the new vars to `docker-compose.yml` | The container never sees them; silently falls back to one host |
| 9 | `git pull` over the local `ecosystem.config.cjs` edit | Merge conflict — `git checkout --` that file first (4.1) |
| 10 | Testing login over plain HTTP | Login loops forever, API returns `200`. `ENV=production` sets `Secure` + `__Host-`; TLS is mandatory |
| 11 | Applying 2.4 without 2.1 | `${VAR:-}` sets the variable to `""`; `os.getenv(name, default)` returns `""` not the default. Links come out as `/s/<token>` with no hostname |

## The one-line summary of the whole change

> **`priv.` stops serving the staff bundle and starts serving the public one; the
> staff app moves to `priv-staff.`; and the backend learns two link hostnames
> instead of one.**

Everything else follows from that.

---

## Current state at time of writing

| | |
|---|---|
| Server | `66.51.159.99:8022`, internal `192.168.11.114`, host `onelink-secureshell` |
| Repo commit | `3d085c0` (local; push may still be pending) |
| Backend | running, healthy, AD enabled, CA installed |
| AD | `DC01.genetech.pk` → `192.168.11.49`, bind verified |
| PM2 | `secureshare-staff` 4173, `secureshare-public` 4174, boot unit enabled |
| nginx | active, two vhosts, cert covers `priv` + `priv-req` to 30 Nov 2026 |
| Accounts | **none yet** — an admin still needs creating |
| Apache | removed |

> **Still outstanding, unrelated to this change:** no administrator account
> exists. AD users self-provision on first sign-in but are always non-admin, so
> one account must be promoted with `manage.py promote <email>` or created with
> `manage.py adduser <email> --admin`.

---

*SecureShare — Genetech Solutions. Your AI Solution Partner.*
