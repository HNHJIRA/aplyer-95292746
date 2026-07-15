// Minimal AWS SigV4 S3 PUT uploader (no SDK, Worker-compatible).
import { createHash, createHmac } from "crypto";

function hex(buf: Buffer | string) {
  return Buffer.isBuffer(buf) ? buf.toString("hex") : Buffer.from(buf).toString("hex");
}
function sha256Hex(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data).digest();
}

export interface S3PutParams {
  bucket: string;
  region: string;
  key: string;
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export async function s3PutObject(p: S3PutParams): Promise<{ url: string; etag: string | null }> {
  const host = `${p.bucket}.s3.${p.region}.amazonaws.com`;
  const url = `https://${host}/${p.key.split("/").map(encodeURIComponent).join("/")}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(p.body);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "content-type": p.contentType || "application/octet-stream",
  };
  if (p.sessionToken) headers["x-amz-security-token"] = p.sessionToken;
  for (const [k, v] of Object.entries(p.metadata || {})) {
    headers[`x-amz-meta-${k.toLowerCase()}`] = v;
  }

  const signedKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = signedKeys.join(";");
  const canonicalUri = "/" + p.key.split("/").map(encodeURIComponent).join("/");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${p.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + p.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, p.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hex(hmac(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, Authorization: authorization },
    body: p.body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`S3 PUT failed [${res.status}]: ${txt.slice(0, 500)}`);
  }
  return { url, etag: res.headers.get("etag") };
}
