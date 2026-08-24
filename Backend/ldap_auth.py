"""Active Directory authentication against the live Genetech forest.

Two-step, and the split is the whole design:

  1. RESOLVE — a read-only service account turns whatever the person typed into
     their Windows username (`sAMAccountName`).
  2. BIND    — SecureShare then binds to the DC **as that person**, with the
     password they supplied. That bind is the password check; the service
     account never authenticates anyone and confers no privilege.

Why resolution is needed at all: the forest uses five different UPN suffixes
(@genetech.pk, @genetech.co, @genetechsolutions.com, @consulnet.net,
@codegirls.pro), and 219 of 343 staff have a mail domain that differs from their
UPN domain. So neither "append the domain" nor "use it as a UPN" reliably
produces a bind name. `sAMAccountName` is populated on 100% of accounts, and
NT-style `GENETECH\\user` binding works regardless of suffix — but you have to
look it up first.

The browser still handles the password for a moment. That is not incidental: it
is what unwraps the private key used to read credential replies. An SSO redirect
would remove the password from the browser and silently break inbound sharing.

ldap3 is synchronous, so every call here runs in a worker thread, exactly as
password verification already does.
"""

import asyncio
import logging
import ssl
import time
from dataclasses import dataclass

from ldap3 import ALL, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException

import config

log = logging.getLogger("secureshare")

# userAccountControl bit 0x2. The search filters disabled accounts out server
# side, but the flag is read too so the audit reason can be accurate.
UAC_DISABLED = 0x2

# AD's LDAP_MATCHING_RULE_IN_CHAIN. Walks nested group membership, so putting a
# group inside `active-employee` later does not silently lock its members out.
IN_CHAIN = "1.2.840.113556.1.4.1941"

# Bit-AND rule, used to exclude disabled accounts inside the filter itself.
BIT_AND = "1.2.840.113556.1.4.803"

ATTRS = [
    "displayName",
    "cn",
    "mail",
    "userPrincipalName",
    "sAMAccountName",
    "objectGUID",
    "userAccountControl",
    "memberOf",
]


@dataclass(frozen=True, slots=True)
class LdapIdentity:
    email: str          # `mail` where present, else the UPN
    display_name: str
    upn: str
    guid: str
    sam: str
    groups: tuple[str, ...]


def _server() -> Server:
    tls = None
    if config.AD_TLS_MODE != "none":
        # With a CA supplied ldap3 verifies the chain AND the hostname, which is
        # why AD_HOST must be the name on the certificate rather than an IP —
        # config.py refuses that combination outright.
        tls = Tls(
            validate=ssl.CERT_REQUIRED if config.AD_CA_CERT else ssl.CERT_NONE,
            ca_certs_file=config.AD_CA_CERT or None,
            version=ssl.PROTOCOL_TLS_CLIENT,
        )
    return Server(
        config.AD_HOST,
        port=config.AD_PORT,
        use_ssl=config.AD_TLS_MODE == "ldaps",
        get_info=ALL,
        tls=tls,
        connect_timeout=config.AD_TIMEOUT,
    )


def _connect(user: str, password: str) -> Connection | None:
    """Bind, upgrading to TLS first when configured. None on any failure."""
    conn = Connection(_server(), user=user, password=password, raise_exceptions=False)

    if config.AD_TLS_MODE == "starttls" and not conn.start_tls():
        # Refusing to continue is the point: a DC that cannot do StartTLS is a
        # configuration problem, not a reason to send a password in the clear.
        log.error("AD StartTLS unavailable on %s — refusing to bind in cleartext", config.AD_HOST)
        return None

    return conn if conn.bind() else None


def _esc(value: str) -> str:
    """RFC 4515 escaping for an LDAP filter value.

    Every value below comes from a login form, and the resolution filter now has
    four separate injection points. Without this, a crafted identifier could
    rewrite the filter — including deleting the group clause that gates access.
    """
    out = []
    for ch in value:
        if ch in "\\*()\0/":
            out.append("\\%02x" % ord(ch))
        else:
            out.append(ch)
    return "".join(out)


def _guid(entry) -> str:
    """objectGUID as a stable string. ldap3 renders it braced; strip for tidiness."""
    raw = entry["objectGUID"].value if "objectGUID" in entry else None
    return str(raw).strip("{}").lower() if raw else ""


def _attr(entry, name: str) -> str:
    try:
        v = entry[name].value
    except Exception:
        return ""
    return str(v) if v else ""


