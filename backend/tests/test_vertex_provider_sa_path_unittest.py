"""VertexProvider accepts the per-tenant SA via service_account_path (the same
handoff the env-var SA uses), in addition to an in-memory JSON string."""
import os
import tempfile
import unittest


class VertexProviderServiceAccountPathTests(unittest.TestCase):
    def test_reads_service_account_from_path(self):
        from app.services.evaluators.llm_base import VertexProvider
        # Non-JSON content proves the file is read and fed to the parser; we
        # cannot construct a real client without a valid SA key.
        fd, path = tempfile.mkstemp(suffix=".json")
        os.write(fd, b"not valid json")
        os.close(fd)
        try:
            with self.assertRaises(ValueError) as ctx:
                VertexProvider(service_account_path=path)
            self.assertIn("not valid JSON", str(ctx.exception))
        finally:
            os.unlink(path)

    def test_requires_json_or_path(self):
        from app.services.evaluators.llm_base import VertexProvider
        with self.assertRaises(ValueError) as ctx:
            VertexProvider()
        self.assertIn("service_account", str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
