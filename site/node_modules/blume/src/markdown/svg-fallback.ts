import { fileURLToPath } from "node:url";

import { dirname, resolve } from "pathe";

import { unmeasurableSvgUrl } from "../core/svg-images.ts";
import type { MdastNode } from "./mdast.ts";

/**
 * Sätteri MDAST plugin that points an image embed of a colocated SVG Astro
 * can't measure (a draw.io export, say: see `core/svg-images.ts`) at its
 * served original, `/blume-assets/content/…`. A relative image is one Astro
 * imports and optimizes, and an import it can't read the size of fails the
 * whole build; a root-relative URL is one it leaves alone, so the page shows
 * the file as it is. Runs before the base links plugin, which mounts
 * `deployment.base` on the URL like any other root-relative image.
 */

interface ImageNode extends MdastNode {
  url?: string | null;
}

/** The slice of Sätteri's MDAST visitor context this plugin needs. */
interface ImageContext {
  fileURL: URL | undefined;
  setProperty: (node: MdastNode, key: "url", value: string) => void;
}

const SVG = /\.svg$/iu;

export const svgFallbackPlugin = () => {
  // Content image URLs are keyed by their path from the project root, where
  // Blume runs Astro (see `contentAssetParam`).
  const projectRoot = resolve(".");
  return {
    async image(node: ImageNode, ctx: ImageContext) {
      const { url } = node;
      if (!(ctx.fileURL && url && SVG.test(url))) {
        return;
      }
      const served = await unmeasurableSvgUrl(
        dirname(fileURLToPath(ctx.fileURL)),
        url,
        projectRoot
      );
      if (served) {
        ctx.setProperty(node, "url", served);
      }
    },
    name: "blume-svg-fallback",
  };
};
