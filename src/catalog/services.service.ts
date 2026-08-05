import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto, PricingOptionInputDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { pickIconFields } from './icon-fields.util';

type PropertyTypeWithPackages = Prisma.PropertyTypeGetPayload<{ include: { packages: { include: { pricingOptions: true } } } }>;

// A package always needs at least one selectable pricing option — when the admin doesn't
// supply any, a single "Standard" option is created from the package's flat basePrice so
// nothing is ever left unbookable.
function toPricingOptionsCreate(basePrice: number, options: PricingOptionInputDto[] | undefined) {
  if (options && options.length > 0) {
    return options.map((opt, i) => ({
      label: opt.label,
      price: opt.price,
      displayOrder: opt.displayOrder ?? i,
      isActive: opt.isActive ?? true,
    }));
  }
  return [{ label: 'Standard', price: basePrice, displayOrder: 0, isActive: true }];
}

@Injectable()
export class CatalogServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // Single Prisma nested-write call — Service → PropertyTypes → Packages all
  // commit atomically as one transaction, or none of it is written.
  async create(dto: CreateServiceDto, actorId: string) {
    const conflict = await this.prisma.service.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (conflict) throw new ConflictException('A service with this name already exists');

    const service = await this.prisma.service.create({
      data: {
        name: dto.name,
        description: dto.description,
        thumbnail: dto.thumbnailImage,
        banner: dto.bannerImage,
        isActive: dto.isActive,
        ...pickIconFields(dto),
        propertyTypes: {
          create: dto.propertyTypes.map((propertyType, ptIndex) => ({
            name: propertyType.name,
            description: propertyType.description,
            displayOrder: propertyType.displayOrder ?? ptIndex,
            isActive: propertyType.isActive ?? true,
            ...pickIconFields(propertyType),
            packages: {
              create: propertyType.packages.map((pkg, pkgIndex) => ({
                name: pkg.name,
                description: pkg.description,
                price: pkg.basePrice,
                durationMinutes: pkg.duration,
                minPanels: pkg.minPanels,
                maxPanels: pkg.maxPanels,
                isActive: pkg.isActive ?? true,
                displayOrder: pkg.displayOrder ?? pkgIndex,
                ...pickIconFields(pkg),
                pricingOptions: { create: toPricingOptionsCreate(pkg.basePrice, pkg.pricingOptions) },
              })),
            },
          })),
        },
      },
      select: {
        id: true,
        name: true,
        thumbnail: true,
        banner: true,
        iconName: true,
        iconUrl: true,
      },
    });

    this.audit(actorId, service.id, AuditAction.CREATE, {
      name: dto.name,
      propertyTypesCount: dto.propertyTypes.length,
      packagesCount: dto.propertyTypes.reduce((sum, pt) => sum + pt.packages.length, 0),
    });

    const { thumbnail, banner, ...rest } = service;
    return {
      success: true,
      message: 'Service created successfully',
      data: { ...rest, thumbnailImage: thumbnail, bannerImage: banner },
    };
  }

  async list() {
    const services = await this.prisma.service.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { propertyTypes: true, bookings: true } } },
    });
    // Same thumbnailImage/bannerImage naming as getDetail/getBookingDetail/listPaginated —
    // the create/update payload's field names, not the raw thumbnail/banner DB column names.
    return {
      success: true,
      data: services.map(({ thumbnail, banner, ...rest }) => ({
        ...rest,
        thumbnailImage: thumbnail,
        bannerImage: banner,
      })),
    };
  }

  // Paginated listing with full nested property types/packages — backs GET /booking/services.
  async listPaginated(query: { page?: number; limit?: number; search?: string; status?: 'active' | 'inactive' }) {
    const { page = 1, limit = 20, search, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ServiceWhereInput = {};
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [services, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        include: {
          propertyTypes: {
            orderBy: { displayOrder: 'asc' },
            include: {
              packages: {
                orderBy: { displayOrder: 'asc' },
                include: { pricingOptions: { orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }] } },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      success: true,
      data: {
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          thumbnailImage: s.thumbnail,
          bannerImage: s.banner,
          isActive: s.isActive,
          iconName: s.iconName,
          iconUrl: s.iconUrl,
          propertyTypes: this.mapPropertyTypes(s.propertyTypes),
        })),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async getDetail(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        propertyTypes: {
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          include: {
            packages: {
              orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
              select: {
                id: true,
                name: true,
                price: true,
                durationMinutes: true,
                isActive: true,
                iconName: true,
                iconUrl: true,
                pricingOptions: {
                  where: { isActive: true },
                  orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
                  select: { id: true, label: true, price: true, displayOrder: true, isActive: true },
                },
              },
            },
          },
        },
      },
    });
    if (!service) throw new NotFoundException('Service not found');

    return {
      success: true,
      data: {
        id: service.id,
        name: service.name,
        description: service.description,
        thumbnailImage: service.thumbnail,
        bannerImage: service.banner,
        isActive: service.isActive,
        iconName: service.iconName,
        iconUrl: service.iconUrl,
        propertyTypes: service.propertyTypes.map((pt) => ({
          id: pt.id,
          name: pt.name,
          description: pt.description,
          iconName: pt.iconName,
          iconUrl: pt.iconUrl,
          packages: pt.packages,
        })),
      },
    };
  }

  // Full detail shaped for the Service Management edit screen — backs GET /booking/services/:id.
  async getBookingDetail(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        propertyTypes: {
          orderBy: { displayOrder: 'asc' },
          include: {
            packages: {
              orderBy: { displayOrder: 'asc' },
              include: { pricingOptions: { orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }] } },
            },
          },
        },
      },
    });
    if (!service) throw new NotFoundException('Service not found');

    return {
      success: true,
      data: {
        id: service.id,
        name: service.name,
        description: service.description,
        thumbnailImage: service.thumbnail,
        bannerImage: service.banner,
        isActive: service.isActive,
        iconName: service.iconName,
        iconUrl: service.iconUrl,
        propertyTypes: this.mapPropertyTypes(service.propertyTypes),
      },
    };
  }

  // If a propertyType/package in the payload carries an `id`, that record is
  // updated in place; if `id` is absent, a new record is created. Anything
  // already in the DB but missing from the payload is left untouched — this
  // endpoint never deletes (use the dedicated /property-types and /packages
  // endpoints for that). Runs as a single transaction.
  async update(id: string, dto: UpdateServiceDto, actorId: string) {
    await this.assertExists(id);
    if (dto.name) {
      const conflict = await this.prisma.service.findFirst({
        where: { name: { equals: dto.name, mode: 'insensitive' }, NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('A service with this name already exists');
    }

    // thumbnailImage/bannerImage: a blank string (edit form re-submitting an unchanged image
    // field) is treated the same as "not provided" — the existing image is preserved, never
    // overwritten with null/empty.
    const thumbnailImage = dto.thumbnailImage?.trim();
    const bannerImage = dto.bannerImage?.trim();

    const updateData = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(thumbnailImage && { thumbnail: thumbnailImage }),
      ...(bannerImage && { banner: bannerImage }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...pickIconFields(dto),
    };

    const service = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.service.update({ where: { id }, data: updateData });

      if (dto.propertyTypes) {
        const keepPropertyTypeIds: string[] = [];

        for (const [ptIndex, propertyType] of dto.propertyTypes.entries()) {
          let propertyTypeId = propertyType.id;

          if (propertyTypeId) {
            const existing = await tx.propertyType.findUnique({
              where: { id: propertyTypeId },
              select: { id: true, serviceId: true },
            });
            if (!existing || existing.serviceId !== id) {
              throw new NotFoundException(`Property type ${propertyTypeId} not found for this service`);
            }
            await tx.propertyType.update({
              where: { id: propertyTypeId },
              data: {
                name: propertyType.name,
                description: propertyType.description,
                displayOrder: propertyType.displayOrder ?? ptIndex,
                isActive: propertyType.isActive ?? true,
                ...pickIconFields(propertyType),
              },
            });
          } else {
            const created = await tx.propertyType.create({
              data: {
                serviceId: id,
                name: propertyType.name,
                description: propertyType.description,
                displayOrder: propertyType.displayOrder ?? ptIndex,
                isActive: propertyType.isActive ?? true,
                ...pickIconFields(propertyType),
              },
              select: { id: true },
            });
            propertyTypeId = created.id;
          }

          keepPropertyTypeIds.push(propertyTypeId);
          const keepPackageIds: string[] = [];

          for (const [pkgIndex, pkg] of propertyType.packages.entries()) {
            const packageData = {
              name: pkg.name,
              description: pkg.description,
              price: pkg.basePrice,
              durationMinutes: pkg.duration,
              minPanels: pkg.minPanels,
              maxPanels: pkg.maxPanels,
              isActive: pkg.isActive ?? true,
              displayOrder: pkg.displayOrder ?? pkgIndex,
              ...pickIconFields(pkg),
            };

            let packageId = pkg.id;
            if (packageId) {
              const existingPackage = await tx.package.findUnique({
                where: { id: packageId },
                select: { id: true, propertyTypeId: true },
              });
              if (!existingPackage || existingPackage.propertyTypeId !== propertyTypeId) {
                throw new NotFoundException(`Package ${packageId} not found for property type ${propertyTypeId}`);
              }
              await tx.package.update({ where: { id: packageId }, data: packageData });
            } else {
              const createdPackage = await tx.package.create({
                data: { propertyTypeId, ...packageData },
                select: { id: true },
              });
              packageId = createdPackage.id;
            }
            keepPackageIds.push(packageId);

            // Pricing options for this package — same id-present-updates / id-absent-creates
            // pattern as property types/packages above; anything missing from the payload for
            // an existing package is removed, but a brand-new package (or one with no options
            // supplied) always keeps at least one option via toPricingOptionsCreate's fallback.
            const keepOptionIds: string[] = [];
            const optionsInput = pkg.pricingOptions && pkg.pricingOptions.length > 0
              ? pkg.pricingOptions
              : toPricingOptionsCreate(pkg.basePrice, undefined).map((o) => ({ ...o }));

            for (const [optIdx, opt] of optionsInput.entries()) {
              const optionData = {
                label: opt.label,
                price: opt.price,
                displayOrder: opt.displayOrder ?? optIdx,
                isActive: opt.isActive ?? true,
              };
              const optId = 'id' in opt ? opt.id : undefined;
              if (optId) {
                const existingOption = await tx.pricingOption.findUnique({
                  where: { id: optId },
                  select: { id: true, packageId: true },
                });
                if (!existingOption || existingOption.packageId !== packageId) {
                  throw new NotFoundException(`Pricing option ${optId} not found for package ${packageId}`);
                }
                await tx.pricingOption.update({ where: { id: optId }, data: optionData });
                keepOptionIds.push(optId);
              } else {
                const createdOption = await tx.pricingOption.create({
                  data: { packageId, ...optionData },
                  select: { id: true },
                });
                keepOptionIds.push(createdOption.id);
              }
            }

            await tx.pricingOption.deleteMany({
              where: { packageId, id: { notIn: keepOptionIds } },
            });
          }

          // Packages that exist under this property type but weren't in the payload are removed.
          await tx.package.deleteMany({
            where: { propertyTypeId, id: { notIn: keepPackageIds } },
          });
        }

        // Property types that exist for this service but weren't in the payload are removed
        // (their packages cascade-delete via the schema's onDelete: Cascade).
        await tx.propertyType.deleteMany({
          where: { serviceId: id, id: { notIn: keepPropertyTypeIds } },
        });
      }

      return updated;
    }, {
      // This transaction does one sequential DB round trip per property type / package /
      // pricing option in the payload (findUnique + update-or-create, plus deleteManys for
      // removed rows) — Prisma's default 5s interactive-transaction timeout is easily
      // exceeded for services with several property types, each is fine on its own, but
      // over Neon's pooled connection the cumulative latency adds up. Once the timeout hits,
      // Prisma closes the transaction server-side and the next query against `tx` (often
      // the `tx.package.deleteMany` near the end) throws P2028 "Transaction not found".
      // Raising timeout/maxWait here — the transaction's logic is unchanged — fixes that.
      timeout: 30000,
      maxWait: 10000,
    });

    this.audit(actorId, id, AuditAction.UPDATE, { ...updateData, propertyTypesSubmitted: dto.propertyTypes?.length ?? 0 });

    // Same thumbnailImage/bannerImage naming as every other Service response — the create/update
    // payload's field names, not the raw thumbnail/banner DB column names.
    const { thumbnail, banner, ...rest } = service;
    return { success: true, data: { ...rest, thumbnailImage: thumbnail, bannerImage: banner } };
  }

  // Activates/deactivates a service without touching any other field — backs
  // PATCH /booking/services/:id/status. GET /services (the customer Home screen's active
  // list) reads Service.isActive live, so the change is immediately reflected there too.
  async updateStatus(id: string, dto: UpdateServiceStatusDto, actorId: string) {
    await this.assertExists(id);
    const service = await this.prisma.service.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: { id: true, isActive: true },
    });
    this.audit(actorId, id, AuditAction.STATUS_CHANGE, dto);
    return { success: true, data: service };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.service.delete({ where: { id } });
    this.audit(actorId, id, AuditAction.DELETE);
    return { success: true, message: 'Service deleted successfully' };
  }

  async assertExists(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  private mapPropertyTypes(propertyTypes: PropertyTypeWithPackages[]) {
    return propertyTypes.map((pt) => ({
      id: pt.id,
      name: pt.name,
      description: pt.description,
      displayOrder: pt.displayOrder,
      isActive: pt.isActive,
      iconName: pt.iconName,
      iconUrl: pt.iconUrl,
      packages: pt.packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        basePrice: pkg.price,
        duration: pkg.durationMinutes,
        displayOrder: pkg.displayOrder,
        isActive: pkg.isActive,
        iconName: pkg.iconName,
        iconUrl: pkg.iconUrl,
        pricingOptions: pkg.pricingOptions.map((opt) => ({
          id: opt.id,
          label: opt.label,
          price: opt.price,
          displayOrder: opt.displayOrder,
          isActive: opt.isActive,
        })),
      })),
    }));
  }

  private audit(actorId: string, entityId: string, action: AuditAction, newValue?: unknown) {
    this.auditLogs
      .log({ actorId, entityType: 'Service', entityId, action, newValue: newValue as Record<string, unknown> })
      .catch(() => {});
  }
}
