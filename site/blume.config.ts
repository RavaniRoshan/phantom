import { defineConfig } from "blume";
import { orama } from "blume/search";

export default defineConfig({
  title: "Phantom",
  description:
    "Background computer-use agent for Windows. Give it a task; watch it work inside an isolated VM.",
  logo: {
    image: "/logo.svg",
    text: "Phantom",
    href: "/",
  },
  github: {
    owner: "RavaniRoshan",
    repo: "phantom",
    branch: "main",
    dir: "site",
  },
  banner: {
    content: "Private beta — computer use runs in an isolated Windows VM.",
    link: { text: "Read the beta gates", href: "/benchmarks/release-gates" },
    dismissible: true,
    id: "beta-banner",
  },
  footer: {
    copyright: `© ${new Date().getFullYear()} Phantom`,
    links: [
      { label: "Documentation", href: "/introduction" },
      { label: "Live capture proof", href: "/benchmarks/github-actions-capture" },
      { label: "GitHub", href: "https://github.com/RavaniRoshan/phantom" },
    ],
  },
  theme: {
    accent: "#7c5cff",
    action: "#38e8c8",
    radius: "lg",
    mode: "dark",
    toggle: true,
    fonts: {
      display: "space-grotesk",
      body: "inter",
      mono: "jetbrains-mono",
    },
  },
  search: orama(),
  agents: {
    llmsTxt: true,
    catalog: true,
    skillMd: true,
  },
  seo: {
    og: { enabled: true },
    sitemap: true,
    robots: true,
    structuredData: true,
  },
  deployment: {
    site: "https://ravaniroshan.github.io/phantom/",
    base: "/phantom",
  },
  lastModified: "git",
});
