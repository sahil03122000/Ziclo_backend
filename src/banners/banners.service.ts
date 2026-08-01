import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, ActivityModule, Role } from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { QueryBannersDto } from './dto/query-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

interface Actor {
  id: string;
  name: string;
  role: Role;
}

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─── Admin: Create ─────────────────────────────────────────────────────────

  async create(dto: CreateBannerDto, actor: Actor) {
    const existing = await this.prisma.banner.findFirst({
      where: { displayOrder: dto.displayOrder, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Display order ${dto.displayOrder} is already in use`);
    }

    const banner = await this.prisma.banner.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        imageUrl: dto.imageUrl,
        redirectType: dto.redirectType,
        redirectValue: dto.redirectValue,
        displayOrder: dto.displayOrder,
        isActive: dto.isActive ?? true,
        createdBy: actor.id,
      },
    });

    this.activityLog.log({
      action: ActivityAction.BANNER_CREATED,
      module: ActivityModule.BANNER,
      description: `Banner "${banner.title}" created`,
      actor,
      target: { id: banner.id, type: 'Banner' },
      metadata: { title: banner.title, displayOrder: banner.displayOrder },
    });

    return banner;
  }

  // ─── Admin: List (paginated) ───────────────────────────────────────────────

  async findAll(query: QueryBannersDto) {
    const { page = 1, limit = 20, isActive } = query;
    const skip = (page - 1) * limit;

    const where = {
      deletedAt: null,
      ...(isActive !== undefined && { isActive }),
    };

    const [items, total] = await Promise.all([
      this.prisma.banner.findMany({
        where,
        orderBy: { displayOrder: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.banner.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Public: List active banners ──────────────────────────────────────────

  async findActive() {
    return this.prisma.banner.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
    });
  }

  // ─── Admin: Get single ────────────────────────────────────────────────────

  async findOne(id: string) {
    const banner = await this.prisma.banner.findFirst({
      where: { id, deletedAt: null },
    });
    if (!banner) throw new NotFoundException(`Banner ${id} not found`);
    return banner;
  }

  // ─── Admin: Update ────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateBannerDto, actor: Actor) {
    await this.findOne(id);

    if (dto.displayOrder !== undefined) {
      const conflict = await this.prisma.banner.findFirst({
        where: { displayOrder: dto.displayOrder, deletedAt: null, id: { not: id } },
      });
      if (conflict) {
        throw new ConflictException(`Display order ${dto.displayOrder} is already in use`);
      }
    }

    const banner = await this.prisma.banner.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.redirectType !== undefined && { redirectType: dto.redirectType }),
        ...(dto.redirectValue !== undefined && { redirectValue: dto.redirectValue }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    this.activityLog.log({
      action: ActivityAction.BANNER_UPDATED,
      module: ActivityModule.BANNER,
      description: `Banner "${banner.title}" updated`,
      actor,
      target: { id: banner.id, type: 'Banner' },
      metadata: dto as Record<string, unknown>,
    });

    return banner;
  }

  // ─── Admin: Toggle active ─────────────────────────────────────────────────

  async toggleActive(id: string, isActive: boolean, actor: Actor) {
    await this.findOne(id);

    const banner = await this.prisma.banner.update({
      where: { id },
      data: { isActive },
    });

    this.activityLog.log({
      action: isActive ? ActivityAction.BANNER_ACTIVATED : ActivityAction.BANNER_DEACTIVATED,
      module: ActivityModule.BANNER,
      description: `Banner "${banner.title}" ${isActive ? 'activated' : 'deactivated'}`,
      actor,
      target: { id: banner.id, type: 'Banner' },
    });

    return banner;
  }

  // ─── Admin: Soft delete ───────────────────────────────────────────────────

  async remove(id: string, actor: Actor) {
    const banner = await this.findOne(id);

    await this.prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.activityLog.log({
      action: ActivityAction.BANNER_DELETED,
      module: ActivityModule.BANNER,
      description: `Banner "${banner.title}" deleted`,
      actor,
      target: { id: banner.id, type: 'Banner' },
    });

    return { message: 'Banner deleted successfully' };
  }
}
