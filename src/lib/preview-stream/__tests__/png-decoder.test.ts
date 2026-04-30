import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodePngToRgb24 } from "../png-decoder";

describe("decodePngToRgb24", () => {
  it("returns RGB24 bytes (3 channels) matching the source dimensions", async () => {
    // Build a 16×8 solid-red PNG with sharp itself so the test has no
    // committed binary fixture and works the same on every platform.
    const png = await sharp({
      create: { width: 16, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const decoded = await decodePngToRgb24(png);

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(8);
    expect(decoded.data.length).toBe(16 * 8 * 3);
    // Every pixel is opaque red — first three channels of every triple
    // must be (255, 0, 0). Sample a few to confirm channel order.
    expect([decoded.data[0], decoded.data[1], decoded.data[2]]).toEqual([255, 0, 0]);
    const lastPx = decoded.data.length - 3;
    expect([decoded.data[lastPx], decoded.data[lastPx + 1], decoded.data[lastPx + 2]]).toEqual([
      255, 0, 0,
    ]);
  });

  it("strips alpha so RGBA inputs decode to packed RGB24", async () => {
    const rgba = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 0.5 } },
    })
      .png()
      .toBuffer();

    const decoded = await decodePngToRgb24(rgba);

    expect(decoded.data.length).toBe(4 * 4 * 3);
  });
});
