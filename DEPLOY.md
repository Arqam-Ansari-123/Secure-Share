# SecureShare — Deploying by hand

For the US server at `66.51.159.115`, over your Bitvise terminal.
No scripts. Every step is a command you paste and a result you can check.

**Genetech Solutions — Your AI Solution Partner**

> Supersedes `Deployment.md`. Ignore that file.

---

## Contents

| # | Section |
|---|---|
| — | [How nginx actually works here](#how-nginx-actually-works-here) ← **read this first** |
| 0 | [Before you start](#0--before-you-start) |
| 1 | [Install everything](#1--install-everything) |
| 2 | [The three `.env` files git did not clone](#2--the-three-env-files-git-did-not-clone) |
| 3 | [Close the database ports](#3--close-the-database-ports) |
| 4 | [The production overlay file](#4--the-production-overlay-file) |
| 5 | [Tailscale — the route to the domain controller](#5--tailscale--the-route-to-the-domain-controller) |
| 6 | [Start the backend](#6--start-the-backend-docker) |
| 7 | [Build the two frontends](#7--build-the-two-frontends) |
| 8 | [PM2](#8--pm2--the-two-static-servers) |
| 9 | [nginx into sites-enabled](#9--nginx-into-sites-enabled) |
| 10 | [HTTPS with certbot](#10--https-with-certbot) |
| 11 | [CA certificate and first admin](#11--ca-certificate-and-first-admin) |
| 12 | [Check it works](#12--check-it-works) |
| 13 | [Everyday commands](#13--everyday-commands) |

---

# How nginx actually works here

Read this section before you touch anything. Once it clicks, the rest is typing.

## The one-sentence version

> Both domain names point at the **same server**. nginx reads the `Host:` header
> the browser sends, matches it to a `server_name`, and hands the request to one
> of **three local programs** — none of which are reachable from the internet.

## Why there is anything to route at all

`npm run build` does not produce one website. It produces **two**:

```
Frontend/dist/staff     the internal app   — login, create, dashboard, admin log
Frontend/dist/public    the client pages   — /s/<token> reveal, /r/<token> submit
```

These are two folders full of files. A folder cannot serve itself — something has
to listen on a port and hand the files out. That something is `serve`, run by PM2,
**once per folder**:

```
serve dist/staff   →  listening on 127.0.0.1:4173
serve dist/public  →  listening on 127.0.0.1:4174
```

**That is the entire reason two port numbers exist.** They are not a security
boundary and they are not meaningful numbers — 4173 is Vite's traditional preview
port and 4174 is the next one free. Two folders, two servers, two ports.

There is a third program: the backend API, in Docker, on `127.0.0.1:8000`.

So the server has three things running, and **all three are invisible from the
internet** — `127.0.0.1` means "reachable only from this machine itself". A
browser in Karachi cannot type `66.51.159.115:4173` and get anything. The
connection is refused before it starts.

nginx is the only program with a public socket. It is the front door.

## How nginx tells vault. from share.

DNS is dumber than people expect. It only turns a name into an IP:

```
vault.genetechsolutions.com  →  66.51.159.115
share.genetechsolutions.com  →  66.51.159.115     ← the same address
```

Both names arrive at the same machine, on the same port 443. The packets are
identical at the network level. So how does nginx know which one you typed?

**Every HTTP request carries the hostname inside it.** This is the `Host` header,
and the browser fills it in from the address bar:

```http
GET /create HTTP/1.1
Host: vault.genetechsolutions.com      ← this line is the whole mechanism
Cookie: __Host-ss_staff=...
```

nginx compares that line against the `server_name` in each `server { }` block and
uses the first one that matches. That is called **virtual hosting**, and it is why
one machine with one IP can host any number of sites.

```
                       ┌─────────────────────────────────┐
   Host: vault....     │  server {                       │
   ──────────────────► │    server_name vault.gene...;   │ ── matches ──►  :4173
                       │  }                              │
                       ├─────────────────────────────────┤
   Host: share....     │  server {                       │
   ──────────────────► │    server_name share.gene...;   │ ── matches ──►  :4174
                       │  }                              │
                       └─────────────────────────────────┘
```

## Then `location` picks the destination

Inside a matched `server` block, nginx looks at the **path** and picks a
`location`. There are exactly two per block:

```nginx
server {
    server_name vault.genetechsolutions.com;

    location /api/ { proxy_pass http://127.0.0.1:8000; }   # the backend
    location /     { proxy_pass http://127.0.0.1:4173; }   # dist/staff
}
```

`location /` is the catch-all — it matches anything not caught by a more specific
block. `location /api/` is more specific, so it wins for API calls. nginx always
prefers the longest matching prefix, regardless of the order you write them in.

## The full picture

```
                          INTERNET
                             │
              ┌──────────────┴──────────────┐
              │                             │
    vault.genetechsolutions.com   share.genetechsolutions.com
              │                             │
              └──────────────┬──────────────┘
                             │  both resolve to 66.51.159.115
                             ▼
              ╔══════════════════════════════╗
              ║   nginx    :80  →  301 https ║   the only public program
              ║            :443 TLS          ║
              ╚══════════════════════════════╝
                    │           │         │
      Host: vault.  │           │         │  Host: share.
      path /        │           │         │  path /
                    │           │         │
                    ▼           ▼         ▼
         ┌──────────────┐  ┌─────────┐  ┌──────────────┐
         │127.0.0.1:4173│  │  :8000  │  │127.0.0.1:4174│
         │  PM2 serve   │  │ backend │  │  PM2 serve   │
         │  dist/staff  │  │ (Docker)│  │  dist/public │
         └──────────────┘  └────┬────┘  └──────────────┘
                                │        ▲
              both hosts send   │        │  path /api/ from EITHER host
              /api/ here  ──────┴────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              ┌───────────┐          ┌────────────┐
              │ Postgres  │          │   Redis    │
              │ accounts  │          │ ciphertext │
              │ audit log │          │  RAM only  │
              └───────────┘          └────────────┘
                 private Docker network — no port at all
```

## Why `/api/` appears in *both* blocks

This looks like duplication. It is deliberate and load-bearing.

The frontend never calls the API by its address. It calls `/api/...` — a **relative
path** ([Frontend/src/lib/http.ts:28](Frontend/src/lib/http.ts#L28)):

```js
const res = await fetch(`/api${path}`, { credentials: 'same-origin', ... })
```

A relative path means "same host I was loaded from". So:

- a page loaded from `vault.` calls `https://vault.genetechsolutions.com/api/...`
- a page loaded from `share.` calls `https://share.genetechsolutions.com/api/...`

Both must reach the backend, so both blocks need the rule. And because the API
appears to live on the same host as the page, **the browser considers it
same-origin**. That is what makes two things work:

1. **The session cookie is sent.** It is `SameSite=Strict` and host-only. A
   cross-origin API call would not receive it, and staff could never stay logged in.
2. **No CORS is needed anywhere.** Nothing has to be relaxed, so nothing can be
   relaxed by accident.

## The trailing-slash trap in `proxy_pass`

This one bites everybody once. These two lines behave completely differently:

```nginx
proxy_pass http://127.0.0.1:8000;      # ✅ correct — passes /api/auth/login through
proxy_pass http://127.0.0.1:8000/;     # ❌ STRIPS /api/ — sends /auth/login
```

A trailing slash makes nginx replace the matched `location` prefix instead of
keeping it. Every FastAPI router in this project is mounted under `/api`
(`APIRouter(prefix="/api/auth")` and friends), so the stripped version 404s on
every single call. **There is no trailing slash in `deploy/nginx.conf`. Do not add one.**

## The three "redirects", which are three different things

People say "redirect" for all of these. They are not the same mechanism at all.

### 1. HTTP → HTTPS — a real redirect, made by nginx

certbot adds this in step 10. Port 80 answers everything with `301 Moved
Permanently` pointing at the `https://` version of the same URL. One hop, then the
browser never uses port 80 again for that host (HSTS).

### 2. vault. → share. for a share link — **not a redirect at all**

This is the part that confuses everyone, so here it is precisely.

An employee is on `https://vault.genetechsolutions.com/create`. They create a
secret. The link that appears says `https://share.genetechsolutions.com/s/AbC123`.

**Nothing redirected.** The backend *generated that text* from the
`PUBLIC_BASE_URL` variable in `.env` ([Backend/routes_sender.py:108](Backend/routes_sender.py#L108)):

```python
url = f"{config.PUBLIC_BASE_URL}/s/{token}"
```

It is a string the API returns in a JSON response, which the page then displays for
the employee to copy. No HTTP status code, no `Location` header, no browser
navigation. It is a business card with an address printed on it.

The client who receives that link opens it fresh, later, in their own browser, and
*that* request goes to `share.` from the very beginning.

> **Consequence:** change `PUBLIC_BASE_URL` and every future link changes, with no
> code edit and no nginx change. Get it wrong and links come out pointing at
> `vault.` — which still works, but hands outside clients your internal hostname.
> **This is the single most important line in `.env` to check after deploying.**

### 3. HTTPSRedirectMiddleware — a backend safety net that can loop

With `ENV=production` the backend also refuses plain HTTP and answers with a
redirect to `https://`. But the backend never sees HTTPS — nginx terminates TLS and
talks to it over plain HTTP on port 8000. So it needs to be *told*:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

Miss this line and the backend thinks every request is insecure, redirects it to
https, nginx forwards that redirect, the browser tries again, and you get
`ERR_TOO_MANY_REDIRECTS` forever. It is already in `deploy/nginx.conf`.

Its sibling matters too:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Without it, every request looks like it came from nginx itself. Every audit row
records the wrong IP, and the per-IP rate limiter collapses into one global
bucket — so one noisy client locks out everybody.

## Why not skip nginx and let PM2 face the internet?

Because `serve` cannot do TLS, cannot answer for two hostnames, cannot force
HTTPS, cannot cap upload size, and cannot put the API and the static files on the
same origin. You would need three public ports and the cookie would stop working.
nginx does all of it in forty lines.

---

# 0 — Before you start

## Add the DNS records now

Propagation is the one thing you cannot hurry, and step 10 will fail without it.
At your DNS provider:

| Type | Name | Value |
|---|---|---|
| A | `vault` | `66.51.159.115` |
| A | `share` | `66.51.159.115` |

Check from the server later with `dig +short vault.genetechsolutions.com`.

## Find your clone

```bash
cd ~
ls
cd secureshare          # or whatever the folder is called
pwd                     # remember this path — every step below runs from here
ls
```

You should see `docker-compose.yml`, `Backend/`, `Frontend/`, `deploy/`.
If `deploy/nginx.conf` is missing, your clone predates it — `git pull` first.

---

# 1 — Install everything

Paste these one block at a time and read the output of each.

```bash
sudo apt update
sudo apt install -y curl git ufw nginx certbot python3-certbot-nginx dnsutils
```

**Docker:**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

> Now **close Bitvise and reconnect.** Group membership only applies to a new
> login. Without it every `docker` command needs `sudo`.

After reconnecting, check:

```bash
docker ps                 # should print an empty table, not "permission denied"
docker compose version    # need v2.x
```

**Node 22** — vite 8 and TypeScript 6 need Node 20 or newer:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v                   # must be v22.x
```

**PM2 and serve:**

```bash
sudo npm install -g pm2 serve
pm2 -v
```

**Firewall.** Allow SSH *before* enabling, or you lock yourself out of the session
you are typing in:

```bash
sudo ufw allow 4022/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Nothing else is ever opened. Everything else listens on `127.0.0.1`.

---

# 2 — The three `.env` files git did not clone

You said your clone has no `.env` files. **There are three, and two of them
contain no secrets at all but are still required.** Missing them causes silent
wrong behaviour, not errors.

## 2a — `Frontend/.env` and `Frontend/.env.staff`

These hold one line each. They are what tells the build which bundle to produce.

> **If you skip these, both builds produce the PUBLIC bundle.** `vault.` would then
> serve your employees the client page — with no login on it — and nothing
> anywhere would report an error.

```bash
cd ~/secureshare/Frontend

echo 'VITE_SURFACE=public' > .env
echo 'VITE_SURFACE=staff'  > .env.staff

cat .env .env.staff        # must print: VITE_SURFACE=public
                           #             VITE_SURFACE=staff
cd ..
```

## 2b — The root `.env` — this one has the secrets

Generate four fresh values and keep the output on screen:

```bash
cd ~/secureshare
for i in 1 2 3 4; do openssl rand -base64 24; done
```

Now create the file. Paste this whole block, then edit it:

```bash
cp deploy/env.production.example .env
nano .env
```

Replace every `REPLACE_...` placeholder. In nano: `Ctrl+O`, `Enter`, `Ctrl+X` to save.

The values that matter most:

| Variable | Set it to | Why |
|---|---|---|
| `DB_PASSWORD` | random #1 | **Read only once**, when the Postgres volume is first created. Changing it later does nothing except break the connection. |
| `APP_DB_PASSWORD` | random #2 | Same — one shot. |
| `WEBHOOK_SECRET` | random #3 | Signs outbound webhooks. |
| `PASSWORD_PEPPER` | random #4 | **Set it now or never.** Mixed into every local password hash; adding it later invalidates every existing password. |
| `AD_BIND_PASSWORD` | the real one | Copy from your laptop's `.env`. |
| `PUBLIC_BASE_URL` | `https://share.genetechsolutions.com` | Every share link is built from this. |
| `FRONTEND_ORIGIN` | `https://vault.genetechsolutions.com` | CORS and the CSRF origin check. |
| `ALLOWED_HOSTS` | both hostnames + `backend` | A missing entry = bare `400 Invalid host header`, no log line. |

Verify no placeholders survived:

```bash
grep REPLACE_ .env        # must print NOTHING
grep '^ENV=' .env         # must print ENV=production
```

---

# 3 — Close the database ports

Your cloned `docker-compose.yml` publishes Postgres on `5432` and Redis on `6379`
bound to `0.0.0.0` — every network interface, including the public IP. Redis here
has **no password** and holds the ciphertext of every live secret plus every
session. On a public IP it is compromised within minutes of being scanned.

Bind all three to loopback:

```bash
cd ~/secureshare
sed -i 's|^\( *- \)"5432:5432"|\1"127.0.0.1:5432:5432"|' docker-compose.yml
sed -i 's|^\( *- \)"6379:6379"|\1"127.0.0.1:6379:6379"|' docker-compose.yml
sed -i 's|^\( *- \)"8000:8000"|\1"127.0.0.1:8000:8000"|' docker-compose.yml

grep -n '127.0.0.1:' docker-compose.yml
```

That last command must print **three** lines. If it prints fewer, your file differs
from what the `sed` expected — open it with `nano docker-compose.yml`, find the
three `ports:` sections and add the `127.0.0.1:` prefix by hand.

> **Do not try to fix this with `ports: []` in an override file.** Compose merges
> lists by *appending*, so an empty list adds nothing and leaves the original
> mapping in place. It looks like it worked and it did not. Editing the base file
> is the reliable fix.

---

# 4 — The production overlay file

This file adds the settings that must differ in production. It only overrides
**environment variables**, which Compose merges safely.

```bash
cd ~/secureshare
cat > docker-compose.prod.yml <<'YAML'
# Production overlay. ALWAYS use it together with docker-compose.yml:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
services:
  backend:
    environment:
      ENV: production

      # The base file hard-codes this to localhost, so .env alone is ignored.
      # Without both real hostnames, every request through nginx returns a bare
      # 400 Invalid host header with no log line.
      ALLOWED_HOSTS: ${ALLOWED_HOSTS}

      # Required, and easy to miss. manage.py connects as the schema OWNER
      # (appuser), not app_rw, and the default points at localhost inside the
      # container. Without this you cannot create the first administrator.
      ADMIN_DATABASE_URL: postgresql://appuser:${DB_PASSWORD}@postgres:5432/secretshare

      # Not passed through by the base file at all.
      PASSWORD_PEPPER: ${PASSWORD_PEPPER:-}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      SMTP_FROM: ${SMTP_FROM:-secureshare@genetechsolutions.com}
YAML
```

Typing that pair of `-f` flags forever is miserable, so make a shortcut you can
reuse in every command below:

```bash
echo "alias dc='docker compose -f ~/secureshare/docker-compose.yml -f ~/secureshare/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

Now check the merged result before starting anything:

```bash
cd ~/secureshare
dc config | grep -E '^\s+- .*(5432|6379|8000)'
```

Every line printed must begin with `127.0.0.1:`. If any line is bare
`"5432:5432"`, **stop** and fix step 3.

```bash
dc config | grep -E 'ENV:|ALLOWED_HOSTS:'
```

Must show `ENV: production` and both of your real hostnames.

---

# 5 — Tailscale — the route to the domain controller

Your AD is at `192.168.11.49`. That is a private address: those packets cannot
cross the internet. A US server sending to it hits its own local network or drops
the packet. **This is not a firewall you can open** — the address has no meaning
outside the Genetech LAN.

## On any always-on Linux box inside the Genetech office

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --advertise-routes=192.168.11.0/24
```

Then **approve that route in the Tailscale admin console**. It does nothing until
you click approve. This is the step people miss.

## On the US server

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --accept-routes
tailscale status
```

## Verify — if this fails, nobody can sign in

```bash
ping -c2 192.168.11.49
openssl s_client -connect 192.168.11.49:636 -brief </dev/null
```

> **Not ready yet?** You can deploy without AD and add it later. Set
> `AD_ENABLED=false` in `.env` and use local accounts (step 11). Everything else
> works identically. Just know which one you chose.

Expect sign-ins to take **2–2.5 seconds** once it is working: each login makes
about ten round trips to the DC, and Karachi↔US is roughly 250 ms each way.
`AD_TIMEOUT=8` covers it.

---

# 6 — Start the backend (Docker)

```bash
cd ~/secureshare
dc up -d --build
```

The first build takes a few minutes. Then:

```bash
dc ps                     # all three: running / healthy
dc logs --tail 30 backend
```

You want to see `SecureShare ready (env=production)`.

Test the API locally. The `Host: backend` header matters — `ALLOWED_HOSTS`
rejects anything it does not recognise:

```bash
curl -s -H 'Host: backend' http://127.0.0.1:8000/api/health
```

Expected: `{"ok":true,"postgres":true,"redis":true}`

**If it hangs or refuses:** `dc logs backend`. A `RuntimeError` on startup is
`config.py` refusing to boot on a bad setting, and the message says exactly which.

---

# 7 — Build the two frontends

The build **must** happen here, not on your laptop. `dist/` is not in git, and
these two folders are the entire staff/client boundary.

```bash
cd ~/secureshare/Frontend
npm ci
npm run build
```

`npm ci` takes a few minutes. Then confirm both folders exist:

```bash
ls dist/staff/index.html dist/public/index.html
du -sh dist/staff dist/public
```

Sanity check that the surface split actually applied — the staff bundle is larger,
because it contains the whole internal app:

```bash
ls dist/staff/assets | wc -l
ls dist/public/assets | wc -l
```

If those two counts are identical, `Frontend/.env.staff` did not take effect. Go
back to step 2a, then `npm run build` again.

---

# 8 — PM2 — the two static servers

`ecosystem.config.cjs` already defines both processes on 4173 and 4174, bound to
`127.0.0.1`.

```bash
cd ~/secureshare/Frontend
pm2 start ecosystem.config.cjs
pm2 save
pm2 list
```

Both `secureshare-staff` and `secureshare-public` must show **online**.

**Make it survive a reboot:**

```bash
pm2 startup
```

> That command **prints another command** starting with `sudo env PATH=...`.
> **Copy that printed line and run it.** `pm2 save` only writes the process list;
> the printed command installs the systemd unit that replays it at boot. Skip it
> and both frontends stay dead after the first reboot, and nginx returns 502 on
> both hostnames.

Check they are listening:

```bash
curl -sI http://127.0.0.1:4173 | head -1     # HTTP/1.1 200 OK
curl -sI http://127.0.0.1:4174 | head -1     # HTTP/1.1 200 OK
```

---

# 9 — nginx into sites-enabled

Here is the part you asked about specifically.

## How the two folders work

Debian and Ubuntu split nginx config into two directories:

```
/etc/nginx/sites-available/     every site you have written — a library
/etc/nginx/sites-enabled/       symlinks to the ones that are actually live
```

`/etc/nginx/nginx.conf` contains `include /etc/nginx/sites-enabled/*;`, so only
files in **sites-enabled** are loaded. You keep the real file in *available* and
put a symlink in *enabled*. To turn a site off you delete the symlink, not the
config — the file stays for next time.

## Install the file

```bash
cd ~/secureshare
sudo cp deploy/nginx.conf /etc/nginx/sites-available/secureshare
sudo ln -sf /etc/nginx/sites-available/secureshare /etc/nginx/sites-enabled/secureshare
```

## Remove the default site — this matters

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

Ubuntu ships a `default` site with `listen 80 default_server;` and no
`server_name`. It answers for **any** hostname, so depending on load order it can
shadow both of your blocks and serve the "Welcome to nginx!" page instead. The
file stays in `sites-available` — only the symlink goes.

Check what is live:

```bash
ls -l /etc/nginx/sites-enabled/
```

You want exactly one entry: `secureshare -> /etc/nginx/sites-available/secureshare`.

## If your hostnames differ

`deploy/nginx.conf` has `vault.genetechsolutions.com` and
`share.genetechsolutions.com` written in it. If yours differ:

```bash
sudo nano /etc/nginx/sites-available/secureshare
```

Change the two `server_name` lines only. Leave every `proxy_pass` and
`proxy_set_header` exactly as they are.

## Test and load

**Always `nginx -t` before reloading.** A syntax error in a reload takes the site
down; `-t` catches it while the old config is still serving:

```bash
sudo nginx -t
```

Expected:

```
nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Then:

```bash
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

> `reload` re-reads the config without dropping connections. `restart` kills the
> process and starts it fresh. Use `reload` for config changes, always.

## Test it over plain HTTP before adding TLS

```bash
curl -sI -H 'Host: vault.genetechsolutions.com' http://127.0.0.1/ | head -1
curl -sI -H 'Host: share.genetechsolutions.com' http://127.0.0.1/ | head -1
```

Both should return `200 OK`. You are faking the `Host` header with `-H` — exactly
what a real browser sends — which proves the virtual-host matching works before
DNS and certificates are involved.

**If you get 502 Bad Gateway:** nginx is fine, but nobody is listening on the port
it proxied to. Check `pm2 list` and that the ports in
`Frontend/ecosystem.config.cjs` match the `proxy_pass` lines in the nginx file.

**If you get 400 Invalid host header on `/api/`:** `ALLOWED_HOSTS` in `.env` does
not include that hostname. Fix it and `dc up -d`.

---

# 10 — HTTPS with certbot

First confirm DNS actually points here. certbot proves you control the name by
fetching a file over port 80 from wherever it resolves — a stale record fails the
challenge and eats your rate limit:

```bash
dig +short vault.genetechsolutions.com
dig +short share.genetechsolutions.com
curl -s https://api.ipify.org; echo
```

All three must print `66.51.159.115`. **If they do not, wait. Do not run certbot.**

Then, one command, one certificate covering both names:

```bash
sudo certbot --nginx \
  -d vault.genetechsolutions.com \
  -d share.genetechsolutions.com \
  --agree-tos -m webadmin@genetech.co --redirect --non-interactive
```

certbot edits your file in place: it adds `listen 443 ssl`, the certificate paths,
and a new port-80 server block that 301-redirects to https. You do not write any
of that yourself.

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certificates
sudo systemctl status certbot.timer --no-pager
```

Renewal is automatic — one systemd timer covers both names because it is one
certificate.

> **TLS is not optional here.** `ENV=production` turns on the `Secure` flag and the
> `__Host-` cookie prefix. Over plain HTTP the browser silently discards the
> session cookie: login loops forever while the API returns `200` for everything.
> Do not try to "test on HTTP first" — that failure is guaranteed and looks like a
> bug in the login code.

---

# 11 — CA certificate and first admin

## The domain CA certificate

The backend validates the domain controller's TLS certificate against this. The
`/certs` folder is mounted **read-only** on purpose, so export to `/tmp` inside the
container and copy it out to the host, where the read-only mount picks it up:

```bash
cd ~/secureshare
dc exec backend python manage.py export-ad-ca --out /tmp/ca.pem
dc cp backend:/tmp/ca.pem ./Backend/certs/genetech-ca.pem
dc restart backend
```

Confirm it landed where `AD_CA_CERT` points:

```bash
dc exec backend python -c "import os,config;print(config.AD_CA_CERT, os.path.exists(config.AD_CA_CERT))"
```

Must print `/certs/genetech-ca.pem True`. `False` means the `cp` step was missed.

> Skip this if you set `AD_ENABLED=false`. Nothing reads the certificate until the
> first domain sign-in.

## The first administrator

There is no signup page, by design. The only way in is the CLI:

```bash
dc exec backend python manage.py adduser you@genetechsolutions.com --admin
dc exec backend python manage.py list
```

`list` must print a table. **"connection refused" means `ADMIN_DATABASE_URL` is
missing** — check step 4.

Keep at least one local account even with AD working. It is your way in when the
DC or the tunnel is down, which is exactly when you want a credential-sharing tool.

---

# 12 — Check it works

## From your laptop, not the server

```bash
nmap -Pn -p 5432,6379,8000 66.51.159.115      # all filtered/closed
curl -I http://share.genetechsolutions.com    # 301 → https
curl -s https://vault.genetechsolutions.com/api/health
```

## In a browser

1. Sign in at `https://vault.genetechsolutions.com`. You land on `/create`.
2. Create a secret. **The link must start with `https://share.`** — if it says
   `vault.`, `PUBLIC_BASE_URL` in `.env` is wrong. Fix it and `dc up -d`.
3. Open that link in a private window: it reveals once. Open it again: already viewed.
4. Go to `https://share.genetechsolutions.com/` — you must **not** find a login
   page. The public bundle contains no staff code at all.
5. Reboot and confirm everything returns unaided:

```bash
sudo reboot
# reconnect after a minute
pm2 list        # both online
cd ~/secureshare && dc ps    # all three running
```

Step 5 is the one people skip and regret. It is the only test of `pm2 startup`.

---

# 13 — Everyday commands

## Deploy a change

```bash
cd ~/secureshare
git pull

cd Frontend && npm ci && npm run build && pm2 restart all

cd .. && dc up -d --build
```

`--build` is not optional for backend changes: a plain restart reuses the existing
image, so the old code keeps running and nothing in any log tells you.

## Health

```bash
pm2 list                    # the two static servers
pm2 logs --lines 30         # their output
dc ps                       # backend, postgres, redis
dc logs --tail 50 backend   # link tokens are redacted by design
sudo nginx -t               # config valid?
sudo certbot certificates   # expiry
tailscale status            # the tunnel to the DC
```

## Backup

```bash
cd ~/secureshare
dc exec -T postgres pg_dump -U appuser secretshare | gzip > ~/backup-$(date +%F).sql.gz
```

Accounts, audit history and metadata. It deliberately does **not** capture secret
contents — those live only in Redis, which never writes to disk. That also means a
Redis restart destroys every unopened secret. Property, not bug: an undelivered
secret evaporating is an inconvenience; a secret surviving in last night's backup
is a breach.

## Later: lock the staff door

Once you know the office IP range, `deploy/nginx.conf` has a commented block that
restricts `vault.` to it plus Tailscale. This is the control a single shared
hostname could not express — locking the internal app without locking out clients.

## Rotate the AD service account

`dev01`'s password was shared over chat, and it is also your SSH login. Once this
is verified, have IT rotate it, put the new value only in the server's `.env`, run
`dc up -d`, and switch SSH to key-only authentication.

---

## Quick reference

| What | Where |
|---|---|
| nginx site (real file) | `/etc/nginx/sites-available/secureshare` |
| nginx site (live symlink) | `/etc/nginx/sites-enabled/secureshare` |
| Certificates | `/etc/letsencrypt/live/vault.genetechsolutions.com/` |
| Secrets | `~/secureshare/.env` |
| Build surface flags | `~/secureshare/Frontend/.env`, `.env.staff` |
| Built bundles | `~/secureshare/Frontend/dist/{staff,public}` |
| PM2 process list | `~/.pm2/dump.pm2` |
| Domain CA | `~/secureshare/Backend/certs/genetech-ca.pem` |

| Port | Program | Reachable from |
|---|---|---|
| 80, 443 | nginx | the internet |
| 4173 | PM2 → `dist/staff` | nginx only |
| 4174 | PM2 → `dist/public` | nginx only |
| 8000 | backend (Docker) | nginx only |
| 5432, 6379 | Postgres, Redis | the backend container only |
| 4022 | SSH | the internet |

---

*SecureShare — built by Genetech Solutions. Your AI Solution Partner.*
