"""Transactional mail subsystem.

Capability-named. SMTP-only in v1; the MailSender protocol leaves room
for a Graph adapter later without touching call sites.
"""
from app.services.mail.call_sites import CallSite
from app.services.mail.sender import (
    MailNotConfigured,
    MailRecipientRejected,
    MailSendError,
    send_mail,
)

__all__ = [
    "CallSite",
    "MailNotConfigured",
    "MailRecipientRejected",
    "MailSendError",
    "send_mail",
]
