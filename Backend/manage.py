"""Operator CLI for staff accounts.

    python manage.py adduser arqam@genetechsolutions.com --name "Arqam Khan" --admin
    python manage.py resetpw arqam@genetechsolutions.com
    python manage.py disable|enable|unlock arqam@genetechsolutions.com
    python manage.py list

There is no self-service signup, and that is deliberate. Without email
verification a domain check on a signup form proves nothing — anyone can type
any address. Account creation is therefore an operator action performed against
the schema OWNER role (ADMIN_DATABASE_URL), which the application role cannot
do: app_rw has no INSERT on users. An attacker with full code execution inside
the API container still cannot mint themselves an account.

Synchronous psycopg on purpose — no event loop, so none of the Windows
selector-loop handling in run_dev.py applies here.
"""

import argparse
import getpass
import hashlib
import json
import os
import sys

import psycopg
import redis

import config
import passwords


def _conn():
    if not config.ADMIN_DATABASE_URL:
        sys.exit("ADMIN_DATABASE_URL is not set (must be the schema owner, e.g. appuser)")
    return psycopg.connect(config.ADMIN_DATABASE_URL, row_factory=psycopg.rows.dict_row)


def _redis():
    return redis.Redis.from_url(config.REDIS_URL)


def _norm(email: str) -> str:
    import unicodedata

    return unicodedata.normalize("NFKC", email).strip().lower()


def _check_domain(email: str) -> None:
    domain = email.rsplit("@", 1)[-1]
    if domain not in config.STAFF_EMAIL_DOMAINS:
        sys.exit(
            f"refusing: {domain!r} is not a staff domain. "
            f"Allowed: {', '.join(config.STAFF_EMAIL_DOMAINS)} "
            "(set STAFF_EMAIL_DOMAINS to change)"
        )


def _audit(cur, event: str, subject: str) -> None:
    cur.execute(
        """INSERT INTO audit.events (tid, event, ok, actor_email, detail)
           VALUES (NULL, %s, true, %s, %s)""",
        (event, os.getenv("USERNAME") or os.getenv("USER") or "operator",
         json.dumps({"subject": subject})),
    )


def _kill_sessions(user_id: str) -> int:
    """Without this, a disabled account keeps working until its session expires."""
    r = _redis()
    idx = f"usess:{user_id}"
    keys = r.smembers(idx)
    for k in keys:
        r.delete(k)
    r.delete(idx)
    return len(keys)


def adduser(args) -> None:
    email = _norm(args.email)
    _check_domain(email)
    temp = passwords.new_temp_password()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE email=%s", (email,))
        if cur.fetchone():
            sys.exit(f"{email} already exists")
        cur.execute(
            """INSERT INTO users (email, display_name, pw_hash, is_admin, must_change_password)
               VALUES (%s,%s,%s,%s,true) RETURNING id""",
            (email, args.name or email.split("@")[0], passwords.hash_password(temp), args.admin),
        )
        uid = cur.fetchone()["id"]
        _audit(cur, "account_created", email)
    print(f"\n  created  {email}   ({'admin' if args.admin else 'staff'})   id={uid}")
    print(f"  password {temp}")
    print("\n  Shown once and never stored. Deliver it out of band — say it on a call,")
    print("  not in the same channel you will later send secrets through.")
    print("  They must change it at first login.\n")


def resetpw(args) -> None:
    email = _norm(args.email)
    temp = passwords.new_temp_password()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT auth_source FROM users WHERE email=%s", (email,))
        row = cur.fetchone()
        if row and row["auth_source"] == "ad":
            sys.exit(
                f"{email} authenticates against Active Directory — there is no local "
                "password to reset. Reset it in AD instead."
            )
        cur.execute(
            """UPDATE users SET pw_hash=%s, must_change_password=true,
                                failed_logins=0, locked_until=NULL
               WHERE email=%s RETURNING id""",
            (passwords.hash_password(temp), email),
        )
        row = cur.fetchone()
        if not row:
            sys.exit(f"no such user: {email}")
        _audit(cur, "password_changed", email)
    killed = _kill_sessions(str(row["id"]))
    print(f"\n  reset    {email}  ({killed} live session(s) terminated)")
    print(f"  password {temp}")
    print("\n  WARNING: this account's encryption key was wrapped under the OLD")
    print("  password, and a reset cannot re-wrap it — there is no old password to")
    print("  unwrap with. Any credential request still awaiting a client reply will")
    print("  be unreadable. A new keypair is generated at their next sign-in, so")
    print("  requests created from then on work normally.\n")


def _set_active(email: str, active: bool) -> None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET is_active=%s WHERE email=%s RETURNING id", (active, email))
        row = cur.fetchone()
        if not row:
            sys.exit(f"no such user: {email}")
        _audit(cur, "account_disabled" if not active else "account_created", email)
    killed = _kill_sessions(str(row["id"])) if not active else 0
    print(f"{'disabled' if not active else 'enabled'} {email}"
          + (f" ({killed} live session(s) terminated)" if not active else ""))


def disable(args) -> None:
    _set_active(_norm(args.email), False)


def enable(args) -> None:
    _set_active(_norm(args.email), True)


def unlock(args) -> None:
    email = _norm(args.email)
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET failed_logins=0, locked_until=NULL WHERE email=%s RETURNING id",
            (email,),
        )
        if not cur.fetchone():
            sys.exit(f"no such user: {email}")
    print(f"unlocked {email}")


def promote(args) -> None:
    _set_admin(_norm(args.email), True)


def demote(args) -> None:
    _set_admin(_norm(args.email), False)


