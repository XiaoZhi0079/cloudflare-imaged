function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKeyPath(key) {
  return key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}

function formatAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function getDateStamp(amzDate) {
  return amzDate.slice(0, 8);
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret) {
  const bytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  return await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacBytes(secret, message) {
  const key = await importHmacKey(secret);
  const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return new Uint8Array(signature);
}

async function hmacHex(secret, message) {
  const signature = await hmacBytes(secret, message);
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildCanonicalQueryString(parameters) {
  return [...parameters.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

export function resolveR2DirectUploadConfig(env) {
  const accountId = String(env.R2_ACCOUNT_ID ?? "").trim();
  const bucketName = String(env.R2_BUCKET_NAME ?? "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY ?? "").trim();

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    return {
      error: "R2 直传未完成配置，请补齐 R2_ACCOUNT_ID、R2_BUCKET_NAME、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY。",
    };
  }

  return {
    accountId,
    bucketName,
    accessKeyId,
    secretAccessKey,
  };
}

export async function createPresignedPutUrl({
  accountId,
  bucketName,
  accessKeyId,
  secretAccessKey,
  key,
  contentType,
  expiresIn = 900,
  now = new Date(),
}) {
  const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`;
  const pathname = `/${encodeKeyPath(key)}`;
  const algorithm = "AWS4-HMAC-SHA256";
  const amzDate = formatAmzDate(now);
  const dateStamp = getDateStamp(amzDate);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const signedHeaders = "content-type;host";
  const query = new Map([
    ["X-Amz-Algorithm", algorithm],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]);
  const canonicalQuery = buildCanonicalQueryString(query);
  const canonicalRequest = [
    "PUT",
    pathname,
    canonicalQuery,
    `content-type:${contentType}`,
    `host:${host}`,
    "",
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await hmacBytes(
    await hmacBytes(
      await hmacBytes(
        await hmacBytes(`AWS4${secretAccessKey}`, dateStamp),
        "auto",
      ),
      "s3",
    ),
    "aws4_request",
  );
  const signature = await hmacHex(signingKey, stringToSign);

  return `https://${host}${pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
