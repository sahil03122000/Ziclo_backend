import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UploadsService,
  VALID_UPLOAD_FOLDERS,
} from './uploads.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard, RoleGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @ApiOperation({ summary: 'Upload an image (JPG/PNG/WebP, max 10 MB). Pass ?folder=tasks|attendance|profile|support|invoices' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPG, JPEG, PNG, and WebP images are allowed'), false);
        }
      },
      storage: memoryStorage(),
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') rawFolder?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded or file type is not allowed');
    const folder = this.uploadsService.validateFolder(rawFolder ?? 'tasks');
    return this.uploadsService.processUpload(file, folder);
  }

  @Roles(Role.ADMIN)
  @Delete(':filename')
  @ApiOperation({ summary: 'Delete an uploaded file by filename — ADMIN. Pass ?folder=tasks|attendance|profile|support|invoices' })
  @ApiQuery({ name: 'folder', enum: VALID_UPLOAD_FOLDERS, required: true })
  async deleteFile(
    @Param('filename') filename: string,
    @Query('folder') rawFolder: string,
  ) {
    const folder = this.uploadsService.validateFolder(rawFolder ?? 'tasks');
    await this.uploadsService.deleteFile(filename, folder);
    return { success: true, message: 'File deleted successfully' };
  }
}
