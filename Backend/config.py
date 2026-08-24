"""Configuration — plain os.environ reads, no extra dependency."""

import os

ENV = os.getenv("ENV", "development")
IS_PROD = ENV == "production"

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://app_rw:app_rw_dev_password@localhost:5432/secretshare",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# The origin staff use (CORS + CSRF Origin check).
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
# The origin baked into share links — the PUBLIC host clients open. In a
# two-hostname deployment this differs from FRONTEND_ORIGIN.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", FRONTEND_ORIGIN)

# Fail CLOSED in production. Previously this defaulted to ["*"], and main.py
# skipped TrustedHostMiddleware entirely when it saw ["*"] — so forgetting the
# variable silently disabled Host-header validation instead of erroring.
# NOTE: this list must contain BOTH hostnames plus "backend" (the compose
# healthcheck's Host), or every request returns a bare 400 Invalid host header
# with no log line, which looks exactly like an outage.
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "").split(",") if h.strip()]
if IS_PROD and (not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS):
    raise RuntimeError(
        "ALLOWED_HOSTS must be an explicit comma-separated host list when ENV=production"
    )
ALLOWED_HOSTS = ALLOWED_HOSTS or ["*"]

# 5 MiB. Applies to the encrypted envelope, so ~4 MiB of real payload.
MAX_BLOB_BYTES = int(os.getenv("MAX_BLOB_BYTES", 5 * 1024 * 1024))
MAX_TTL_SECONDS = int(os.getenv("MAX_TTL_SECONDS", 30 * 24 * 3600))
REVEAL_TICKET_TTL = 300

# --- staff accounts --------------------------------------------------------
# Enforced by manage.py at account creation. Deliberately NOT a SQL CHECK:
# hard-coding a domain into DDL would make adding a second one a migration.
STAFF_EMAIL_DOMAINS = [
    d.strip().lower()
    for d in os.getenv("STAFF_EMAIL_DOMAINS", "genetechsolutions.com,test.local").split(",")
    if d.strip()
]

# __Host- makes the BROWSER enforce Secure + Path=/ + no Domain.
STAFF_COOKIE = "__Host-ss_staff" if IS_PROD else "ss_staff"

# 30 days: staff sign in about once a month rather than daily.
#
# Both values must move together. The absolute cap is checked against the
# session's `created` timestamp, so leaving it at the old 12h would sign people
# out daily no matter how long the idle window is.
#
# Tradeoff: an unattended laptop stays signed in for a month. Revocation is
# still immediate — logout, "sign out everywhere", `manage.py disable` and a
# password change all delete the Redis session on the spot.
SESSION_IDLE_SECONDS = int(os.getenv("SESSION_IDLE_SECONDS", 30 * 24 * 3600))
SESSION_ABSOLUTE_SECONDS = int(os.getenv("SESSION_ABSOLUTE_SECONDS", 30 * 24 * 3600))

LOCKOUT_THRESHOLD = 5
LOCKOUT_SECONDS = 900
LOCKOUT_MAX_SECONDS = 3600
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128

# scrypt via hashlib — no third-party dependency.
# maxmem MUST be set: it defaults to 0, which OpenSSL reads as a 32 MiB ceiling,
# and scrypt needs exactly 128*r*N = 32 MiB at n=2**15 — so the default rejects
# these parameters by a hair. Measured here at ~92 ms/verify.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_SALT_BYTES = 16
SCRYPT_MAXMEM = 64 * 1024 * 1024
# Optional. Lives in the app environment, never the database, so a stolen
# pg_dump alone cannot be attacked offline. Rotating it invalidates all passwords.
PASSWORD_PEPPER = os.getenv("PASSWORD_PEPPER", "")

# --- Active Directory -------------------------------------------------------
# Staff sign in with their domain password; the backend binds to the DC to
# verify it. Deliberately a BIND, not an SSO redirect: the browser must still
# see the password for a moment, because that is what unwraps the private key
# used to read credential replies. An SSO redirect would silently kill that.
#
# There is no service account. The bind is performed as the user, and the
# directory lookup runs on that same authenticated connection — so no directory
# credential is ever stored here.
AD_ENABLED = os.getenv("AD_ENABLED", "false").lower() == "true"
# A HOSTNAME, not an IP, whenever TLS is on: the DC's certificate is issued to
# its FQDN and validation compares against it.
AD_HOST = os.getenv("AD_HOST", "DC01.genetech.pk")
AD_PORT = int(os.getenv("AD_PORT", 636))

# The NetBIOS domain name, used to bind as GENETECH\<sAMAccountName>.
#
# This is what makes the login work at all on the live forest. Binding by UPN
# would require knowing which of the five UPN suffixes in use (@genetech.pk,
# @genetech.co, @genetechsolutions.com, @consulnet.net, @codegirls.pro) belongs
# to the person signing in — and for 219 of 343 staff the mail domain is not the
# UPN domain either, so it cannot be inferred from their address. Every account
# has a sAMAccountName, so NT-style binding is the one form that works for all
# of them.
AD_NETBIOS = os.getenv("AD_NETBIOS", "GENETECH")

