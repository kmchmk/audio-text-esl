import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "./env";

let client: S3Client | undefined;

function s3() {
  const c = env().s3;
  return (client ??= new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  }));
}

export async function putObject(key: string, body: Buffer, contentType = "audio/mpeg") {
  await s3().send(new PutObjectCommand({ Bucket: env().s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const r = await s3().send(new GetObjectCommand({ Bucket: env().s3.bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** Short-lived download URL. `filename` sets Content-Disposition for downloads. */
export async function signedUrl(key: string, filename?: string, expiresIn = 3600) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env().s3.bucket,
      Key: key,
      ResponseContentDisposition: filename ? `attachment; filename="${filename.replace(/"/g, "")}"` : undefined,
    }),
    { expiresIn },
  );
}
