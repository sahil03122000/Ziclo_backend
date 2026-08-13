import { BadRequestException, Controller, Logger, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

import { cloudinary } from './cloudinary.config';

const LOCAL_IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const LOCAL_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const ICON_MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ICON_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

// Uploaded directly to Cloudinary — no file is ever written to local/Railway disk.
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req: any) => {
    const rawType = (req.query?.type as string) || 'image';
    const safeType = rawType.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'image';
    return {
      folder: 'ziclo/images',
      public_id: `${safeType}-${Date.now()}`,
      resource_type: 'image',
    };
  },
});

const iconStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: 'ziclo/icons',
    public_id: `icon-${Date.now()}`,
    resource_type: 'image',
  }),
});

@ApiTags('Uploads')
@Controller('uploads')
export class ImageUploadController {
  private readonly logger = new Logger(ImageUploadController.name);

  @Post('image')
  @ApiOperation({
    summary: 'Upload an image to Cloudinary — no auth required',
    description:
      'Accepts JPG/JPEG/PNG/WebP, max 5 MB. ' +
      'Pass `?type=manager` (or worker | customer | office | service | admin) to control the public_id prefix. ' +
      'Returns a Cloudinary secure_url that can be stored as a `profileImage` field on any entity.',
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
    description: 'public_id prefix (manager | worker | customer | office | service | admin). Defaults to "image".',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage,
      limits: { fileSize: LOCAL_IMAGE_MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (LOCAL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPG, JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded or file type is not allowed');

    this.logger.log(`Image uploaded to Cloudinary: ${file.filename} (${file.path})`);

    // Root cause of "Upload succeeded but no image URL was returned" (Manager/Worker Aadhaar
    // upload, which calls this same endpoint with type=manager|worker): every other endpoint in
    // this API returns {success, data: {...}} — ResponseInterceptor only wraps bare values, and
    // passes an object through unchanged once it already has a top-level `success` key (see
    // src/common/interceptors/response.interceptor.ts). This handler returned `url` at the top
    // level instead of inside `data`, so callers reading the standard `response.data.data.url`
    // shape (every other upload/mutation endpoint) got undefined. Nesting under `data` here
    // matches that contract; `url` remains the field name.
    return {
      success: true,
      data: {
        url: file.path,
        filename: file.filename,
        path: file.path,
      },
    };
  }

  @Post('icon')
  @ApiOperation({
    summary: 'Upload a reusable icon (Service Type / Package / Property) to Cloudinary — no auth required',
    description:
      'Accepts PNG/JPG/JPEG/WebP/SVG, max 2 MB. Returns a Cloudinary secure_url to store as iconUrl on a ' +
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
      storage: iconStorage,
      limits: { fileSize: ICON_MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ICON_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only PNG, JPG, JPEG, WebP, and SVG icons are allowed'), false);
        }
      },
    }),
  )
  uploadIcon(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded or file type is not allowed');

    this.logger.log(`Icon uploaded to Cloudinary: ${file.filename} (${file.path})`);

    return {
      success: true,
      url: file.path,
      filename: file.filename,
      path: file.path,
    };
  }
}
