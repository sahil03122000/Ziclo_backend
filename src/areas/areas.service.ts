import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, ActivityModule, Prisma } from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AreaQueryDto } from './dto/area-query.dto';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { UpdateAreaServicesDto } from './dto/update-area-services.dto';

@Injectable()
export class AreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(dto: CreateAreaDto, actorId?: string, actorName = 'Admin') {
    // Resolve location from the PIN Code table
    const pincodeRecord = await this.prisma.pincode.findUnique({
      where: { pincode: dto.pincode },
      select: { city: true, district: true, state: true, country: true },
    });
    if (!pincodeRecord) throw new NotFoundException(`PIN Code ${dto.pincode} not found`);

    // officeLocationId (legacy, singular) is converted to officeLocationIds: [officeLocationId]
    // when officeLocationIds isn't supplied — kept for backward compatibility.
    const officeLocationIds = this.resolveOfficeLocationIds(dto);
    if (!officeLocationIds || officeLocationIds.length === 0) {
      throw new BadRequestException(
        'At least one office location is required (officeLocationIds)',
      );
    }

    // Verify every office location exists
    const officeLocations = await this.prisma.officeLocation.findMany({
      where: { id: { in: officeLocationIds } },
      select: { id: true, name: true },
    });
    const foundOfficeIds = new Set(officeLocations.map((o) => o.id));
    const missingOfficeIds = officeLocationIds.filter(
      (oid) => !foundOfficeIds.has(oid),
    );
    if (missingOfficeIds.length > 0) {
      throw new NotFoundException(
        `Office location(s) not found: ${missingOfficeIds.join(', ')}`,
      );
    }