def _set_admin(email: str, admin: bool) -> None:
    """The ONLY way is_admin ever changes.

    app_rw has no UPDATE on this column by design, so neither the API nor an
    AD group mapping can grant it — otherwise the application would be asserting
    its own privilege, which is exactly what the column-level grants prevent.
    """
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET is_admin=%s WHERE email=%s RETURNING id", (admin, email))
        if not cur.fetchone():
            sys.exit(f"no such user: {email}")
        _audit(cur, "account_created" if admin else "account_disabled", email)
    print(f"{'promoted' if admin else 'demoted'} {email}")


def list_users(args) -> None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT email, display_name, is_active, is_admin, must_change_password,
                      failed_logins, locked_until, last_login_at, auth_source
               FROM users ORDER BY email"""
        )
        rows = cur.fetchall()
    if not rows:
        print("no accounts yet — run: python manage.py adduser <email>")
        return
    print(f"\n  {'EMAIL':<40} {'SOURCE':<7} {'ROLE':<7} {'STATE':<10} {'LAST LOGIN'}")
    for r in rows:
        state = "disabled" if not r["is_active"] else (
            "locked" if r["locked_until"] else ("must-chpw" if r["must_change_password"] else "ok")
        )
        last = r["last_login_at"].strftime("%Y-%m-%d %H:%M") if r["last_login_at"] else "never"
        print(f"  {r['email']:<40} {r['auth_source']:<7} "
              f"{'admin' if r['is_admin'] else 'staff':<7} {state:<10} {last}")
    print()


def export_ad_ca(args) -> None:
    """Write the domain CA certificate to a PEM file, for AD_CA_CERT.

    Active Directory publishes its own CA certificate inside the directory, so
    this needs no access to the CA server and can be re-run when the CA renews.

    Uses the read-only bind account, which is the only thing it needs — this is
    ordinary directory data, not a secret.
    """
    import base64
    import ssl

    from ldap3 import ALL, SUBTREE, Connection, Server, Tls

    if not config.AD_BIND_USER or not config.AD_BIND_PASSWORD:
        raise SystemExit("AD_BIND_USER and AD_BIND_PASSWORD must be set")

    import socket

    out = args.out or "certs/genetech-ca.pem"

    # AD_HOST is the certificate's name and normally only resolves inside the
    # container, where compose maps it. This command is meant to be runnable from
    # a workstation too, so fall back to AD_IP when the name does not resolve.
    # Safe here precisely because this call does not validate the certificate.
    host = args.host or config.AD_HOST
    try:
        socket.getaddrinfo(host, None)
    except socket.gaierror:
        fallback = os.getenv("AD_IP", "")
        if not fallback:
            raise SystemExit(f"{host} does not resolve here and AD_IP is not set")
        print(f"  {host} does not resolve here — connecting to {fallback} instead")
        host = fallback

    # Deliberately WITHOUT certificate validation: this is the one operation that
    # cannot verify the chain, because fetching the trust anchor is its whole
    # purpose. Everything else refuses to run unvalidated.
    tls = Tls(validate=ssl.CERT_NONE, version=ssl.PROTOCOL_TLS_CLIENT)
    server = Server(host, port=config.AD_PORT,
                    use_ssl=config.AD_TLS_MODE == "ldaps", get_info=ALL, tls=tls,
                    connect_timeout=config.AD_TIMEOUT)
    conn = Connection(server, user=config.AD_BIND_USER, password=config.AD_BIND_PASSWORD,
                      raise_exceptions=False)
    if config.AD_TLS_MODE == "starttls":
        conn.start_tls()
    if not conn.bind():
        raise SystemExit(f"could not bind as {config.AD_BIND_USER}: {conn.result.get('description')}")

    root = config.AD_BASE_DN
    base = f"CN=Certification Authorities,CN=Public Key Services,CN=Services,CN=Configuration,{root}"
    conn.search(base, "(objectClass=certificationAuthority)", search_scope=SUBTREE,
                attributes=["cn", "cACertificate"])
    if not conn.entries:
        conn.unbind()
        raise SystemExit(f"no certificationAuthority object found under {base}")

    pems = []
    for e in conn.entries:
        for der in (e["cACertificate"].raw_values or []):
            b64 = base64.b64encode(der).decode()
            body = "\n".join(b64[i:i + 64] for i in range(0, len(b64), 64))
            pems.append(f"# {e['cn'].value}\n-----BEGIN CERTIFICATE-----\n{body}\n"
                        f"-----END CERTIFICATE-----\n")
            print(f"  {e['cn'].value}  ({len(der)} bytes)")
    conn.unbind()

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("".join(pems))
    print(f"\n  wrote {len(pems)} certificate(s) to {out}")
    print(f"  point AD_CA_CERT at it (inside the container that is /certs/{os.path.basename(out)})\n")


def main() -> None:
    p = argparse.ArgumentParser(prog="manage.py", description="SecureShare staff accounts")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("adduser"); a.add_argument("email"); a.add_argument("--name")
    a.add_argument("--admin", action="store_true"); a.set_defaults(fn=adduser)

    for name, fn in (("resetpw", resetpw), ("disable", disable), ("enable", enable),
                     ("unlock", unlock), ("promote", promote), ("demote", demote)):
        s = sub.add_parser(name); s.add_argument("email"); s.set_defaults(fn=fn)

    sub.add_parser("list").set_defaults(fn=list_users)

    ca = sub.add_parser("export-ad-ca", help="write the domain CA certificate for AD_CA_CERT")
    ca.add_argument("--out", default=None, help="output PEM path (default certs/genetech-ca.pem)")
    ca.add_argument("--host", default=None, help="override AD_HOST (falls back to AD_IP)")
    ca.set_defaults(fn=export_ad_ca)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
