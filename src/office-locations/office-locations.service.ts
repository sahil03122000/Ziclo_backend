import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction, ActivityModule, Prisma } from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfficeLocationDto } from './dto/create-office-location.dto';
import { OfficeLocationQueryDto } from './dto/office-location-query.dto';
import { UpdateOfficeLocationDto } from './dto/update-office-location.dto';

@Injectable()
export class OfficeLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private async assertNameAvailable(normalizedName: string, excludeId?: string): Promise<void> {
    const duplicate = await this.prisma.officeLocation.findFirst({
      where: {
        name: { equals: normalizedName, mode: 'insensitive' },
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('Office already exists.');
  }

  async create(dto: CreateOfficeLocationDto, actorId?: string, actorName = 'Admin') {
    const name = this.normalizeName(dto.name);
    await this.assertNameAvailable(name);

    let areaName = 'Not Assigned';

    if (dto.areaId) {
      const area = await this.prisma.area.findUnique({
        where: { id: dto.areaId },
        select: { id: true, name: true, isActive: true },
      });
      if (!area) throw new NotFoundException('Area not found');
      if (!area.isActive) throw new NotFoundException('Area is not active');
      areaName = area.name;
    }

    const location = await this.prisma.officeLocation.create({
      data: {
        name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radius: dto.radius,
        ...(dto.areaId && { area: { connect: { id: dto.areaId } } }),
      },
      include: { area: { select: { id: true, name: true, city: true, state: true } } },
    });

    this.activityLog.log({
      action: ActivityAction.OFFICE_CREATED,
      module: ActivityModule.OFFICE,
      description: `Office location "${location.name}" created`,
      actor: { id: actorId, name: actorName, role: 'ADMIN' },
      target: { id: location.id, type: 'OfficeLocation' },
      metadata: { name: location.name, area: areaName, areaId: dto.areaId ?? null },
    });

    return { success: true, message: 'Office location created successfully', data: location };
  }

  async findAll(query: OfficeLocationQueryDto) {
    const { page = 1, limit = 20, search, areaId, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OfficeLocationWhereInput = {};
    if (areaId) where.areaId = areaId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [locations, total] = await this.prisma.$transaction([
      this.prisma.officeLocation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { area: { select: { id: true, name: true, city: true, state: true } } },
      }),
      this.prisma.officeLocation.count({ where }),
    ]);

    return {
      success: true,
      data: { locations, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const location = await this.prisma.officeLocation.findUnique({
      where: { id },
      include: { area: { select: { id: true, name: true, city: true, state: true } } },
    });
    if (!location) throw new NotFoundException('Office location not found');
    return { success: true, data: location };
  }

  async getActive() {
    const locations = await this.prisma.officeLocation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { area: { select: { id: true, name: true, city: true, state: true } } },
    });
    return { success: true, data: locations };
  }

  async update(id: string, dto: UpdateOfficeLocationDto, actorId?: string, actorName = 'Admin') {
    // Read current state: needed for cascade check and existence validation
    const current = await this.prisma.officeLocation.findUnique({
      where: { id },
      select: { name: true, isActive: true, areaId: true },
    });
    if (!current) throw new NotFoundException('Office location not found');

    const { areaId, ...scalarFields } = dto;

    if (scalarFields.name !== undefined) {
      scalarFields.name = this.normalizeName(scalarFields.name);
      await this.assertNameAvailable(scalarFields.name, id);
    }

    // Build the area relation update only when areaId is explicitly present in the payload
    let areaRelation: Prisma.AreaUpdateOneWithoutOfficeLocationsNestedInput | undefined;

    if (areaId !== undefined) {
      if (areaId === null) {
        areaRelation = { disconnect: true };
      } else {
        const area = await this.prisma.area.findUnique({
          where: { id: areaId },
          select: { id: true, isActive: true },
        });
        if (!area) throw new NotFoundException('Area not found');
        if (!area.isActive) throw new NotFoundException('Area is not active');
        areaRelation = { connect: { id: areaId } };
      }
    }

    const isStatusChanging = scalarFields.isActive !== undefined && scalarFields.isActive !== current.isActive;
    let cascadeAreaId: string | null = null;
    let cascadeAreaName: string | null = null;
    let managerUserIds: string[] = [];
    let workerUserIds: string[] = [];

    const location = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.officeLocation.update({
        where: { id },
        data: {
          ...scalarFields,
          ...(areaRelation !== undefined && { area: areaRelation }),
        },
        include: { area: { select: { id: true, name: true, city: true, state: true } } },
      });

      // Cascade to the area linked to the office at the time of the status change
      if (isStatusChanging && current.areaId) {
        const newIsActive = scalarFields.isActive!;

        const linkedArea = await tx.area.update({
          where: { id: current.areaId },
          data: { isActive: newIsActive },
          select: { name: true },
        });
        cascadeAreaId = current.areaId;
        cascadeAreaName = linkedArea.name;

        const cascade = await this.cascadeAreaStatusInTx(tx, current.areaId, newIsActive);
        managerUserIds = cascade.managerUserIds;
        workerUserIds = cascade.workerUserIds;
      }

      return updated;
    });

