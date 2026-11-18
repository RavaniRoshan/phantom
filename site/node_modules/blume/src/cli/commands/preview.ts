import { existsSync } from "node:fs";

import { preview } from "astro";
import { defineCommand } from "citty";
import { join } from "pathe";

import { normalizeBasePath } from "../../core/base-path.ts";
import { loadConfig } from "../../core/config.ts";
import { resolveProjectContext } from "../../core/project.ts";
import { publicFolder } from "../../core/static-host.ts";
import { deployOutputDir } from "../../deploy/adapter-output.ts";
import { deployPlatform } from "../../deploy/platforms/index.ts";
import { distDir } from "../../deploy/platforms/paths.ts";
import { parsePort } from "../args.ts";
import { commandMeta } from "../command-meta.ts";
import { refuseIfEjected } from "../eject-scripts.ts";
import { normalizeHost } from "../host-args.ts";
import { logger } from "../log.ts";
import { previewRedirects, servePreview } from "../preview-pages.ts";

export const previewCommand = defineCommand({
  args: {
    host: { description: "Network host to bind.", type: "string" },
    port: { description: "Port to listen on.", type: "string" },
  },
  meta: commandMeta.preview,
  async run({ args }) {
    const root = process.cwd();
    await refuseIfEjected(root, "preview");
    const { config } = await loadConfig(root);
    const context = resolveProjectContext(root, config);

    // Astro previews a server build through its adapter's preview entrypoint,
    // and the Vercel and Netlify adapters declare none, so Astro would throw
    // mid-command. Say so up front, with what to run instead.
    const { deployment } = config;
    const platform = deployPlatform(deployment);
    if (deployment.options.output === "server" && platform.previewDeploy) {
      logger.error(
        `\`blume preview\` can't serve a ${deployment.kind}() server build: ${platform.astro?.package} has no local preview server. Run \`blume dev\` to try the site locally, or deploy a preview with \`${platform.previewDeploy}\`.`
      );
      process.exit(1);
    }

    // `blume dev` writes `.blume/astro.config.mjs` too, so the runtime alone
    // doesn't mean there's anything to serve: the build output must exist.
    if (
      !existsSync(join(context.outDir, "astro.config.mjs")) ||
      !existsSync(deployOutputDir(config, context))
    ) {
      logger.error("No build found. Run `blume build` first.");
      process.exit(1);
    }

    const server = await preview({
      logLevel: "info",
      root: context.outDir,
      server: {
        // `normalizeHost` maps a bare `--host` (citty parses it as "") to
        // `true` so Vite binds all interfaces instead of the hostname "".
        host: normalizeHost(args.host),
        port: parsePort(args.port),
      },
    });
    // A static build is served by Vite, which knows nothing of the host's
    // redirect rules or trailing-slash handling, and whose HTML fallback
    // would answer a page with the redirect page of a redirect from its
    // `.html` URL.
    if (deployment.options.output === "static") {
      servePreview(server, {
        base: normalizeBasePath(deployment.options.base),
        distDir: distDir(context),
        isPublicFolder: publicFolder(join(context.root, "public")),
        redirects: previewRedirects(config, context.outDir),
      });
    }
  },
});
