import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(private readonly configService: ConfigService) {
    const region = configService.get<string>('AWS_REGION') ?? 'us-east-1';
    this.bucket = configService.get<string>('S3_BUCKET') ?? '';
    this.ttl = parseInt(configService.get<string>('S3_SIGNED_URL_TTL') ?? '604800', 10);

    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
      },
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresIn ?? this.ttl });
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const t0 = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch {
      return { ok: false, latencyMs: Date.now() - t0 };
    }
  }
}
