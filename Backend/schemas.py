"""Request/response models.

Every field that can carry ciphertext or key material is typed SecretStr, so a
traceback or a `repr()` renders `**********` instead of the value. That kills the
likeliest real-world leak path.
"""

from datetime import datetime

from pydantic import BaseModel, Field, SecretStr, field_serializer

PRESETS = {"view": 7 * 24 * 3600, "1h": 3600, "24h": 24 * 3600, "7d": 7 * 24 * 3600}


class CreateMeta(BaseModel):
    """The JSON part of the multipart create request."""

    expiry_preset: str = "view"
    expires_in: int | None = None  # seconds, used when preset == "custom"
    has_passphrase: bool = False
    kdf_salt: str | None = None      # base64
    kdf_iters: int | None = None
    verifier: SecretStr | None = None  # base64
    max_attempts: int = Field(default=5, ge=1, le=20)
    label: str | None = Field(default=None, max_length=120)
    webhook_url: str | None = None
    notify_email: str | None = None


class CreateOut(BaseModel):
    token: str
    tid: str
    url: str
    expires_at: datetime


class MetaOut(BaseModel):
    has_passphrase: bool
    kdf_salt: str | None = None
    kdf_iters: int | None = None
    expires_at: datetime
    size_bytes: int
    attempts_remaining: int
    reveal_ticket: str


class RevealIn(BaseModel):
    ticket: str
    verifier: SecretStr | None = None  # base64


class RevealOut(BaseModel):
    """The one place a payload legitimately leaves the server.

    blob stays SecretStr so a traceback or repr() still prints `**********`, but
    an explicit serializer unwraps it for the actual response — without this,
    pydantic masks the field on the way out and the recipient receives nothing
    but asterisks.
    """

    blob: SecretStr  # base64 ciphertext — opaque to this server
    size_bytes: int

    @field_serializer("blob", when_used="always")
    def _unwrap(self, v: SecretStr) -> str:
        return v.get_secret_value()


class SecretRow(BaseModel):
    tid: str
    label: str | None
    created_by: str | None = None  # populated for admins viewing the whole company
    created_at: datetime
    expires_at: datetime
    status: str
    status_at: datetime | None
    status_reason: str | None
    has_passphrase: bool
    size_bytes: int
    failed_attempts: int
    max_attempts: int


# --- credential requests (the inbound direction) ---------------------------

class RequestCreate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    client_hint: str | None = Field(default=None, max_length=200)
    expires_in: int | None = None  # seconds; defaults to REQUEST_TTL_SECONDS


class RequestOut(BaseModel):
    token: str  # returned ONCE
    rid: str
    url: str
    expires_at: datetime


class RequestRow(BaseModel):
    rid: str
    label: str | None
    client_hint: str | None
    created_at: datetime
    expires_at: datetime
    status: str
    status_at: datetime | None
    fulfilled_tid: str | None
    requested_by: str | None = None  # populated for admins viewing everyone's
    # State of the client's reply: 'active' = waiting to be read, 'viewed' =
    # already retrieved and destroyed, 'expired' = timed out unread.
    reply_status: str | None = None
    reply_read_at: datetime | None = None
    # The public key this request was issued against. The UI compares it with the
    # employee's current key and refuses to consume a reply it could not decrypt.
    request_pubkey: str | None = None


class RequestPublic(BaseModel):
    """What the client's submission page is told. No tid, no internal ids."""

    label: str | None
    requested_by: str
    requested_by_email: str
    pubkey: str  # base64 — the key the client encrypts to
    expires_at: datetime


# --- admin activity feed ----------------------------------------------------

class ActivityRow(BaseModel):
    id: int
    tid: str | None
    event: str
    ok: bool
    at: datetime
    ip: str | None
    user_agent: str | None
    detail: dict | None
    actor_email: str | None


class ActivityPage(BaseModel):
    rows: list[ActivityRow]
    # Pass back as `cursor` for the next page. None means this is the end.
    next_cursor: int | None = None


class AuditRow(BaseModel):
    event: str
    ok: bool
    at: datetime
    ip: str | None
    user_agent: str | None
    detail: dict | None
    # Who performed the action. NULL for reveal/peek/expire — those are done by
    # an unauthenticated recipient, and that asymmetry is exactly what the trail
    # should show.
    actor_email: str | None = None
