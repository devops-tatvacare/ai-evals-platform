"""Rate-limit key helpers.

Prefer authenticated actor identifiers when available so protected endpoints do
not accidentally rate-limit whole office IP blocks behind the same proxy/NAT.
Fall back to remote address for anonymous or invalid-auth requests.
"""
from __future__ import annotations

import jwt
from fastapi import Request
from slowapi.util import get_remote_address

from app.auth.utils import decode_access_token


def actor_or_ip_rate_limit_key(request: Request) -> str:
    """Return a stable rate-limit key for authenticated requests.

    Uses the JWT access token subject when a valid bearer token is present;
    otherwise falls back to the remote IP address. The helper must never raise,
    because SlowAPI resolves the key before route dependencies run.
    """
    auth_header = request.headers.get('authorization', '')
    scheme, _, token = auth_header.partition(' ')
    if scheme.lower() == 'bearer' and token:
        try:
            payload = decode_access_token(token)
        except (jwt.InvalidTokenError, ValueError, KeyError):
            pass
        else:
            subject = payload.get('sub')
            if subject:
                return f'user:{subject}'

    remote = get_remote_address(request) or 'unknown'
    return f'ip:{remote}'


__all__ = ['actor_or_ip_rate_limit_key']
