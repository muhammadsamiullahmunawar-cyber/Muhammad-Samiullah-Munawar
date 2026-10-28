import { describe, expect, it } from "vitest";
import { detectTrueMimeType, formatDuration } from "./media-utils";

describe("media-utils", () => {
  describe("formatDuration", () => {
    it("formats seconds into mm:ss correctly", () => {
      expect(formatDuration(0)).toBe("0:00");
      expect(formatDuration(9)).toBe("0:09");
      expect(formatDuration(65)).toBe("1:05");
      expect(formatDuration(180)).toBe("3:00");
    });
  });

  describe("detectTrueMimeType magic byte validation", () => {
    it("identifies authentic JPEG from magic bytes", async () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const blob = new Blob([jpegBytes], { type: "image/jpeg" });
      const detected = await detectTrueMimeType(blob);
      expect(detected).toBe("image/jpeg");
    });

    it("identifies authentic PNG from magic bytes", async () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const blob = new Blob([pngBytes], { type: "image/png" });
      const detected = await detectTrueMimeType(blob);
      expect(detected).toBe("image/png");
    });

    it("identifies authentic GIF89a from magic bytes", async () => {
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const blob = new Blob([gifBytes], { type: "image/gif" });
      const detected = await detectTrueMimeType(blob);
      expect(detected).toBe("image/gif");
    });

    it("identifies authentic WebM / Matroska EBML from magic bytes", async () => {
      const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
      const blob = new Blob([webmBytes], { type: "video/webm" });
      const detected = await detectTrueMimeType(blob);
      expect(detected).toBe("video/webm");
    });

    it("rejects fake .exe file renamed to .jpg (MZ Windows executable header)", async () => {
      // Windows executable (PE/MZ header): 0x4D, 0x5A ("MZ")
      const fakeExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      // Spoofed browser MIME type
      const fakeFile = new Blob([fakeExeBytes], { type: "image/jpeg" });
      const detected = await detectTrueMimeType(fakeFile);
      // Must be rejected (null) because header is MZ, not JPEG
      expect(detected).toBeNull();
    });

    it("rejects script/html files disguised as media", async () => {
      const htmlBytes = new TextEncoder().encode("<script>alert(1)</script>");
      const fakeFile = new Blob([htmlBytes], { type: "image/png" });
      const detected = await detectTrueMimeType(fakeFile);
      expect(detected).toBeNull();
    });
  });
});
