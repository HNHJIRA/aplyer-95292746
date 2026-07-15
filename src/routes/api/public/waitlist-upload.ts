import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import { s3PutObject } from "@/lib/s3.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_FILES = 5;

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180) || "file";
}
function slugEmail(email: string) {
  return email.toLowerCase().replace(/[^\w.\-@]+/g, "_");
}

export const Route = createFileRoute("/api/public/waitlist-upload")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const bucket = process.env.AWS_S3_BUCKET;
          const region = process.env.AWS_REGION || "us-east-1";
          const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
          const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
          if (!bucket || !accessKeyId || !secretAccessKey) {
            console.error("[waitlist-upload] missing AWS env vars");
            return jsonWithCors({ error: "Upload service not configured." }, 500);
          }

          const ct = request.headers.get("content-type") || "";
          if (!ct.includes("multipart/form-data")) {
            return jsonWithCors(
              { error: "Content-Type must be multipart/form-data." },
              400,
            );
          }

          const form = await request.formData();
          const email = String(form.get("email") || "").trim().toLowerCase();
          const name = String(form.get("name") || form.get("firstName") || "").trim().slice(0, 120);
          const source = String(form.get("source") || "").trim().slice(0, 64);

          if (!EMAIL_RE.test(email) || email.length > 254) {
            return jsonWithCors({ error: "Please enter a valid email address." }, 400);
          }

          const files: Array<{ field: string; file: File }> = [];
          for (const [key, value] of form.entries()) {
            if (value instanceof File && value.size > 0) {
              if (key === "email" || key === "name" || key === "firstName" || key === "source") continue;
              files.push({ field: key, file: value });
            }
          }

          if (files.length === 0) {
            return jsonWithCors({ error: "No files uploaded." }, 400);
          }
          if (files.length > MAX_FILES) {
            return jsonWithCors({ error: `Too many files (max ${MAX_FILES}).` }, 400);
          }
          for (const f of files) {
            if (f.size > MAX_FILE_BYTES) {
              return jsonWithCors(
                { error: `File "${f.name}" exceeds 15 MB limit.` },
                400,
              );
            }
          }

          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const folder = `waitlist/${slugEmail(email)}/${ts}`;

          const uploaded: Array<{
            field: string;
            fileName: string;
            size: number;
            contentType: string;
            key: string;
            url: string;
            etag: string | null;
          }> = [];

          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const buf = Buffer.from(await f.arrayBuffer());
            const key = `${folder}/${String(i + 1).padStart(2, "0")}-${safeName(f.name)}`;
            const result = await s3PutObject({
              bucket,
              region,
              key,
              body: buf,
              contentType: f.type || "application/octet-stream",
              metadata: {
                email,
                name: encodeURIComponent(name),
                source: source || "",
                "original-name": encodeURIComponent(f.name),
              },
              accessKeyId,
              secretAccessKey,
            });
            uploaded.push({
              field: "file",
              fileName: f.name,
              size: f.size,
              contentType: f.type || "application/octet-stream",
              key,
              url: result.url,
              etag: result.etag,
            });
          }

          // Best-effort: write a small manifest.json alongside the uploads
          try {
            const manifest = {
              email,
              name,
              source: source || null,
              uploadedAt: new Date().toISOString(),
              files: uploaded,
            };
            await s3PutObject({
              bucket,
              region,
              key: `${folder}/manifest.json`,
              body: Buffer.from(JSON.stringify(manifest, null, 2)),
              contentType: "application/json",
              accessKeyId,
              secretAccessKey,
            });
          } catch (e) {
            console.warn("[waitlist-upload] manifest write failed", e);
          }

          return jsonWithCors({
            ok: true,
            folder,
            count: uploaded.length,
            files: uploaded.map((u) => ({
              fileName: u.fileName,
              size: u.size,
              key: u.key,
              url: u.url,
            })),
          });
        } catch (err) {
          console.error("[waitlist-upload]", err);
          const msg = err instanceof Error ? err.message : "Upload failed.";
          return jsonWithCors({ error: msg }, 500);
        }
      },
    },
  },
});