    // Duplicate check
    const existing = await this.prisma.area.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' }, pincode: dto.pincode },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Area with this name and PIN Code already exists');

    // Create area and associate office locations atomically.
    // Manager assignment is handled exclusively by the Manager Create/Update APIs — not here.
    const area = await this.prisma.$transaction(async (tx) => {
      const created = await tx.area.create({
        data: {
          name: dto.name,
          pincode: dto.pincode,
          city: pincodeRecord.city,
          district: pincodeRecord.district ?? pincodeRecord.city,
          state: pincodeRecord.state,
          country: pincodeRecord.country,
          isActive: dto.isActive,
        },
      });

      await tx.officeLocation.updateMany({
        where: { id: { in: officeLocationIds } },
        data: { areaId: created.id },
      });

      return created;
    });

    this.activityLog.log({
      action: ActivityAction.AREA_CREATED,
      module: ActivityModule.AREA,
      description: `Area "${area.name}" (${area.pincode}) created in ${area.city}, ${area.state}`,
      actor: { id: actorId, name: actorName, role: 'ADMIN' },
      target: { id: area.id, type: 'Area' },
      metadata: {
        pincode: area.pincode,
        city: area.city,
        district: area.district,
        state: area.state,
        offices: officeLocations.map((o) => o.name),
        officeLocationIds,
        isActive: area.isActive,
      },
    });

    return {
      success: true,
      message: 'Area created successfully',
      data: {
        id: area.id,
        name: area.name,
        pincode: area.pincode,
        city: area.city,
        district: area.district,
        state: area.state,
        country: area.country,
        isActive: area.isActive,
        officeLocationIds,
        officeLocations,
      },
    };
  }

  async findAll(query: AreaQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      isActive,
      officeLocationIds,
      officeLocationId,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AreaWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;

    // officeLocationIds (IN semantics) takes precedence when provided; officeLocationId is a
    // single-value shorthand that resolves to the same IN filter with one element.
    const effectiveOfficeIds =
      officeLocationIds && officeLocationIds.length > 0
        ? officeLocationIds
        : officeLocationId
          ? [officeLocationId]
          : undefined;
    if (effectiveOfficeIds && effectiveOfficeIds.length > 0) {
      where.officeLocations = { some: { id: { in: effectiveOfficeIds } } };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [areas, total] = await this.prisma.$transaction([
      this.prisma.area.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          officeLocations: { where: { isActive: true }, select: { id: true, name: true } },
          _count: { select: { officeLocations: true, workerProfiles: true } },
        },
      }),
      this.prisma.area.count({ where }),
    ]);

    const items = areas.map((a) => ({
      ...a,
      officeLocationIds: a.officeLocations.map((o) => o.id),
    }));

    return {
      success: true,
      data: { areas: items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const area = await this.prisma.area.findUnique({
      where: { id },
      include: {
        officeLocations: { where: { isActive: true } },
        _count: { select: { workerProfiles: true, tasks: true } },
      },
    });
    if (!area) throw new NotFoundException('Area not found');
    return {
      success: true,
      data: {
        ...area,
        officeLocationIds: area.officeLocations.map((o) => o.id),
      },
    };
  }

  // Lists every active Service with its effective availability in this area. "Effective" means:
  // if an AreaService row exists, use it; otherwise default to true. That default is what keeps
  // areas nobody has ever configured behaving exactly as they did before this feature existed
  // (every active service available everywhere) — see the module-level comment on AreaService.
  async getAreaServices(areaId: string) {
    const area = await this.prisma.area.findUnique({ where: { id: areaId }, select: { id: true } });
    if (!area) throw new NotFoundException('Area not found');

    const [services, configured] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.areaService.findMany({
        where: { areaId },
        select: { serviceId: true, isActive: true },
      }),
    ]);

    const configuredMap = new Map(configured.map((c) => [c.serviceId, c.isActive]));
    return {
      success: true,
      data: services.map((s) => ({
        serviceId: s.id,
        serviceName: s.name,
        isActive: configuredMap.get(s.id) ?? true,
      })),
    };
  }

  // Upserts one AreaService row per entry — this is how an area moves from "unconfigured / all
  // services available" to "explicitly restricted to the selected subset". Never deletes rows
  // for services not mentioned in the payload, so a partial update only touches what's sent.
  async setAreaServices(areaId: string, dto: UpdateAreaServicesDto, actorId?: string, actorName = 'Admin') {
    const area = await this.prisma.area.findUnique({ where: { id: areaId }, select: { id: true, name: true } });
    if (!area) throw new NotFoundException('Area not found');

    const serviceIds = dto.services.map((s) => s.serviceId);
    const foundServices = await this.prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    });
    const foundIds = new Set(foundServices.map((s) => s.id));
    const missing = serviceIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) throw new NotFoundException(`Service(s) not found: ${missing.join(', ')}`);

    await this.prisma.$transaction(
      dto.services.map((entry) =>
        this.prisma.areaService.upsert({
          where: { areaId_serviceId: { areaId, serviceId: entry.serviceId } },
          create: { areaId, serviceId: entry.serviceId, isActive: entry.isActive },
          update: { isActive: entry.isActive },
        }),
      ),
    );

    this.activityLog.log({
      action: ActivityAction.AREA_UPDATED,
      module: ActivityModule.AREA,
      description: `Active services updated for area "${area.name}"`,
      actor: { id: actorId, name: actorName, role: 'ADMIN' },
      target: { id: areaId, type: 'Area' },
      metadata: { services: dto.services },
    });

    return this.getAreaServices(areaId);
  }

  async update(id: string, dto: UpdateAreaDto, actorId?: string, actorName = 'Admin') {
    const current = await this.prisma.area.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!current) throw new NotFoundException('Area not found');

    // pincode and officeLocationIds/officeLocationId aren't columns on Area — pincode drives
    // a derived city/district/state/country lookup, office location ids relink OfficeLocation
    // records (mirrors create()). officeLocationId (legacy singular) is converted to
    // officeLocationIds: [officeLocationId] for backward compatibility. managerId/managerIds
    // are accepted-but-ignored (manager assignment now lives exclusively in the Manager
    // Create/Update APIs) and are discarded here along with the rest. What remains is passed
    // straight through as the Prisma update payload.
    const {
      pincode,
      officeLocationIds: rawOfficeLocationIds,
      officeLocationId,
      managerId: _managerId,
      managerIds: _managerIds,
      ...rest
    } = dto;
    const areaUpdate: Prisma.AreaUpdateInput = { ...rest };

    if (pincode !== undefined) {
      const pincodeRecord = await this.prisma.pincode.findUnique({
        where: { pincode },
        select: { city: true, district: true, state: true, country: true },
      });
      if (!pincodeRecord) throw new NotFoundException(`PIN Code ${pincode} not found`);

      areaUpdate.pincode = pincode;
      areaUpdate.city = pincodeRecord.city;
      areaUpdate.district = pincodeRecord.district ?? pincodeRecord.city;
      areaUpdate.state = pincodeRecord.state;
      areaUpdate.country = pincodeRecord.country;
    }

    // undefined = office assignments untouched; otherwise the array fully replaces them.
    const officeLocationIds = this.resolveOfficeLocationIds({
      officeLocationIds: rawOfficeLocationIds,
      officeLocationId,
    });

    if (officeLocationIds !== undefined) {
      if (officeLocationIds.length === 0) {
        throw new BadRequestException(
          'At least one office location is required when updating office locations',
        );
      }
      const foundOffices = await this.prisma.officeLocation.findMany({
        where: { id: { in: officeLocationIds } },
        select: { id: true },
      });
      const foundOfficeIds = new Set(foundOffices.map((o) => o.id));
      const missingOfficeIds = officeLocationIds.filter(
        (oid) => !foundOfficeIds.has(oid),
      );
      if (missingOfficeIds.length > 0) {
        throw new NotFoundException(
          `Office location(s) not found: ${missingOfficeIds.join(', ')}`,
        );
      }
    }

    const isStatusChanging = dto.isActive !== undefined && dto.isActive !== current.isActive;

    let managerUserIds: string[] = [];
    let workerUserIds: string[] = [];

    const { area, officeLocations } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.area.update({
        where: { id },
        data: areaUpdate,
      });

      if (officeLocationIds !== undefined) {
        // Full replace — matches the same semantics as PUT pincodes/managers/:id:
        // unlink offices no longer selected, link the newly selected ones.
        await tx.officeLocation.updateMany({
          where: { areaId: id, id: { notIn: officeLocationIds } },
          data: { areaId: null },
        });
        await tx.officeLocation.updateMany({
          where: { id: { in: officeLocationIds } },
          data: { areaId: id },
        });
      }

      if (isStatusChanging) {
        const cascade = await this.cascadeAreaStatusInTx(tx, id, dto.isActive!);
        managerUserIds = cascade.managerUserIds;
        workerUserIds = cascade.workerUserIds;
      }

      const offices = await tx.officeLocation.findMany({
        where: { areaId: id },
        select: { id: true, name: true },
      });

      return { area: updated, officeLocations: offices };
    });

    if (isStatusChanging) {
      const isActive = dto.isActive!;
      this.activityLog.log({
        action: isActive ? ActivityAction.AREA_ACTIVATED : ActivityAction.AREA_DEACTIVATED,
        module: ActivityModule.AREA,
        description: `Area "${area.name}" ${isActive ? 'activated' : 'deactivated'}`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        target: { id, type: 'Area' },
        metadata: { cascadedManagers: managerUserIds.length, cascadedWorkers: workerUserIds.length },
      });
      if (managerUserIds.length > 0) {
        this.activityLog.log({
          action: isActive ? ActivityAction.MANAGER_ACTIVATED : ActivityAction.MANAGER_DEACTIVATED,
          module: ActivityModule.MANAGER,
          description: `${managerUserIds.length} manager(s) ${isActive ? 'activated' : 'deactivated'} via Area cascade`,
          actor: { id: actorId, name: actorName, role: 'ADMIN' },
          metadata: { triggeredBy: 'AREA_STATUS_CHANGE', areaId: id, areaName: area.name, count: managerUserIds.length },
        });
      }
      if (workerUserIds.length > 0) {
        this.activityLog.log({
          action: isActive ? ActivityAction.WORKER_ACTIVATED : ActivityAction.WORKER_DEACTIVATED,
          module: ActivityModule.WORKER,
          description: `${workerUserIds.length} worker(s) ${isActive ? 'activated' : 'deactivated'} via Area cascade`,
          actor: { id: actorId, name: actorName, role: 'ADMIN' },
          metadata: { triggeredBy: 'AREA_STATUS_CHANGE', areaId: id, areaName: area.name, count: workerUserIds.length },
        });
      }
    } else {
      this.activityLog.log({
        action: ActivityAction.AREA_UPDATED,
        module: ActivityModule.AREA,
        description: `Area "${area.name}" updated`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        target: { id, type: 'Area' },
      });
    }

    return {
      success: true,
      message: 'Area updated successfully',
      data: {
        ...area,
        officeLocationIds: officeLocations.map((o) => o.id),
        officeLocations,
      },
    };
  }

  async remove(id: string, actorId?: string, actorName = 'Admin') {
    const current = await this.prisma.area.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!current) throw new NotFoundException('Area not found');

    let managerUserIds: string[] = [];
    let workerUserIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.area.update({ where: { id }, data: { isActive: false } });
      if (current.isActive) {
        const cascade = await this.cascadeAreaStatusInTx(tx, id, false);
        managerUserIds = cascade.managerUserIds;
        workerUserIds = cascade.workerUserIds;
      }
    });

    this.activityLog.log({
      action: ActivityAction.AREA_DEACTIVATED,
      module: ActivityModule.AREA,
      description: `Area "${current.name}" deactivated`,
      actor: { id: actorId, name: actorName, role: 'ADMIN' },
      target: { id, type: 'Area' },
      metadata: { cascadedManagers: managerUserIds.length, cascadedWorkers: workerUserIds.length },
    });

    if (managerUserIds.length > 0) {
      this.activityLog.log({
        action: ActivityAction.MANAGER_DEACTIVATED,
        module: ActivityModule.MANAGER,
        description: `${managerUserIds.length} manager(s) deactivated via Area cascade`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        metadata: { triggeredBy: 'AREA_STATUS_CHANGE', areaId: id, areaName: current.name, count: managerUserIds.length },
      });
    }
    if (workerUserIds.length > 0) {
      this.activityLog.log({
        action: ActivityAction.WORKER_DEACTIVATED,
        module: ActivityModule.WORKER,
        description: `${workerUserIds.length} worker(s) deactivated via Area cascade`,
        actor: { id: actorId, name: actorName, role: 'ADMIN' },
        metadata: { triggeredBy: 'AREA_STATUS_CHANGE', areaId: id, areaName: current.name, count: workerUserIds.length },
      });
    }

    return { success: true, message: 'Area deactivated successfully' };
  }

  async delete(id: string, actorId?: string, actorName = 'Admin') {
    const area = await this.prisma.area.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            officeLocations: true,
            managerAreas: true,
            workerProfiles: true,
            tasks: true,
          },
        },
      },
    });
    if (!area) throw new NotFoundException('Area not found');

    const { officeLocations, managerAreas, workerProfiles, tasks } = area._count;
    if (officeLocations + managerAreas + workerProfiles + tasks > 0) {
      throw new ConflictException('Cannot delete Area because it is assigned to existing records.');
    }

    await this.prisma.area.delete({ where: { id } });

    this.activityLog.log({
      action: ActivityAction.AREA_DELETED,
      module: ActivityModule.AREA,
      description: `Area "${area.name}" deleted`,
      actor: { id: actorId, name: actorName, role: 'ADMIN' },
      target: { id, type: 'Area' },
      metadata: { areaId: id, name: area.name },
    });

    return { success: true, message: 'Area deleted successfully.' };
  }

  async getStats() {
    const [totalAreas, totalOfficeLocations, totalManagers, activeManagers] = await this.prisma.$transaction([
      this.prisma.area.count(),
      this.prisma.officeLocation.count(),
      this.prisma.managerProfile.count(),
      this.prisma.managerProfile.count({ where: { user: { isActive: true } } }),
    ]);

    return {
      success: true,
      data: { totalAreas, totalOfficeLocations, totalManagers, activeManagers },
    };
  }

  async getMyAreas(managerId: string) {
    const managerProfile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerId },
      include: { areas: { include: { area: { include: { officeLocations: true } } } } },
    });
    if (!managerProfile) throw new NotFoundException('Manager profile not found');

    const areas = managerProfile.areas.map((ma) => ma.area);
    return { success: true, data: areas };
  }

  // Normalizes the new officeLocationIds array and the deprecated singular officeLocationId
  // into one array. Returns undefined only when neither field was supplied — callers use that
  // to distinguish "no office change requested" (update) from "invalid payload" (create).
  private resolveOfficeLocationIds(dto: {
    officeLocationIds?: string[];
    officeLocationId?: string;
  }): string[] | undefined {
    if (dto.officeLocationIds !== undefined) return [...new Set(dto.officeLocationIds)];
    if (dto.officeLocationId !== undefined) return [dto.officeLocationId];
    return undefined;
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
