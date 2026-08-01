import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';

import { S3Service } from './s3.service';

export const VALID_UPLOAD_FOLDERS = ['attendance', 'tasks', 'profile', 'support', 'invoices'] as const;
export type UploadFolder = (typeof VALID_UPLOAD_FOLDERS)[number];

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class UploadsService {
  constructor(private readonly s3: S3Service) {}

  async processUpload(file: Express.Multer.File, folder: UploadFolder) {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `${randomUUID()}${ext}`;
    const key = `${folder}/${filename}`;

    await this.s3.upload(key, file.buffer, file.mimetype);
    const url = await this.s3.getSignedUrl(key);

    return {
      success: true,
      data: {
        url,
        key,
        filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      },
    };
  }

  validateFolder(folder: string): UploadFolder {
    if (!VALID_UPLOAD_FOLDERS.includes(folder as UploadFolder)) {
      throw new BadRequestException(
        `Invalid folder. Must be one of: ${VALID_UPLOAD_FOLDERS.join(', ')}`,
      );
    }
    return folder as UploadFolder;
  }

  async deleteFile(filename: string, folder: UploadFolder): Promise<void> {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new BadRequestException('Invalid filename');
    }
    const key = `${folder}/${filename}`;
    if (!(await this.s3.exists(key))) {
      throw new NotFoundException(`File '${filename}' not found in folder '${folder}'`);
    }
    await this.s3.delete(key);
  }
}
