import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';

import { BadRequestException, Controller, InternalServerErrorException, Logger, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';

const LOCAL_IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const LOCAL_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const IMAGES_DIR = join(process.cwd(), 'uploads', 'images');

const ICON_MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ICON_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
const ICONS_DIR = join(process.cwd(), 'uploads', 'icons');

@ApiTags('Uploads')
@Controller('uploads')
export class ImageUploadController {
  private readonly logger = new Logger(ImageUploadController.name);

  constructor(private readonly configService: ConfigService) {}

  @Post('image')
  @ApiOperation({
    summary: 'Upload an image to local disk — no auth required',
    description:
      'Accepts JPG/JPEG/PNG/WebP, max 5 MB. ' +
      'Pass `?type=manager` (or worker | customer | office | service | admin) to control the filename prefix. ' +
      'Returns a public URL that can be stored as a `profileImage` field on any entity.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image file — JPG/JPEG/PNG/WebP, max 5 MB' },
      },
    },
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Filename prefix (manager | worker | customer | office | service | admin). Defaults to "image".',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOCAL_IMAGE_MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (LOCAL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPG, JPEG, PNG, and WebP images are allowed'), false);
        }
      },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(IMAGES_DIR, { recursive: true });
          cb(null, IMAGES_DIR);
        },
        filename: (req: any, file, cb) => {
          const rawType = (req.query?.type as string) || 'image';
          const safeType = rawType.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'image';
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
          const filename = `${safeType}-${Date.now()}-${randomBytes(3).toString('hex')}${ext}`;
          cb(null, filename);
        },
      }),
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded or file type is not allowed');

    const baseUrl = this.configService.get<string>('baseUrl');
    if (!baseUrl) {
      this.logger.warn('BASE_URL is not configured — cannot generate a public image URL. Set BASE_URL=http://<lan-ip>:3000 in .env');
      throw new InternalServerErrorException('BASE_URL is not configured. Set BASE_URL=http://<server-ip>:3000 in .env');
    }

    const path = `/uploads/images/${file.filename}`;
    const url = `${baseUrl}${path}`;
    return {
      success: true,
      url,
      filename: file.filename,
      path,
    };
  }

  @Post('icon')
  @ApiOperation({
    summary: 'Upload a reusable icon (Service Type / Package / Property) — no auth required',
    description:
      'Accepts PNG/JPG/JPEG/WebP/SVG, max 2 MB. Returns a public URL to store as iconUrl on a ' +
      'Service, PropertyType, or Package — iconUrl takes precedence over iconName when both are set.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Icon file — PNG/JPG/JPEG/WebP/SVG, max 2 MB' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ICON_MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ICON_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only PNG, JPG, JPEG, WebP, and SVG icons are allowed'), false);
        }
      },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(ICONS_DIR, { recursive: true });
          cb(null, ICONS_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.png';
          const filename = `icon-${Date.now()}-${randomBytes(3).toString('hex')}${ext}`;
          cb(null, filename);
        },
      }),
    }),
  )
  uploadIcon(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded or file type is not allowed');

    const baseUrl = this.configService.get<string>('baseUrl');
    if (!baseUrl) {
      this.logger.warn('BASE_URL is not configured — cannot generate a public icon URL. Set BASE_URL=http://<lan-ip>:3000 in .env');
      throw new InternalServerErrorException('BASE_URL is not configured. Set BASE_URL=http://<server-ip>:3000 in .env');
    }

    const url = `${baseUrl}/uploads/icons/${file.filename}`;
    return {
      success: true,
      message: 'Icon uploaded successfully',
      data: { url },
    };
  }
}