def _resolve(conn: Connection, typed: str):
    """Find the one directory object the typed identifier refers to.

    Accepts a bare username, a UPN, or a mail address. Returns the ldap3 entry,
    or None when there is no unambiguous match.
    """
    ident = _esc(typed)
    local = _esc(typed.split("@")[0])

    forms = [f"(userPrincipalName={ident})", f"(mail={ident})", f"(sAMAccountName={ident})"]
    if local != ident:
        forms.append(f"(sAMAccountName={local})")

    # The group gate lives HERE rather than after the bind. A non-member simply
    # does not resolve, so we never attempt a bind for them: their badPwdCount is
    # untouched, and from outside "not a member" looks exactly like "no such
    # account" and "wrong password".
    gate = ""
    if config.AD_REQUIRED_GROUP:
        gate = f"(memberOf:{IN_CHAIN}:={_esc(config.AD_REQUIRED_GROUP)})"

    flt = (
        f"(&(objectCategory=person)(objectClass=user)"
        f"(!(userAccountControl:{BIT_AND}:={UAC_DISABLED}))"
        f"{gate}(|{''.join(forms)}))"
    )

    conn.search(config.AD_BASE_DN, flt, search_scope=SUBTREE, attributes=ATTRS)
    entries = list(conn.entries)
    if not entries:
        return None
    if len(entries) == 1:
        return entries[0]

    # More than one object matched — e.g. someone's mail equals another's
    # username. Rank by how exact the match is rather than taking whichever the
    # directory returned first, and refuse if the best rank is still ambiguous.
    low = typed.lower()
    for attr in ("sAMAccountName", "userPrincipalName", "mail"):
        exact = [e for e in entries if _attr(e, attr).lower() == low]
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            log.warning("AD identifier is ambiguous across %d objects on %s", len(exact), attr)
            return None

    log.warning("AD identifier matched %d objects with no exact match", len(entries))
    return None


def _resolve_and_bind(typed: str, password: str) -> LdapIdentity | None:
    """Synchronous. Returns None for any authentication failure."""
    svc = user_conn = None
    try:
        svc = _connect(config.AD_BIND_USER, config.AD_BIND_PASSWORD)
        if svc is None:
            # An operational fault, not a credential problem. Logged loudly
            # because every sign-in fails until it is fixed.
            log.error("AD service bind failed for %s — check AD_BIND_USER/AD_BIND_PASSWORD",
                      config.AD_BIND_USER)
            return None

        entry = _resolve(svc, typed)
        if entry is None:
            return None

        sam = _attr(entry, "sAMAccountName")
        if not sam:
            log.warning("AD object matched but has no sAMAccountName")
            return None

        # THE PASSWORD CHECK. Binding as the user, not as the service account.
        user_conn = _connect(f"{config.AD_NETBIOS}\\{sam}", password)
        if user_conn is None:
            return None

        uac = int(_attr(entry, "userAccountControl") or 0)
        if uac & UAC_DISABLED:      # belt and braces; the filter excludes these
            return None

        upn = _attr(entry, "userPrincipalName")
        # `mail` is the real company address and is unique across the forest, so
        # it is the identity. 9 accounts have none; they fall back to the UPN.
        email = _attr(entry, "mail") or upn or f"{sam}@{config.AD_UPN_SUFFIX}"
        name = _attr(entry, "displayName") or _attr(entry, "cn") or sam
        groups = tuple(str(g) for g in entry["memberOf"].values) if "memberOf" in entry else ()

        return LdapIdentity(
            email=email.lower(),
            display_name=name[:120],
            upn=(upn or email).lower(),
            guid=_guid(entry),
            sam=sam,
            groups=groups,
        )
    except LDAPException as ex:
        log.warning("AD error: %s", type(ex).__name__)
        return None
    except Exception:
        log.exception("unexpected AD failure")
        return None
    finally:
        for c in (user_conn, svc):
            if c is not None:
                try:
                    c.unbind()
                except Exception:
                    pass


async def authenticate(identifier: str, password: str) -> LdapIdentity | None:
    if not config.AD_ENABLED or not password or not identifier:
        return None
    return await asyncio.to_thread(_resolve_and_bind, identifier.strip().lower(), password)


async def constant_floor(started: float) -> None:
    """Pad a failed authentication out to a fixed duration.

    Without this, the paths differ measurably: "no such account" stops after the
    directory search, "wrong password" costs an extra bind round trip, and a
    local account costs ~92 ms of scrypt. Any of those differences enumerates the
    staff directory with a stopwatch.

    Used by the LOCAL password path too, despite living here — since a bare
    username can resolve to either backend, both must answer in the same time.
    Keep it that way.
    """
    remaining = (config.AD_TIMING_FLOOR_MS / 1000) - (time.perf_counter() - started)
    if remaining > 0:
        await asyncio.sleep(remaining)
