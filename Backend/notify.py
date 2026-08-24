"""Sender notifications — webhook (HMAC-signed) and optional email.

Runs as a BackgroundTask so a slow endpoint can never delay or break a reveal.
Payloads carry the tid and a timestamp; never the secret, never the token.
"""

import json
import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

import httpx

import audit
import config
import security

log = logging.getLogger("secureshare")


async def secret_viewed(tid: str, webhook_url: str | None, email: str | None, ip: str | None) -> None:
    payload = {
        "event": "secret_viewed",
        "tid": tid,
        "viewed_at": datetime.now(timezone.utc).isoformat(),
        "viewer_ip": ip,
    }
    if webhook_url:
        await _post_webhook(webhook_url, payload)
    if email and config.SMTP_HOST:
        _send_email(email, tid, ip)


async def request_fulfilled(rid: str, label: str | None, email: str | None, ip: str | None) -> None:
    """A client answered a credential request.

    Notification only — the payload deliberately carries no secret content, and
    could not usefully carry any: the submission is encrypted to the employee's
    public key, which this server does not hold.
    """
    if not (email and config.SMTP_HOST):
        return
    msg = EmailMessage()
    msg["Subject"] = "A client has responded to your credential request"
    msg["From"] = config.SMTP_FROM
    msg["To"] = email
    msg.set_content(
        f"Your credential request{f' ({label})' if label else ''} has been answered.\n\n"
        f"Reference: {rid[:16]}\n"
        f"Submitted from: {ip or 'unknown'}\n"
        f"At: {datetime.now(timezone.utc).isoformat()}\n\n"
        "Open SecureShare to retrieve it. It can be retrieved once, and only by you.\n\n"
        "— SecureShare by Genetech Solutions\n"
    )
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as s:
            s.starttls()
            if config.SMTP_USER:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            s.send_message(msg)
    except Exception:
        log.warning("request notification failed")


async def _post_webhook(url: str, payload: dict) -> None:
    if not security.webhook_allowed(url):  # re-check: DNS may have changed since create
        return
    body = json.dumps(payload).encode()
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            resp = await client.post(
                url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-SecureShare-Signature": security.sign(body),
                },
            )
        await audit.record(payload["tid"], audit.NOTIFIED, ok=resp.status_code < 400,
                           target="webhook", status_code=resp.status_code)
    except Exception:
        log.warning("webhook delivery failed")
        await audit.record(payload["tid"], audit.NOTIFIED, ok=False, target="webhook")


def _send_email(to: str, tid: str, ip: str | None) -> None:
    msg = EmailMessage()
    msg["Subject"] = "Your SecureShare secret was viewed"
    msg["From"] = config.SMTP_FROM
    msg["To"] = to
    msg.set_content(
        "A secret you created with SecureShare has just been viewed and destroyed.\n\n"
        f"Reference: {tid[:16]}\n"
        f"Viewed from: {ip or 'unknown'}\n"
        f"At: {datetime.now(timezone.utc).isoformat()}\n\n"
        "If this was not expected, treat the credential as compromised and rotate it.\n\n"
        "— SecureShare by Genetech Solutions\n"
    )
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=10) as s:
            s.starttls()
            if config.SMTP_USER:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            s.send_message(msg)
    except Exception:
        log.warning("email notification failed")
