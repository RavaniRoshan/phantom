import { readFile } from "node:fs/promises";

import { imageMetadata } from "astro/assets/utils";
import { dirname, extname } from "pathe";

import { contentAssetParam, contentAssetUrl } from "./content-assets.ts";
import { resolveRelativeImage } from "./relative-files.ts";
import type { Diagnostic, PageRecord } from "./types.ts";

/**
 * Colocated SVGs Astro's image pipeline can't measure. Astro reads an image's
 * size before it optimizes it, and for an SVG it looks for the `<svg>` tag in
 * the file's first 1,000 bytes only, then needs a width and height or a
 * viewBox on that tag. A draw.io export carries its whole diagram in a
 * `content` attribute on the tag, which pushes the tag's end past that
 * window, so one diagram fails the build (`NoImageMetadata`). Blume serves
 * such an SVG as it is instead, from the endpoint that already serves content
 * images to agents (`/blume-assets/content/…`), and warns about it
 * (`BLUME_SVG_UNOPTIMIZED`). A browser draws an SVG at any size, so the
 * only loss is the intrinsic `width`/`height` the optimized `<img>` carries.
 */

/** Whether the file at `path` is an SVG Astro can't read the size of. */
export const isUnmeasurableSvg = async (path: string): Promise<boolean> => {
  if (extname(path).toLowerCase() !== ".svg") {
    return false;
  }
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    return false;
  }
  try {
    await imageMetadata(data, path);
    return false;
  } catch {
    return true;
  }
};

/**
 * The URL an unmeasurable SVG is served at, unbased (the base links plugin
 * mounts `deployment.base`), or null when `target` isn't a colocated image
 * Astro can measure no size for.
 */
export const unmeasurableSvgUrl = async (
  sourceDir: string,
  target: string,
  projectRoot: string
): Promise<string | null> => {
  const abs = resolveRelativeImage(sourceDir, target);
  if (!(abs && (await isUnmeasurableSvg(abs)))) {
    return null;
  }
  return contentAssetUrl(contentAssetParam(projectRoot, abs));
};

/**
 * A warning for each image embed of a colocated SVG Astro can't measure, at
 * the line that embeds it (in a partial, when an `<include>` brought it in).
 */
export const unmeasurableSvgDiagnostics = async (
  pages: readonly PageRecord[]
): Promise<Diagnostic[]> => {
  const seen = new Set<string>();
  const embeds = pages.flatMap((page) => {
    const { sourcePath } = page;
    if (!sourcePath) {
      return [];
    }
    return page.links.flatMap((link) => {
      const file = link.file ?? sourcePath;
      const key = `${file}:${link.line}:${link.column}`;
      if (!link.image || seen.has(key)) {
        return [];
      }
      seen.add(key);
      const abs = resolveRelativeImage(dirname(sourcePath), link.target);
      return abs ? [{ abs, file, link }] : [];
    });
  });
  const found = await Promise.all(
    embeds.map(async (embed) =>
      (await isUnmeasurableSvg(embed.abs)) ? [embed] : []
    )
  );
  return found.flat().map(({ file, link }) => ({
    code: "BLUME_SVG_UNOPTIMIZED",
    column: link.column,
    file,
    line: link.line,
    message: `\`${link.target}\` is served as it is, not optimized: Astro can't read its size, which takes the whole \`<svg>\` tag within the file's first 1,000 bytes, with a width and height or a viewBox.`,
    severity: "warning",
    suggestion:
      "The image still shows. To have it optimized, put the `<svg>` tag's width and height (or viewBox) near the start of the file. In a draw.io export, the `content` attribute pushes them out: export without a copy of the diagram, or remove that attribute.",
  }));
};
