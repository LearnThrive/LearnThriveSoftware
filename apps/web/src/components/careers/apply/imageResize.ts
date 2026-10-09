import { careersConfig } from "@/lib/careers-config";

/**
 * Makes a large photograph or scan small enough to upload, in the browser, before anything is sent. A phone
 * photograph can be 5 to 10 MB, far over the 3 MB limit for one file; resized to at most 2200 pixels on its
 * longest side and saved as a JPEG it is a few hundred KB and still perfectly legible.
 *
 * Only JPEG and PNG files over the threshold are touched. A PNG becomes a JPEG (on white, so a transparent
 * background does not turn black), and its name changes to match. Anything that cannot be decoded, or that
 * would not get smaller, is returned unchanged and the normal size check then applies. Nothing leaves the
 * browser and nothing is stored.
 */
export async function shrinkImageIfLarge(file: File): Promise<File> {
  const isImage = file.type === "image/jpeg" || file.type === "image/png" || /\.(?:jpe?g|png)$/i.test(file.name);
  if (!isImage || file.size <= careersConfig.limits.imageResizeAboveBytes) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, careersConfig.limits.imageMaxEdgePx / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
