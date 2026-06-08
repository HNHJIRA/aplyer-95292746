const EXTENSION_ZIP_NAME = "aplyer-extension.zip";
const EXTENSION_B64_PATH = "/aplyer-extension.zip.b64";

function base64ToBlob(base64: string) {
  const clean = base64.replace(/\s/g, "");
  const binary = window.atob(clean);
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < binary.length; offset += 1024 * 256) {
    const slice = binary.slice(offset, offset + 1024 * 256);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }
    chunks.push(bytes);
  }

  const parts = chunks.map((chunk) =>
    chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
  );

  return new Blob(parts, { type: "application/zip" });
}

function saveBlob(blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = EXTENSION_ZIP_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function downloadExtension() {
  const res = await fetch(EXTENSION_B64_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const encodedZip = await res.text();
  saveBlob(base64ToBlob(encodedZip));
}