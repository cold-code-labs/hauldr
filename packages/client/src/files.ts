import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FilesClient, StorageConfig, UploadInput } from "./types";

/** Join a logical group and a key into one object key (no leading/dup slashes). */
function objectKey(group: string, key: string): string {
  return [group, key]
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/**
 * S3-backed files namespace. The S3 *bucket* is the project (one per project);
 * the `group` argument is a logical prefix within it (e.g. "avatars"). Holds only
 * the bytes — the truth about who may touch a file is a metadata row in the
 * project's database, guarded by the same RLS as the rest of the data. Garage is
 * the default backend, but this speaks plain S3, so any S3 store is a drop-in.
 */
export class S3FilesClient implements FilesClient {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(cfg: StorageConfig) {
    this.bucket = cfg.bucket;
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region ?? "garage",
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // Garage (and most self-hosted stores) need path-style addressing.
      forcePathStyle: cfg.forcePathStyle ?? true,
    });
  }

  async upload(group: string, file: UploadInput): Promise<{ path: string }> {
    const path = objectKey(group, file.key);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: file.body,
        ContentType: file.contentType,
      }),
    );
    return { path };
  }

  async getSignedUrl(
    group: string,
    key: string,
    opts?: { expiresIn?: number },
  ): Promise<{ url: string }> {
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey(group, key) }),
      { expiresIn: opts?.expiresIn ?? 3600 },
    );
    return { url };
  }

  async remove(group: string, key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey(group, key) }),
    );
  }
}
