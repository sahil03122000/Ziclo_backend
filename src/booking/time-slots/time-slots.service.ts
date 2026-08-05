import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTimeSlotDto } from './dto/create-time-slot.dto';
import { TimeSlotQueryDto } from './dto/time-slot-query.dto';

// Default working hours used to auto-generate a day's slots the first time
// they're requested for a service/date that has none yet — see findAll().
const DEFAULT_WORKING_HOURS_START = 9; // 09:00
const DEFAULT_WORKING_HOURS_END = 18; // 18:00 (last slot starts at 17:00)
const DEFAULT_SLOT_DURATION_MINUTES = 60;

const SLOT_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  capacity: true,
  isAvailable: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true } },
  _count: { select: { bookings: true } },
} satisfies Prisma.TimeSlotSelect;

@Injectable()
export class TimeSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateTimeSlotDto, actorId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: { id: true, isActive: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    if (!service.isActive) throw new BadRequestException('Service is not active');

    this.assertTimeOrder(dto.startTime, dto.endTime);

    const conflict = await this.prisma.timeSlot.findUnique({
      where: { serviceId_date_startTime: { serviceId: dto.serviceId, date: dto.date, startTime: dto.startTime } },
      select: { id: true },
    });
    if (conflict) throw new BadRequestException('A time slot already exists for this service, date, and start time');

    const slot = await this.prisma.timeSlot.create({
      data: {
        serviceId: dto.serviceId,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity ?? 1,
      },
      select: SLOT_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'TimeSlot', entityId: slot.id, action: AuditAction.CREATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Time slot created successfully', data: slot };
  }

  async findAll(query: TimeSlotQueryDto) {
    const { page = 1, limit = 20, serviceId, date, dateFrom, dateTo, isAvailable } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.TimeSlotWhereInput = {};

    if (serviceId) where.serviceId = serviceId;
    if (isAvailable !== undefined) where.isAvailable = isAvailable;
    if (date) {
      where.date = date;
    } else if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) (where.date as Prisma.DateTimeFilter).gte = dateFrom;
      if (dateTo) (where.date as Prisma.DateTimeFilter).lte = dateTo;
    }

    // A specific service + specific date is the "what times can I book?" query (the one the
    // customer-facing flow calls). If nothing has ever been generated for that day yet — the
    // normal state for a brand-new service/date, since slots are otherwise only created one at
    // a time via POST — generate the default working-hours slots for it now instead of
    // returning an empty list. Once generated they're real persisted rows, so booking against
    // their id works exactly like any admin-created slot.
    if (serviceId && date && isAvailable === undefined) {
      const existingCount = await this.prisma.timeSlot.count({ where: { serviceId, date } });
      if (existingCount === 0) {
        await this.generateDefaultSlotsForDay(serviceId, date);
      }
    }

    const [slots, total] = await this.prisma.$transaction([
      this.prisma.timeSlot.findMany({
        where,
        select: SLOT_SELECT,
        skip,
        take: limit,
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.timeSlot.count({ where }),
    ]);

    return {
      success: true,
      data: { slots, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  /**
   * Creates one TimeSlot row per hour of the default working day (09:00-18:00) for a
   * service/date that has none yet. Only called when the service actually exists and is
   * active; a bogus serviceId still correctly returns an empty list rather than creating
   * orphaned slots. Uses skipDuplicates so a concurrent request generating the same day
   * can't violate the [serviceId, date, startTime] unique constraint.
   */
  private async generateDefaultSlotsForDay(serviceId: string, date: Date): Promise<void> {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, isActive: true },
    });
    if (!service || !service.isActive) return;

    const slots: Prisma.TimeSlotCreateManyInput[] = [];
    for (let hour = DEFAULT_WORKING_HOURS_START; hour < DEFAULT_WORKING_HOURS_END; hour += DEFAULT_SLOT_DURATION_MINUTES / 60) {
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const endTime = `${String(hour + DEFAULT_SLOT_DURATION_MINUTES / 60).padStart(2, '0')}:00`;
      slots.push({ serviceId, date, startTime, endTime, capacity: 1 });
    }

    await this.prisma.timeSlot.createMany({ data: slots, skipDuplicates: true });
  }

  async findOne(id: string) {
    const slot = await this.prisma.timeSlot.findUnique({ where: { id }, select: SLOT_SELECT });
    if (!slot) throw new NotFoundException('Time slot not found');
    return { success: true, data: slot };
  }

  async toggleAvailability(id: string, actorId: string) {
    const slot = await this.prisma.timeSlot.findUnique({ where: { id }, select: { id: true, isAvailable: true } });
    if (!slot) throw new NotFoundException('Time slot not found');

    const updated = await this.prisma.timeSlot.update({
      where: { id },
      data: { isAvailable: !slot.isAvailable },
      select: SLOT_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'TimeSlot', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { isAvailable: slot.isAvailable }, newValue: { isAvailable: !slot.isAvailable } })
      .catch(() => {});

    return { success: true, message: `Time slot ${updated.isAvailable ? 'enabled' : 'disabled'}`, data: updated };
  }

  async remove(id: string, actorId: string) {
    const slot = await this.prisma.timeSlot.findUnique({ where: { id }, select: { id: true, _count: { select: { bookings: true } } } });
    if (!slot) throw new NotFoundException('Time slot not found');
    if (slot._count.bookings > 0) throw new BadRequestException('Cannot delete a time slot that has existing bookings');

    await this.prisma.timeSlot.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'TimeSlot', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Time slot deleted successfully' };
  }

  private assertTimeOrder(start: string, end: string): void {
    if (start >= end) throw new BadRequestException('startTime must be before endTime');
  }
}
