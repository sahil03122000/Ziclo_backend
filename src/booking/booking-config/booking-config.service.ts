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

    return {
      success: true,
      data: {
        serviceable: !!area,
        areaId: area?.id ?? null,
        areaName: area?.name ?? null,
      },
    };
  }
}
