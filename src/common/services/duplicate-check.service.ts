import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

interface EnsureUniqueParams {
  email?: string;
  phone?: string;
  aadhaarNumber?: string | null;
  panNumber?: string | null;
  // User.id of the record being updated — excluded from all lookups so a record doesn't
  // conflict with itself. Omit for create.
  excludeUserId?: string;
}

// Shared global-duplicate validation for User/Manager/Worker create & update APIs. Email and
// phone are unique across the whole User table (Admin/Manager/Worker/Customer all share it);
// Aadhaar/PAN are unique across WorkerProfile, ignoring nulls. Checked in a fixed priority
// order — email, then phone, then Aadhaar, then PAN — stopping at the first duplicate found.
@Injectable()
export class DuplicateCheckService {
  private readonly logger = new Logger(DuplicateCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureUnique(params: EnsureUniqueParams): Promise<void> {
    const { email, phone, aadhaarNumber, panNumber, excludeUserId } = params;

    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      const existing = await this.prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          ...(excludeUserId && { id: { not: excludeUserId } }),
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(`Duplicate Email: ${normalizedEmail}`);
        throw new BadRequestException('Email already registered.');
      }
    }

    if (phone) {
      const existing = await this.prisma.user.findFirst({
        where: {
          phone,
          ...(excludeUserId && { id: { not: excludeUserId } }),
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(`Duplicate Phone: ${phone}`);
        throw new BadRequestException('Phone number already registered.');
      }
    }

    if (aadhaarNumber) {
      const existing = await this.prisma.workerProfile.findFirst({
        where: {
          aadhaarNumber,
          ...(excludeUserId && { userId: { not: excludeUserId } }),
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(`Duplicate Aadhaar: ${aadhaarNumber}`);
        throw new BadRequestException('Aadhaar number already registered.');
      }
    }

    if (panNumber) {
      const normalizedPan = panNumber.toUpperCase().trim();
      const existing = await this.prisma.workerProfile.findFirst({
        where: {
          panNumber: normalizedPan,
          ...(excludeUserId && { userId: { not: excludeUserId } }),
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(`Duplicate PAN: ${normalizedPan}`);
        throw new BadRequestException('PAN number already registered.');
      }
    }
  }
}
