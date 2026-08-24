"""Password hashing — hashlib.scrypt, no third-party dependency.

Format:  scrypt$<n>$<r>$<p>$<b64 salt>$<b64 dk>

Self-describing on purpose: parameters are read back OUT of the stored string
rather than from config, so raising the work factor later does not invalidate
existing hashes. verify_password reports needs_rehash and the login handler
upgrades transparently.

Measured on this project's CPython 3.14.5: ~92 ms per verify at n=2**15.
"""

import base64
import hashlib
import hmac
import os
import unicodedata

import config


def _material(password: str) -> bytes:
    """Normalise, bound, and optionally pepper.

    NFKC matters: the same password typed on macOS and on Windows can differ
    byte-for-byte without it, and the user would simply be locked out.
    """
    pw = unicodedata.normalize("NFKC", password)
    raw = pw.encode("utf-8")
    if config.PASSWORD_PEPPER:
        # Keyed from the app environment, never the database — so a stolen
        # pg_dump on its own cannot be attacked offline.
        raw = hmac.new(config.PASSWORD_PEPPER.encode(), raw, hashlib.sha256).digest()
    return raw


def _derive(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    # maxmem is NOT optional. It defaults to 0, which OpenSSL treats as a 32 MiB
    # ceiling, and scrypt needs exactly 128*r*N bytes — 32 MiB at n=2**15. The
    # default therefore rejects these parameters by a hair. Scale with n so a
    # future increase does not silently start failing.
    maxmem = max(config.SCRYPT_MAXMEM, 128 * r * n * 2)
    return hashlib.scrypt(
        _material(password), salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=maxmem
    )


def hash_password(password: str) -> str:
    salt = os.urandom(config.SCRYPT_SALT_BYTES)
    dk = _derive(
        password, salt, config.SCRYPT_N, config.SCRYPT_R, config.SCRYPT_P, config.SCRYPT_DKLEN
    )
    return "scrypt${}${}${}${}${}".format(
        config.SCRYPT_N,
        config.SCRYPT_R,
        config.SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> tuple[bool, bool]:
    """Return (ok, needs_rehash). Never raises on a malformed hash."""
    try:
        scheme, n_s, r_s, p_s, salt_b64, dk_b64 = stored.split("$")
        if scheme != "scrypt":
            return False, False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
    except Exception:
        return False, False

    try:
        actual = _derive(password, salt, n, r, p, len(expected))
    except Exception:
        return False, False

    ok = hmac.compare_digest(actual, expected)
    stale = (n, r, p) != (config.SCRYPT_N, config.SCRYPT_R, config.SCRYPT_P)
    return ok, ok and stale


# A real hash of a random value, used to burn the same ~92 ms when an account
# does not exist. Without it, a 2 ms miss versus a 92 ms hit enumerates staff.
DUMMY_HASH = hash_password(base64.b64encode(os.urandom(24)).decode())


def new_temp_password(length: int = 20) -> str:
    """Operator-issued temporary password.

    Alphabet excludes I l 1 O 0 — these get read aloud over the phone.
    """
    import secrets as pysecrets

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(pysecrets.choice(alphabet) for _ in range(length))


def check_policy(password: str, email: str = "") -> str | None:
    """Return an error message, or None if acceptable."""
    pw = unicodedata.normalize("NFKC", password)
    if len(pw) < config.MIN_PASSWORD_LENGTH:
        return f"Password must be at least {config.MIN_PASSWORD_LENGTH} characters."
    if len(pw) > config.MAX_PASSWORD_LENGTH:
        return f"Password must be at most {config.MAX_PASSWORD_LENGTH} characters."
    if email and pw.lower() == email.lower():
        return "Password must not be your email address."
    if pw.lower() in {"password", "passw0rd", "genetech", "secureshare", "changeme"}:
        return "That password is too common."
    if len(set(pw)) < 5:
        return "Password must use at least 5 distinct characters."
    return None
