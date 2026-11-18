"""W0.1 image transport contract (DEV-PLAN section 5, Days 1-2).

Run with the standard library only:
    python -m unittest discover -s python/tests -p 'test_image_contract.py' -v
"""

import base64
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phantom_llm.vision import (  # noqa: E402
    PNG_MAGIC,
    b64,
    detect_image_mime,
    effective_image_mime,
    encode_image,
    to_data_uri,
)


class ImageContractTest(unittest.TestCase):
    def test_png_magic_detection(self):
        self.assertEqual(detect_image_mime(PNG_MAGIC + b"rest"), "image/png")
        self.assertEqual(detect_image_mime(b"\xff\xd8\xff\xe0"), "image/jpeg")
        # Garbage defaults to PNG (the normalized capture format).
        self.assertEqual(detect_image_mime(b"garbage"), "image/png")

    def test_declared_mime_is_honored(self):
        self.assertEqual(effective_image_mime(PNG_MAGIC, "image/jpeg"), "image/jpeg")
        # Parameters and case are tolerated.
        self.assertEqual(
            effective_image_mime(PNG_MAGIC, " Image/PNG ;charset=x"), "image/png"
        )
        # Unsupported/garbage declarations never override the sniffed bytes.
        self.assertEqual(effective_image_mime(PNG_MAGIC, "application/zip"), "image/png")
        self.assertEqual(effective_image_mime(b"\xff\xd8\xff", "not-a-mime"), "image/jpeg")

    def test_encode_image_data_uri(self):
        png = PNG_MAGIC + b"payload"
        uri = encode_image(png, "image/png")
        self.assertTrue(uri.startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(uri.split(",", 1)[1]), png)
        self.assertEqual(to_data_uri(b"x", "image/gif"), "data:image/gif;base64,eA==")
        self.assertEqual(b64(b"x"), "eA==")

    def test_proto_declares_screenshot_mime_field_7(self):
        proto = (ROOT / "proto" / "phantom.proto").read_text(encoding="utf-8")
        action_block = proto.split("message ActionRequest {", 1)[1].split("}", 1)[0]
        self.assertIn("string screenshot_mime = 7;", action_block)

    def test_no_provider_hardcodes_a_media_type(self):
        # Every provider must route through the shared helper (ADR-001).
        offenders = []
        for path in (ROOT / "python" / "phantom_llm" / "providers").glob("*.py"):
            text = path.read_text(encoding="utf-8")
            for needle in (
                'data:image/png;base64,',
                '"media_type": "image/png"',
                '"mime_type": "image/png"',
            ):
                if needle in text:
                    offenders.append((path.name, needle))
        self.assertEqual(offenders, [], "providers must call vision.encode_image/effective_image_mime")

    def test_all_five_providers_use_shared_helper(self):
        from phantom_llm.providers import base  # noqa: F401 - import sanity
        for name in ("claude", "openai", "gemini", "nvidia", "ollama"):
            text = (ROOT / "python" / "phantom_llm" / "providers" / f"{name}.py").read_text(
                encoding="utf-8"
            )
            self.assertTrue(
                "from ..vision import" in text,
                f"{name}.py must import the shared vision helper",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
