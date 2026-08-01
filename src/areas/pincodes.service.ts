import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AssignManagerPincodesDto } from './dto/assign-manager-pincodes.dto';
import { AssignWorkerPincodeDto } from './dto/assign-worker-pincode.dto';
import { CreatePincodeDto } from './dto/create-pincode.dto';
import { PincodeQueryDto } from './dto/pincode-query.dto';
import { UpdatePincodeDto } from './dto/update-pincode.dto';

@Injectable()
export class PincodesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePincodeDto) {
    const existing = await this.prisma.pincode.findUnique({ where: { pincode: dto.pincode }, select: { id: true } });
    if (existing) throw new ConflictException(`Pincode ${dto.pincode} already exists`);

    const pincode = await this.prisma.pincode.create({ data: dto });
    return { success: true, message: 'Pincode created successfully', data: pincode };
  }

  async findAll(query: PincodeQueryDto) {
    const { page = 1, limit = 20, search, city, state, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PincodeWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = { contains: state, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { pincode: { contains: search } },
        { city: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [pincodes, total] = await this.prisma.$transaction([
      this.prisma.pincode.findMany({
        where,
        skip,
        take: limit,
        orderBy: { pincode: 'asc' },
        include: { _count: { select: { workerProfiles: true, tasks: true } } },
      }),
      this.prisma.pincode.count({ where }),
    ]);

    return { success: true, data: { pincodes, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } } };
  }

  async lookupByCode(pincode: string) {
    const record = await this.prisma.pincode.findUnique({
      where:  { pincode },
      select: { pincode: true, officeName: true, city: true, district: true, state: true, country: true },
    });
    if (!record) throw new NotFoundException(`PIN Code ${pincode} not found`);

    return {
      success: true,
      message: 'PIN Code found',
      data: {
        pincode:    record.pincode,
        officeName: record.officeName ?? null,
        city:       record.city,
        district:   record.district ?? record.city,
        state:      record.state,
        country:    record.country,
      },
    };
  }

  async findOne(id: string) {
    const pincode = await this.prisma.pincode.findUnique({
      where: { id },
      include: { _count: { select: { workerProfiles: true, tasks: true, managerPincodes: true } } },
    });
    if (!pincode) throw new NotFoundException('Pincode not found');
    return { success: true, data: pincode };
  }

  async update(id: string, dto: UpdatePincodeDto) {
    await this.requirePincode(id);

    if (dto.pincode) {
      const conflict = await this.prisma.pincode.findFirst({
        where: { pincode: dto.pincode, NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException(`Pincode ${dto.pincode} already in use`);
    }

    const updated = await this.prisma.pincode.update({ where: { id }, data: dto });
    return { success: true, message: 'Pincode updated successfully', data: updated };
  }

  async remove(id: string) {
    await this.requirePincode(id);
    await this.prisma.pincode.update({ where: { id }, data: { isActive: false } });
    return { success: true, message: 'Pincode deactivated successfully' };
  }

  async getMyPincodes(managerId: string) {
    const managerProfile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerId },
      include: { pincodes: { include: { pincode: true } } },
    });
    if (!managerProfile) throw new NotFoundException('Manager profile not found');

    const pincodes = managerProfile.pincodes.map((mp) => mp.pincode);
    return { success: true, data: pincodes };
  }

  async assignToManager(managerId: string, dto: AssignManagerPincodesDto) {
    const managerProfile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerId },
      select: { id: true },
    });
    if (!managerProfile) throw new NotFoundException('Manager profile not found');

    // Validate all pincode IDs exist
    const pincodes = await this.prisma.pincode.findMany({
      where: { id: { in: dto.pincodeIds }, isActive: true },
      select: { id: true },
    });
    if (pincodes.length !== dto.pincodeIds.length) {
      throw new BadRequestException('One or more pincode IDs are invalid or inactive');
    }

    // Replace all existing assignments atomically
    await this.prisma.$transaction([
      this.prisma.managerPincode.deleteMany({ where: { managerId: managerProfile.id } }),
      this.prisma.managerPincode.createMany({
        data: dto.pincodeIds.map((pincodeId) => ({ managerId: managerProfile.id, pincodeId })),
      }),
    ]);

    const updated = await this.prisma.managerProfile.findUnique({
      where: { id: managerProfile.id },
      include: { pincodes: { include: { pincode: true } } },
    });

    return { success: true, message: 'Pincodes assigned to manager successfully', data: updated?.pincodes.map((mp) => mp.pincode) };
  }

  async assignToWorker(workerId: string, dto: AssignWorkerPincodeDto) {
    const workerProfile = await this.prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true },
    });
    if (!workerProfile) throw new NotFoundException('Worker profile not found');

    const pincode = await this.prisma.pincode.findUnique({
      where: { id: dto.pincodeId },
      select: { id: true, isActive: true },
    });
    if (!pincode) throw new NotFoundException('Pincode not found');
    if (!pincode.isActive) throw new BadRequestException('Pincode is not active');

    const updated = await this.prisma.workerProfile.update({
      where: { id: workerProfile.id },
      data: { pincodeId: dto.pincodeId },
      include: { pincode: true },
    });

    return { success: true, message: 'Pincode assigned to worker successfully', data: updated };
  }

  private async requirePincode(id: string) {
    const pincode = await this.prisma.pincode.findUnique({ where: { id }, select: { id: true } });
    if (!pincode) throw new NotFoundException('Pincode not found');
    return pincode;
  }
}
