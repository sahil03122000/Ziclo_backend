import { BadRequestException, Injectable } from '@nestjs/common';

import { DEFAULTS, SETTING_KEYS } from '../../admin/admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckServiceAreaDto } from './dto/check-service-area.dto';

@Injectable()
export class BookingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getBookingConfig() {
    const [settingRows, areas] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [SETTING_KEYS.taxPercentage, SETTING_KEYS.advancePaymentPercentage],
          },
        },
        select: { key: true, value: true },
      }),
      this.prisma.area.findMany({
        where: { isActive: true },
        select: { id: true, name: true, city: true, state: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const map = new Map(settingRows.map((r) => [r.key, Number(r.value)]));

    return {
      success: true,
      data: {
        taxPercentage: map.get(SETTING_KEYS.taxPercentage) ?? DEFAULTS.taxPercentage,
        advancePaymentPercentage:
          map.get(SETTING_KEYS.advancePaymentPercentage) ?? DEFAULTS.advancePaymentPercentage,
        activeAreas: areas,
      },
    };
  }

  async checkServiceArea(dto: CheckServiceAreaDto, userId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Invalid address');
    }

    const area = await this.prisma.area.findFirst({
      where: { pincode: address.pincode, isActive: true },
      select: { id: true, name: true },
    });

    let services: { id: string; name: string }[] = [];
    if (area) {
      const [allServices, configured] = await this.prisma.$transaction([
        this.prisma.service.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.areaService.findMany({
          where: { areaId: area.id },
          select: { serviceId: true, isActive: true },
        }),
      ]);
      const configuredMap = new Map(configured.map((c) => [c.serviceId, c.isActive]));
      services = allServices.filter((s) => configuredMap.get(s.id) ?? true);
    }

    return {
      success: true,
      data: {
        serviceable: !!area,
        areaId: area?.id ?? null,
        areaName: area?.name ?? null,
        pincode: address.pincode,
        services,
      },
    };
  }

  async checkPincodeAvailability(pincode: string) {
    const pincodeRecord = await this.prisma.pincode.findUnique({ where: { pincode } });
    if (!pincodeRecord) {
      return {
        success: true,
        data: { pincode, available: false, message: 'Invalid pincode.', services: [] },
      };
    }

    const area = await this.prisma.area.findFirst({ where: { pincode, isActive: true } });
    if (!area) {
      return {
        success: true,
        data: {
          pincode,
          available: false,
          message: "Ziclo isn't available in this area yet.",
          services: [],
        },
      };
    }

    const [allServices, areaServices] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where: { isActive: true },
        select: { id: true, name: true, thumbnail: true, iconUrl: true },
      }),
      this.prisma.areaService.findMany({ where: { areaId: area.id } }),
    ]);

    const overrides = new Map(areaServices.map((s) => [s.serviceId, s.isActive]));
    const services = allServices.filter((s) => overrides.get(s.id) ?? true);

    return {
      success: true,
      data: {
        pincode,
        available: true,
        message:
          services.length > 0
            ? 'Ziclo is available in this area.'
            : 'Ziclo is available in this area, but no services are active yet.',
        services,
      },
    };
  }
}
