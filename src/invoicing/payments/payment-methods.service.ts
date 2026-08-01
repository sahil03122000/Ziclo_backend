import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateSavedPaymentMethodDto } from './dto/create-saved-payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  // Empty array when the customer has none — frontend hides the section entirely.
  async list(userId: string) {
    const methods = await this.prisma.savedPaymentMethod.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { success: true, data: methods };
  }

  // Newly added method is always made the default — the caller (booking payment screen)
  // auto-selects whichever method comes back with isDefault: true.
  async create(userId: string, dto: CreateSavedPaymentMethodDto) {
    const method = await this.prisma.$transaction(async (tx) => {
      await tx.savedPaymentMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.savedPaymentMethod.create({
        data: { userId, type: dto.type, label: dto.label, providerRef: dto.providerRef, isDefault: true },
      });
    });
    return { success: true, message: 'Payment method added', data: method };
  }

  async remove(id: string, userId: string) {
    const method = await this.prisma.savedPaymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Payment method not found');
    if (method.userId !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.savedPaymentMethod.update({ where: { id }, data: { isActive: false } });
    return { success: true, message: 'Payment method removed' };
  }
}
