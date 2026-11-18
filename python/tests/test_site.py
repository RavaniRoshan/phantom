"""B7/B8 — Blume product site: landing page, docs, and Pages deployment."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


class SiteTest(unittest.TestCase):
    def test_blume_config_is_branded_and_deployed(self):
        cfg = read("site/blume.config.ts")
        for token in ('Phantom', 'space-grotesk', 'ravaniroshan.github.io/phantom', 'orama', 'llmsTxt'):
            self.assertIn(token, cfg)

    def test_landing_page_sections(self):
        page = read("site/pages/index.astro")
        for token in ('PageLayout', 'Give it a task', 'capture.png', 'READY', 'How it fits together'):
            self.assertIn(token, page if token != 'READY' else page.upper())

    def test_docs_cover_product(self):
        docs = list((ROOT / "site/docs").rglob("*.mdx"))
        self.assertGreaterEqual(len(docs), 10)
        names = {p.name for p in docs}
        for expected in ("introduction.mdx", "installation.mdx", "providers.mdx", "safety.mdx",
                         "architecture.mdx", "release-gates.mdx",
                         "github-actions-capture.mdx"):
            self.assertIn(expected, names)

    def test_internal_links_use_base_without_docs_prefix(self):
        page = read("site/pages/index.astro")
        cfg = read("site/blume.config.ts")
        self.assertNotIn('href="/docs/', page)
        self.assertNotIn('href: "/docs/', cfg)
        self.assertIn('${base}introduction', page)

    def test_deploy_workflow(self):
        wf = read(".github/workflows/deploy-site.yml")
        for token in ('pages: write', 'upload-pages-artifact', 'deploy-pages', 'site/dist'):
            self.assertIn(token, wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