# Read-only account used ONLY to translate what someone typed into a Windows
# username. It never authenticates anybody: once resolved, the bind is performed
# as the user with the password they supplied, exactly as before. Losing this
# credential would let an attacker enumerate the directory — which any domain
# account can already do — but it grants no SecureShare privilege whatsoever.
AD_BIND_USER = os.getenv("AD_BIND_USER", "")
AD_BIND_PASSWORD = os.getenv("AD_BIND_PASSWORD", "")

# Only members of this group may sign in. Applied as part of the directory
# search, so a non-member never reaches a bind attempt — SecureShare therefore
# never touches their badPwdCount, and "not a member" is indistinguishable from
# "wrong password" from outside. Empty disables the gate and lets any enabled
# account in, which on this forest is 325 people.
AD_REQUIRED_GROUP = os.getenv("AD_REQUIRED_GROUP", "")

# starttls -> upgrade on 389 before sending the credential  (preferred)
# ldaps    -> TLS from the first byte on 636
# none     -> NO ENCRYPTION. The password crosses the network in the clear.
#             Only tolerable on an isolated lab; refused in production below.
AD_TLS_MODE = os.getenv("AD_TLS_MODE", "ldaps").lower()
AD_CA_CERT = os.getenv("AD_CA_CERT", "")  # PEM path; empty disables verification
# Default suffix for a bare username typed at the login form. No longer decides
# whether an account is AD or local — see routes_auth.login().
AD_UPN_SUFFIX = os.getenv("AD_UPN_SUFFIX", "genetech.pk")
# Subtree search base. DC=genetech,DC=pk deliberately, not OU=people: staff exist
# under OU=people AND CN=Users, and a base of OU=people would silently exclude
# the latter.
AD_BASE_DN = os.getenv("AD_BASE_DN", "DC=genetech,DC=pk")
AD_TIMEOUT = int(os.getenv("AD_TIMEOUT", 8))

# Every failed authentication is padded to this floor. Without it, "no such
# account" (no bind attempted) and "wrong password" (a network round trip) take
# measurably different times, which enumerates the staff directory.
AD_TIMING_FLOOR_MS = int(os.getenv("AD_TIMING_FLOOR_MS", 250))

# Local password accounts remain usable alongside AD. Keep at least one: it is
# the break-glass path when the DC is unreachable — and SecureShare is exactly
# the tool you would reach for while fixing that.
LOCAL_LOGIN_ENABLED = os.getenv("LOCAL_LOGIN_ENABLED", "true").lower() == "true"

def _looks_like_ip(host: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


if AD_ENABLED and AD_TLS_MODE not in ("starttls", "ldaps", "none"):
    raise RuntimeError(f"AD_TLS_MODE must be starttls|ldaps|none, got {AD_TLS_MODE!r}")

if AD_ENABLED and not AD_BIND_PASSWORD:
    raise RuntimeError(
        "AD_BIND_PASSWORD is required when AD_ENABLED=true. The directory has five "
        "UPN suffixes, so an identifier cannot be turned into a bind name without "
        "looking it up first."
    )

# Validating a certificate against an IP address cannot work: the DC's cert is
# issued to DC01.genetech.pk and carries that as its only SAN. Getting this wrong
# surfaces as a TLS handshake failure that reads like a network fault, so refuse
# it up front and say why.
if AD_ENABLED and AD_TLS_MODE != "none" and AD_CA_CERT and _looks_like_ip(AD_HOST):
    raise RuntimeError(
        f"AD_HOST is {AD_HOST!r}, an IP address, but TLS certificate validation is on. "
        "Use the domain controller's hostname (the certificate's SAN) and map it with "
        "extra_hosts in docker-compose.yml."
    )
if IS_PROD and AD_ENABLED and AD_TLS_MODE == "none":
    raise RuntimeError(
        "AD_TLS_MODE=none sends domain passwords in cleartext and is refused in production. "
        "Install a server certificate on the domain controller and use starttls or ldaps."
    )
if IS_PROD and AD_ENABLED and not AD_CA_CERT:
    raise RuntimeError(
        "AD_CA_CERT must point at the domain CA certificate in production, "
        "otherwise the TLS connection to the DC is unauthenticated."
    )

# manage.py only — connects as the schema OWNER, which app_rw is not.
ADMIN_DATABASE_URL = os.getenv(
    "ADMIN_DATABASE_URL", "postgresql://appuser:changeme@localhost:5432/secretshare"
)

# scope -> (limit, window seconds)
RATE_LIMITS = {
    "create": (10, 60),
    "meta": (30, 60),
    "reveal_ip": (5, 60),
    "reveal_tid": (10, 3600),  # what actually caps online passphrase guessing
    "login_ip": (10, 300),
    "login_email": (5, 900),
    "pwchange": (5, 900),
    # Inbound credential requests. The per-rid submit limit is what stops a
    # leaked request link being used to flood us — IP limits alone don't, since
    # IPs rotate.
    "request_view": (30, 60),
    "request_submit_ip": (5, 60),
    "request_submit_rid": (3, 3600),
}

# How long a credential request link stays open, unless the employee picks less.
REQUEST_TTL_SECONDS = int(os.getenv("REQUEST_TTL_SECONDS", 7 * 24 * 3600))

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-webhook-secret")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "secureshare@genetechsolutions.com")
