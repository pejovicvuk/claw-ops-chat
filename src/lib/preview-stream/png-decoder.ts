import sharp from "sharp";

/**
 * Decode a PNG buffer into packed RGB24 (3 bytes per pixel, no alpha)
 * suitable for piping into ffmpeg's `-pix_fmt rgb24` rawvideo input.
 *
 * sharp ships musl prebuilds for `linuxmusl-x64`, so the Alpine
 * production image picks up the native binary without compiling
 * libvips at install time. Local macOS / Linux dev gets the
 * matching prebuilt for the host triple.
 *
 * Dropping alpha is correct here: Chromium's `Page.startScreencast`
 * with `format: "png"` always produces opaque frames (the previewed
 * page composites onto white). Keeping alpha would feed ffmpeg
 * rgba-shaped data while we tell it `rgb24`, which silently corrupts
 * every frame.
 */

export interface DecodedFrame {
  data: Buffer;
  width: number;
  height: number;
}

export async function decodePngToRgb24(pngBuf: Buffer): Promise<DecodedFrame> {
  const { data, info } = await sharp(pngBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
