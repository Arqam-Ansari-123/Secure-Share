# SecureShare

One-time secret sharing, built by **Genetech Solutions**.

Send a password, API key or credential through a link that works **exactly once**. The secret is
encrypted in the sender's browser and destroyed the moment it is read — and the server that stores it
holds ciphertext it has no key for.

```
Frontend/   React 19 + Vite + Tailwind v4 + react-three-fiber
Backend/    FastAPI + Redis (secrets) + Postgres (audit & metadata)
Backend/sql/  the database schema — the single source of truth
```

---

## Quick start

**1. Databases** (Docker; on this machine Docker lives inside WSL)

```bash
docker compose up -d postgres redis
```
On first boot the `Backend/sql/` files apply themselves in order: role → schema → grants.

**2. Backend**

```powershell
cd Backend
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe run_dev.py            # http://127.0.0.1:8000
```

> Use `run_dev.py`, not the `uvicorn` CLI. psycopg's async mode cannot run on the
> ProactorEventLoop that Python picks by default on Windows, and the uvicorn CLI passes its own
> loop factory — so the loop has to be chosen by us. In Docker the plain `uvicorn main:app`
> command is used and none of this applies.

**3. Frontend**

```powershell
cd Frontend
npm install
npm run dev                                    # http://localhost:5173
```
Vite proxies `/api` to the backend, so the session cookie stays same-origin.

**Everything in containers instead:** `docker compose up --build`. Note the code lives on `F:\`
(NTFS) while Docker runs in WSL — bind-mounting that is slow and breaks file-watch reload, so the
split above is the better day-to-day setup.

---

## How the zero-knowledge part works

```
linkKey   32 random bytes, carried in the URL #fragment   (never sent to any server)
master    PBKDF2-SHA256(passphrase, salt, 310_000)        (passphrase secrets only)
encKey    HKDF(linkKey || master, info "ss-enc")          the AES-GCM-256 key
verifier  HKDF(master,            info "ss-auth")         sent to the server
```

Browsers never transmit the part of a URL after `#`, so the decryption key structurally cannot reach
us — not in a request, not in a proxy log, not in a `Referer` header. The server stores only
`SHA256(verifier)`, which is domain-separated from the encryption key and therefore useless for
decryption. Its only job is to let the server count failed passphrase attempts and destroy a secret
after too many.

**Why a verifier rather than "the client reports a failed decryption":** the naive approach hands out
the ciphertext on the first attempt, after which an attacker brute-forces the passphrase offline, at
GPU speed, forever — `max_attempts` becomes decoration. Withholding the ciphertext until the verifier
matches forces every guess through a rate-limited network call.

---

## Why a secret can't be read twice

| Guarantee | Mechanism |
|---|---|
| One view only | `GETDEL` on the Redis key — atomic read-and-destroy, in exactly one function, called from exactly one endpoint |
| Link previews can't burn it | Every `GET` is non-destructive. Revealing requires a `POST` behind a click, plus a single-use 300 s ticket issued by the confirmation screen |
| Expiry without a viewer | The Redis TTL deletes the content whether or not anyone opens it; a 60 s sweeper only reconciles Postgres status |
| Audit can't be rewritten | `audit.events` lives in its own schema, the app connects as a non-owning role with no `UPDATE`/`DELETE`, **and** a `BEFORE UPDATE OR DELETE` trigger rejects mutation even for the table owner |
| No content in logs | Plaintext never exists server-side; ciphertext never enters Postgres; `SecretStr` fields; a custom 422 handler (FastAPI's default echoes the request body back); tokens truncated in access logs; a regex redaction filter on the root logger |

---

## Architecture notes

**Redis holds the secrets, Postgres holds the story.** Redis gets `EXPIRE` for free auto-expiry and
`GETDEL` for atomic one-time reads, and runs with persistence off (`--appendonly no --save ""`) so
secrets never touch disk. Postgres holds metadata and the audit trail, and never receives a byte of
ciphertext — which means even accidental SQL echo logging cannot leak content.

**The link token is never stored.** `tid = sha256(token)` is the Postgres primary key and the Redis
key suffix, so a full database dump yields no working links. The dashboard addresses secrets by
`tid`, and therefore cannot leak a live one.

**Two Postgres roles.** `appuser` owns the schema; the application connects as `app_rw`, which owns
nothing. This matters because `REVOKE` does not bind a table's owner — revoking from the owner would
have achieved nothing at all.

**No ORM.** The `.sql` files own the schema, so SQLAlchemy would only add indirection. `db.py` is a
connection pool plus three helpers; queries are parameterised SQL written inline in the route that
needs them.

---

## Verification

```bash
# the audit trail is genuinely append-only — BOTH of these must fail
docker compose exec postgres psql -U app_rw  -d secretshare -c "update audit.events set ip='1.2.3.4' where id=1"
docker compose exec postgres psql -U appuser -d secretshare -c "delete from audit.events where id=1"

# frontend build + design checks
cd Frontend && npm run build
node ../.claude/skills/impeccable/scripts/detect.mjs Frontend/src   # 0 anti-patterns
```

To prove zero-knowledge by hand: create a secret, then
`docker compose exec redis redis-cli GET sec:<tid>` — the stored value is unreadable ciphertext, and
the key that would open it only ever existed in the browser's address bar.

---

## Known issues and decisions

- **`react-router-dom` 7.18.2 shows a `npm audit` high.** The advisory affects **RSC mode** only,
  which a client-only SPA never enters. Downgrading to the "fixed" 7.11.0 is *worse*: that range
  carries an open-redirect XSS and an SSR `ScrollRestoration` XSS, both of which are reachable from
  ordinary routing. Staying on 7.18.2 is the safer choice; revisit when a patched 7.19+ ships.
- **Schema changes need a manual apply.** `docker-entrypoint-initdb.d` only runs on an empty volume.
  After editing `sql/`, either `docker compose down -v` (destroys data) or
  `docker compose exec -T postgres psql -U appuser -d secretshare < Backend/sql/001_schema.sql` —
  safe, since every statement is idempotent.
- **The append-only trigger does not stop `TRUNCATE`** (truncate fires a different trigger class).
  `app_rw` has no `TRUNCATE` privilege, so the application cannot do it; a database superuser still
  can. Full immutability would need WAL archiving or an external log sink.
- **`label` is stored in plaintext** so the dashboard can show it. The UI says so — it is the one
  field that is not encrypted.
- **`uv sync` / `uv run` will prune the venv** if `pyproject.toml` drifts from `requirements.txt`.
  They are kept in lockstep deliberately; update both together.
