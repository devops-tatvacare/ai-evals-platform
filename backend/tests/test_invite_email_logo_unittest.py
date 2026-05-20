"""Platform logo must embed as a CID inline part, not a data: URI.

Gmail/Outlook and most major clients strip ``data:`` URIs in ``<img src>``,
so the logo silently vanished in invite emails. The fix references the logo
by ``cid:`` and attaches it as a ``multipart/related`` inline image.
"""
import sys
import unittest
import uuid
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

fake_database = ModuleType('app.database')
fake_database.get_db = None
sys.modules.setdefault('app.database', fake_database)

from app.services.mail import sender as sender_module
from app.services.mail import template_renderer
from app.services.mail.call_sites import CallSite
from app.services.mail.template_renderer import RenderedMail, render


def _render_db():
    db = MagicMock()
    db.get = AsyncMock(return_value=SimpleNamespace(name='Acme Health'))
    db.scalar = AsyncMock(return_value=None)
    return db


_CONTENT = {
    'user_name': 'Jane',
    'inviter_name': 'admin@example.com',
    'invite_url': 'https://example.test/signup?invite=tok',
    'expires_at_display': '23 May 2026, 17:00 IST',
}


class RenderLogoEmbeddingTests(unittest.IsolatedAsyncioTestCase):
    async def test_html_references_logo_by_cid_not_data_uri(self):
        rendered = await render(_render_db(), uuid.uuid4(), CallSite.SIGNUP_INVITE, dict(_CONTENT))

        self.assertNotIn('data:image/jpeg;base64', rendered.html)
        self.assertIn('cid:', rendered.html)

    async def test_inline_image_carries_logo_bytes_matching_html_cid(self):
        rendered = await render(_render_db(), uuid.uuid4(), CallSite.SIGNUP_INVITE, dict(_CONTENT))

        self.assertTrue(rendered.inline_images, 'expected at least one inline image')
        logo = rendered.inline_images[0]
        self.assertEqual(logo.subtype, 'jpeg')
        self.assertTrue(logo.data, 'expected non-empty logo bytes')
        self.assertIn(f'cid:{logo.cid}', rendered.html)


class SenderAttachesInlineImageTests(unittest.IsolatedAsyncioTestCase):
    async def test_message_carries_related_image_with_matching_content_id(self):
        cid = 'platform-logo@tatvacare'
        rendered = RenderedMail(
            subject='Set up your account',
            html=f'<html><body><img src="cid:{cid}"></body></html>',
            text='set up your account',
            from_display='TatvaCare',
            inline_images=(template_renderer.InlineImage(cid=cid, data=b'\xff\xd8\xff', subtype='jpeg'),),
        )

        captured = {}

        async def _fake_send(msg, **kwargs):
            captured['msg'] = msg
            return ({}, 'ok')

        settings_stub = SimpleNamespace(
            SMTP_HOST='smtp.test', SMTP_USERNAME='u', SMTP_PASSWORD='p',
            SMTP_FROM_ADDRESS='no-reply@tatvacare.in', SMTP_FROM_DISPLAY='TatvaCare',
            SMTP_PORT=587, SMTP_USE_STARTTLS=True, SMTP_TIMEOUT_SECONDS=30,
        )

        with patch.object(sender_module, 'render', new=AsyncMock(return_value=rendered)), \
             patch.object(sender_module, 'write_log', new=AsyncMock()), \
             patch.object(sender_module, 'settings', settings_stub), \
             patch.object(sender_module.aiosmtplib, 'send', new=_fake_send):
            await sender_module.send_mail(
                MagicMock(),
                tenant_id=uuid.uuid4(),
                call_site=CallSite.SIGNUP_INVITE,
                recipient='ok@allowed.com',
                context={},
            )

        msg = captured['msg']
        content_ids = [part.get('Content-ID') for part in msg.walk()]
        self.assertIn(f'<{cid}>', content_ids)
        image_parts = [p for p in msg.walk() if p.get_content_type() == 'image/jpeg']
        self.assertEqual(len(image_parts), 1)


if __name__ == '__main__':
    unittest.main()
