// Media processing, client-side compression, magic byte validation, and canvas re-encoding

export type MediaType = "image" | "video" | "voice";

export interface ValidatedMedia {
  file: Blob | File;
  type: MediaType;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationSeconds?: number;
  thumbnailBlob?: Blob;
  previewUrl: string;
}

// Byte signature (magic bytes) validation to prevent extension spoofing (e.g. fake .exe as .jpg)
export async function detectTrueMimeType(file: Blob): Promise<string | null> {
  const headerSlice = file.slice ? file.slice(0, 32) : file;
  let buffer: ArrayBuffer;
  if (typeof headerSlice.arrayBuffer === "function") {
    buffer = await headerSlice.arrayBuffer();
  } else if (typeof file.arrayBuffer === "function") {
    buffer = (await file.arrayBuffer()).slice(0, 32);
  } else {
    buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(headerSlice);
    });
  }
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: GIF87a or GIF89a (47 49 46 38 37 61 or 47 49 46 38 39 61)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }

  // WEBP or WAV (RIFF container): 52 49 46 46 ....
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes.length >= 12) {
      // WEBP: bytes 8..11 === "WEBP" (57 45 42 50)
      if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return "image/webp";
      }
      // WAV: bytes 8..11 === "WAVE" (57 41 56 45)
      if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
        return "audio/wav";
      }
    }
  }

  // WEBM / Matroska (EBML header): 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // Both webm video and webm audio share EBML header; check browser declared type or default to webm
    return file.type.startsWith("audio/") ? "audio/webm" : "video/webm";
  }

  // MP4 / M4A / QuickTime: bytes 4..7 === "ftyp" (66 74 79 70)
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return file.type.startsWith("audio/") ? "audio/mp4" : "video/mp4";
  }

  // OGG: 4F 67 67 53 ("OggS")
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return "audio/ogg";
  }

  // MP3: ID3 header (49 44 33) or sync word (FF FB / FF F3 / FF F2)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }

  return null;
}

// Compress and re-encode image through canvas to strip EXIF, GPS and embedded payloads
export async function processAndCompressImage(file: File): Promise<ValidatedMedia> {
  const originalSize = file.size;
  if (originalSize > 15 * 1024 * 1024) {
    throw new Error("Image must be under 15MB before compression");
  }

  const detectedMime = await detectTrueMimeType(file);
  if (!detectedMime || !detectedMime.startsWith("image/")) {
    throw new Error("Invalid image format or corrupted file signature");
  }

  // Animated GIF preservation: if it's already GIF under 5MB, keep bytes or validate
  if (detectedMime === "image/gif") {
    if (originalSize > 5 * 1024 * 1024) {
      throw new Error("GIF images must be under 5MB");
    }
    return {
      file,
      type: "image",
      mimeType: "image/gif",
      extension: "gif",
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const MAX_DIM = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to initialize canvas context"));
          return;
        }

        // Draw image into canvas: this strips all EXIF metadata, GPS, and custom chunks
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas to WebP or JPEG blob at 0.8 quality
        const outputMime = "image/jpeg";
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Image compression failed"));
              return;
            }
            if (blob.size > 5 * 1024 * 1024) {
              reject(new Error("Compressed image exceeds 5MB limit"));
              return;
            }

            resolve({
              file: blob,
              type: "image",
              mimeType: outputMime,
              extension: "jpg",
              sizeBytes: blob.size,
              previewUrl: URL.createObjectURL(blob),
            });
          },
          outputMime,
          0.82,
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Could not re-encode image"));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for processing"));
    };

    img.src = objectUrl;
  });
}

// Validate video file, extract duration and generate client-side thumbnail
export async function processVideo(file: File): Promise<ValidatedMedia> {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("Video size must be 25MB or less");
  }

  const detectedMime = await detectTrueMimeType(file);
  if (!detectedMime || !["video/mp4", "video/webm"].includes(detectedMime)) {
    throw new Error("Only MP4 and WebM videos are supported");
  }

  const extension = detectedMime === "video/webm" ? "webm" : "mp4";
  const videoUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration) || 0;

      // Seek slightly into the video for thumbnail capture
      video.currentTime = Math.min(1, duration / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = Math.min(640, video.videoWidth || 640);
        const h = Math.round((w * (video.videoHeight || 360)) / (video.videoWidth || 640));
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          canvas.toBlob(
            (thumbnailBlob) => {
              resolve({
                file,
                type: "video",
                mimeType: detectedMime,
                extension,
                sizeBytes: file.size,
                durationSeconds: Math.round(video.duration) || 0,
                thumbnailBlob: thumbnailBlob || undefined,
                previewUrl: videoUrl,
              });
            },
            "image/jpeg",
            0.75,
          );
        } else {
          resolve({
            file,
            type: "video",
            mimeType: detectedMime,
            extension,
            sizeBytes: file.size,
            durationSeconds: Math.round(video.duration) || 0,
            previewUrl: videoUrl,
          });
        }
      } catch {
        resolve({
          file,
          type: "video",
          mimeType: detectedMime,
          extension,
          sizeBytes: file.size,
          durationSeconds: Math.round(video.duration) || 0,
          previewUrl: videoUrl,
        });
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      reject(new Error("Could not decode video file"));
    };

    video.src = videoUrl;
  });
}

// Process voice audio blob recorded via MediaRecorder
export async function processVoiceNote(
  blob: Blob,
  durationSeconds: number,
): Promise<ValidatedMedia> {
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error("Voice note must be under 10MB");
  }

  let mimeType = blob.type || "audio/webm";
  let extension = "webm";
  if (mimeType.includes("mp4") || mimeType.includes("aac")) {
    mimeType = "audio/mp4";
    extension = "mp4";
  } else if (mimeType.includes("ogg")) {
    mimeType = "audio/ogg";
    extension = "ogg";
  } else if (mimeType.includes("wav")) {
    mimeType = "audio/wav";
    extension = "wav";
  }

  return {
    file: blob,
    type: "voice",
    mimeType,
    extension,
    sizeBytes: blob.size,
    durationSeconds: Math.min(180, Math.max(1, Math.round(durationSeconds))),
    previewUrl: URL.createObjectURL(blob),
  };
}

// Format duration helper (e.g. 0:45, 2:15)
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