    if (isStatusChanging) {
      const isActive = scalarFields.isActive!;
      this.activityLog.log({
        action: isActive ? ActivityAction.OFFICE_ACTIVATED : ActivityAction.OFFICE_DEACTIVATED,
        module: ActivityModule.OFFICE,
        description: `Office location "${location.name}" ${isActive ? 'activated' : 'deactivated'}`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        target: { id, type: 'OfficeLocation' },
        metadata: {
          cascadedAreaId: cascadeAreaId,
          cascadedAreaName: cascadeAreaName,
          cascadedManagers: managerUserIds.length,
          cascadedWorkers: workerUserIds.length,
        },
      });
      if (cascadeAreaId) {
        this.activityLog.log({
          action: isActive ? ActivityAction.AREA_ACTIVATED : ActivityAction.AREA_DEACTIVATED,
          module: ActivityModule.AREA,
          description: `Area "${cascadeAreaName}" ${isActive ? 'activated' : 'deactivated'} via Office cascade`,
          actor: { id: actorId, name: actorName, role: 'ADMIN' },
          target: { id: cascadeAreaId, type: 'Area' },
          metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, officeName: location.name },
        });
        if (managerUserIds.length > 0) {
          this.activityLog.log({
            action: isActive ? ActivityAction.MANAGER_ACTIVATED : ActivityAction.MANAGER_DEACTIVATED,
            module: ActivityModule.MANAGER,
            description: `${managerUserIds.length} manager(s) ${isActive ? 'activated' : 'deactivated'} via Office cascade`,
            actor: { id: actorId, name: actorName, role: 'ADMIN' },
            metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, count: managerUserIds.length },
          });
        }
        if (workerUserIds.length > 0) {
          this.activityLog.log({
            action: isActive ? ActivityAction.WORKER_ACTIVATED : ActivityAction.WORKER_DEACTIVATED,
            module: ActivityModule.WORKER,
            description: `${workerUserIds.length} worker(s) ${isActive ? 'activated' : 'deactivated'} via Office cascade`,
            actor: { id: actorId, name: actorName, role: 'ADMIN' },
            metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, count: workerUserIds.length },
          });
        }
      }
    } else {
      this.activityLog.log({
        action: ActivityAction.OFFICE_UPDATED,
        module: ActivityModule.OFFICE,
        description: `Office location "${location.name}" updated`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        target: { id, type: 'OfficeLocation' },
      });
    }

    return { success: true, message: 'Office location updated successfully', data: location };
  }

  async remove(id: string) {
    const current = await this.prisma.officeLocation.findUnique({
      where: { id },
      select: { name: true, isActive: true, areaId: true },
    });
    if (!current) throw new NotFoundException('Office location not found');

    let cascadeAreaId: string | null = null;
    let cascadeAreaName: string | null = null;
    let managerUserIds: string[] = [];
    let workerUserIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.officeLocation.update({ where: { id }, data: { isActive: false } });

      // Only cascade if the office was previously active
      if (current.isActive && current.areaId) {
        const linkedArea = await tx.area.update({
          where: { id: current.areaId },
          data: { isActive: false },
          select: { name: true },
        });
        cascadeAreaId = current.areaId;
        cascadeAreaName = linkedArea.name;

        const cascade = await this.cascadeAreaStatusInTx(tx, current.areaId, false);
        managerUserIds = cascade.managerUserIds;
        workerUserIds = cascade.workerUserIds;
      }
    });

    this.activityLog.log({
      action: ActivityAction.OFFICE_DEACTIVATED,
      module: ActivityModule.OFFICE,
      description: `Office location "${current.name}" deactivated`,
      actor: { id: undefined, name: 'Admin', role: 'ADMIN' },
      target: { id, type: 'OfficeLocation' },
      metadata: { cascadedAreaId: cascadeAreaId, cascadedAreaName: cascadeAreaName, cascadedManagers: managerUserIds.length, cascadedWorkers: workerUserIds.length },
    });

    if (cascadeAreaId) {
      this.activityLog.log({
        action: ActivityAction.AREA_DEACTIVATED,
        module: ActivityModule.AREA,
        description: `Area "${cascadeAreaName}" deactivated via Office cascade`,
        actor: { id: undefined, name: 'Admin', role: 'ADMIN' },
        target: { id: cascadeAreaId, type: 'Area' },
        metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, officeName: current.name },
      });
      if (managerUserIds.length > 0) {
        this.activityLog.log({
          action: ActivityAction.MANAGER_DEACTIVATED,
          module: ActivityModule.MANAGER,
          description: `${managerUserIds.length} manager(s) deactivated via Office cascade`,
          actor: { id: undefined, name: 'Admin', role: 'ADMIN' },
          metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, count: managerUserIds.length },
        });
      }
      if (workerUserIds.length > 0) {
        this.activityLog.log({
          action: ActivityAction.WORKER_DEACTIVATED,
          module: ActivityModule.WORKER,
          description: `${workerUserIds.length} worker(s) deactivated via Office cascade`,
          actor: { id: undefined, name: 'Admin', role: 'ADMIN' },
          metadata: { triggeredBy: 'OFFICE_STATUS_CHANGE', officeId: id, count: workerUserIds.length },
        });
      }
    }

    return { success: true, message: 'Office location deactivated successfully' };
  }

  private async cascadeAreaStatusInTx(
    tx: Prisma.TransactionClient,
    areaId: string,
    isActive: boolean,
  ): Promise<{ managerUserIds: string[]; workerUserIds: string[] }> {
    const managers = await tx.managerProfile.findMany({
      where: { areas: { some: { areaId } } },
      select: { userId: true },
    });
    const managerUserIds = managers.map((m) => m.userId);

    if (managerUserIds.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: managerUserIds } },
        data: { isActive },
      });
    }

    const workers = await tx.workerProfile.findMany({
      where: { areaId },
      select: { userId: true },
    });
    const workerUserIds = workers.map((w) => w.userId);

    if (workerUserIds.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: workerUserIds } },
        data: { isActive },
      });
    }

    return { managerUserIds, workerUserIds };
  }
}
