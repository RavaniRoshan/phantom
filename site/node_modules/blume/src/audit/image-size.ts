import sharp from "sharp";

/**
 * Pixel dimensions read from an image header via sharp, which is already the
 * build's image optimizer and so covers every format the pipeline can emit —
 * WebP and AVIF included. libvips reads only the header and rejects malformed
 * input with an error rather than looping on it, which is why the previous
 * pure-JS parser was retired: it could be driven into an infinite loop by a
 * crafted ICNS, HEIF, or JXL file and hang the build. An unrecognized or
 * truncated buffer yields null and its checks simply don't run.
 */
export interface ImageSize {
  width: number;
  height: number;
}

/** The image's pixel dimensions, or null when the format isn't recognized. */
export const imageSize = async (bytes: Buffer): Promise<ImageSize | null> => {
  try {
    const { width, height } = await sharp(bytes).metadata();
    return width > 0 && height > 0 ? { height, width } : null;
  } catch {
    return null;
  }
};
