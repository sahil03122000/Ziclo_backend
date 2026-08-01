import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingStatus,
  DealStage,
  InvoiceStatus,
  LeadStatus,
  PaymentStatus,
  Prisma,
  Role,
  TaskStatus,
  TicketStatus,
} from '@prisma/client';
import { Workbook } from 'exceljs';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { Response } from 'express';
import { join } from 'path';

import { getTodayRange } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AttendanceReportQueryDto } from './dto/attendance-report-query.dto';
import { BookingReportQueryDto } from './dto/booking-report-query.dto';
import { ChartsQueryDto } from './dto/charts-query.dto';
import { ComplaintReportQueryDto } from './dto/complaint-report-query.dto';
import { CustomerReportQueryDto } from './dto/customer-report-query.dto';
import {
  ExportReportFormat,
  ExportReportQueryDto,
  ExportReportType,
} from './dto/export-report-query.dto';
import { ManagerReportQueryDto } from './dto/manager-report-query.dto';
import {
  ExportQueryDto,
  ExportType,
  ReportsQueryDto,
} from './dto/reports-query.dto';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { WorkerReportQueryDto } from './dto/worker-report-query.dto';

const PDFDocument = require('pdfkit');

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboard(query: AdminReportQueryDto) {
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const bookingFilter: Prisma.BookingWhereInput = dateWhere
      ? { createdAt: dateWhere }
      : {};

    const [
      totalRevenueAgg,
      totalBookings,
      completedJobs,
      cancelledJobs,
      activeCustomers,
      activeWorkers,
      activeManagers,
      openComplaints,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          status: InvoiceStatus.PAID,
          ...(dateWhere ? { createdAt: dateWhere } : {}),
        },
        _sum: { total: true },
      }),
      this.prisma.booking.count({ where: bookingFilter }),
      this.prisma.booking.count({
        where: { status: BookingStatus.COMPLETED, ...bookingFilter },
      }),
      this.prisma.booking.count({
        where: { status: BookingStatus.CANCELLED, ...bookingFilter },
      }),
      this.prisma.user.count({ where: { role: Role.USER, isActive: true } }),
      this.prisma.user.count({ where: { role: Role.WORKER, isActive: true } }),
      this.prisma.user.count({ where: { role: Role.MANAGER, isActive: true } }),
      this.prisma.supportTicket.count({
        where: {
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        totalRevenue: this.r2(totalRevenueAgg._sum.total ?? 0),
        totalBookings,
        completedJobs,
        cancelledJobs,
        activeCustomers,
        activeWorkers,
        activeManagers,
        openComplaints,
      },
    };
  }

  // ─── Revenue Report ─────────────────────────────────────────────────────────

  async getRevenueReport(query: RevenueReportQueryDto) {
    const where = this.buildRevenueWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { id: true, name: true } },
          worker: {
            select: {
              id: true,
              name: true,
              workerProfile: {
                select: { area: { select: { id: true, name: true } } },
              },
            },
          },
          manager: { select: { id: true, name: true } },
          invoice: {
            select: {
              total: true,
              taxAmount: true,
              subtotal: true,
              status: true,
              payments: {
                select: { method: true, status: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const items = bookings.map((b) => ({
      id: b.id,
      bookingRef: b.bookingRef,
      customer: b.customer
        ? { id: b.customer.id, name: b.customer.name, phone: b.customer.phone }
        : null,
      service: b.service ? { id: b.service.id, name: b.service.name } : null,
      area: b.worker?.workerProfile?.area ?? null,
      manager: b.manager ? { id: b.manager.id, name: b.manager.name } : null,
      worker: b.worker ? { id: b.worker.id, name: b.worker.name } : null,
      amount: this.r2(b.invoice?.total ?? 0),
      taxAmount: this.r2(b.invoice?.taxAmount ?? 0),
      netAmount: this.r2(b.invoice?.subtotal ?? 0),
      paymentMethod: b.invoice?.payments?.[0]?.method ?? null,
      invoiceStatus: b.invoice?.status ?? null,
      date: b.createdAt,
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportRevenueExcel(
    query: RevenueReportQueryDto,
    res: Response,
  ): Promise<void> {
    const bookings = await this.prisma.booking.findMany({
      where: this.buildRevenueWhere(query),
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        worker: {
          select: {
            name: true,
            workerProfile: { select: { area: { select: { name: true } } } },
          },
        },
        manager: { select: { name: true } },
        invoice: {
          select: {
            total: true,
            taxAmount: true,
            subtotal: true,
            status: true,
            payments: {
              select: { method: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    await this.writeExcelResponse(
      res,
      `revenue-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Booking Ref', key: 'bookingRef', width: 16 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Service', key: 'service', width: 22 },
        { header: 'Area', key: 'area', width: 18 },
        { header: 'Manager', key: 'manager', width: 18 },
        { header: 'Worker', key: 'worker', width: 18 },
        { header: 'Amount (₹)', key: 'amount', width: 14 },
        { header: 'Tax (₹)', key: 'taxAmount', width: 12 },
        { header: 'Net (₹)', key: 'netAmount', width: 12 },
        { header: 'Payment Method', key: 'paymentMethod', width: 16 },
        { header: 'Invoice Status', key: 'invoiceStatus', width: 14 },
        { header: 'Date', key: 'date', width: 14 },
      ],
      bookings.map((b) => ({
        bookingRef: b.bookingRef ?? '',
        customer: b.customer?.name ?? '',
        service: b.service?.name ?? '',
        area: b.worker?.workerProfile?.area?.name ?? '',
        manager: b.manager?.name ?? '',
        worker: b.worker?.name ?? '',
        amount: this.r2(b.invoice?.total ?? 0),
        taxAmount: this.r2(b.invoice?.taxAmount ?? 0),
        netAmount: this.r2(b.invoice?.subtotal ?? 0),
        paymentMethod: b.invoice?.payments?.[0]?.method ?? '',
        invoiceStatus: b.invoice?.status ?? '',
        date: b.createdAt.toLocaleDateString('en-IN'),
      })),
    );
  }

  async exportRevenuePdf(
    query: RevenueReportQueryDto,
    res: Response,
  ): Promise<void> {
    const bookings = await this.prisma.booking.findMany({
      where: this.buildRevenueWhere(query),
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        invoice: {
          select: {
            total: true,
            taxAmount: true,
            status: true,
            payments: {
              select: { method: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1_000,
    });

    this.writePdfResponse(
      res,
      `revenue-report-${this.todayStr()}.pdf`,
      'Revenue Report',
      [
        { header: 'Booking Ref', width: 90 },
        { header: 'Customer', width: 115 },
        { header: 'Service', width: 115 },
        { header: 'Amount (₹)', width: 80 },
        { header: 'Tax (₹)', width: 70 },
        { header: 'Method', width: 75 },
        { header: 'Status', width: 75 },
        { header: 'Date', width: 75 },
      ],
      bookings.map((b) => [
        b.bookingRef ?? '',
        b.customer?.name ?? '',
        b.service?.name ?? '',
        String(this.r2(b.invoice?.total ?? 0)),
        String(this.r2(b.invoice?.taxAmount ?? 0)),
        b.invoice?.payments?.[0]?.method ?? '',
        b.invoice?.status ?? '',
        b.createdAt.toLocaleDateString('en-IN'),
      ]),
    );
  }

  // ─── Booking Report ─────────────────────────────────────────────────────────

  async getBookingReport(query: BookingReportQueryDto) {
    const where = this.buildBookingWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { id: true, name: true } },
          worker: {
            select: {
              id: true,
              name: true,
              workerProfile: {
                select: { area: { select: { id: true, name: true } } },
              },
            },
          },
          manager: { select: { id: true, name: true } },
          invoice: { select: { total: true, status: true } },
        },
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const items = bookings.map((b) => ({
      id: b.id,
      bookingRef: b.bookingRef,
      status: b.status,
      scheduledAt: b.scheduledAt,
      completedAt: b.completedAt,
      customer: b.customer
        ? { id: b.customer.id, name: b.customer.name, phone: b.customer.phone }
        : null,
      service: b.service ? { id: b.service.id, name: b.service.name } : null,
      area: b.worker?.workerProfile?.area ?? null,
      manager: b.manager ? { id: b.manager.id, name: b.manager.name } : null,
      worker: b.worker ? { id: b.worker.id, name: b.worker.name } : null,
      amount: this.r2(b.invoice?.total ?? 0),
      invoiceStatus: b.invoice?.status ?? null,
      createdAt: b.createdAt,
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportBookingExcel(
    query: BookingReportQueryDto,
    res: Response,
  ): Promise<void> {
    const bookings = await this.prisma.booking.findMany({
      where: this.buildBookingWhere(query),
      include: {
        customer: { select: { name: true, phone: true } },
        service: { select: { name: true } },
        worker: {
          select: {
            name: true,
            workerProfile: { select: { area: { select: { name: true } } } },
          },
        },
        manager: { select: { name: true } },
        invoice: { select: { total: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    await this.writeExcelResponse(
      res,
      `bookings-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Booking Ref', key: 'bookingRef', width: 16 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Service', key: 'service', width: 22 },
        { header: 'Area', key: 'area', width: 18 },
        { header: 'Manager', key: 'manager', width: 18 },
        { header: 'Worker', key: 'worker', width: 18 },
        { header: 'Amount (₹)', key: 'amount', width: 14 },
        { header: 'Scheduled', key: 'scheduledAt', width: 16 },
        { header: 'Created', key: 'createdAt', width: 14 },
      ],
      bookings.map((b) => ({
        bookingRef: b.bookingRef ?? '',
        status: b.status,
        customer: b.customer?.name ?? '',
        phone: b.customer?.phone ?? '',
        service: b.service?.name ?? '',
        area: b.worker?.workerProfile?.area?.name ?? '',
        manager: b.manager?.name ?? '',
        worker: b.worker?.name ?? '',
        amount: this.r2(b.invoice?.total ?? 0),
        scheduledAt: b.scheduledAt.toLocaleDateString('en-IN'),
        createdAt: b.createdAt.toLocaleDateString('en-IN'),
      })),
    );
  }

  async exportBookingPdf(
    query: BookingReportQueryDto,
    res: Response,
  ): Promise<void> {
    const bookings = await this.prisma.booking.findMany({
      where: this.buildBookingWhere(query),
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        worker: { select: { name: true } },
        manager: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1_000,
    });

    this.writePdfResponse(
      res,
      `bookings-report-${this.todayStr()}.pdf`,
      'Bookings Report',
      [
        { header: 'Booking Ref', width: 90 },
        { header: 'Status', width: 80 },
        { header: 'Customer', width: 110 },
        { header: 'Service', width: 110 },
        { header: 'Manager', width: 100 },
        { header: 'Worker', width: 100 },
        { header: 'Scheduled', width: 85 },
        { header: 'Created', width: 75 },
      ],
      bookings.map((b) => [
        b.bookingRef ?? '',
        b.status,
        b.customer?.name ?? '',
        b.service?.name ?? '',
        b.manager?.name ?? '',
        b.worker?.name ?? '',
        b.scheduledAt.toLocaleDateString('en-IN'),
        b.createdAt.toLocaleDateString('en-IN'),
      ]),
    );
  }

  // ─── Customer Report ─────────────────────────────────────────────────────────

  async getCustomerReport(query: CustomerReportQueryDto) {
    const where = this.buildCustomerWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          _count: { select: { customerBookings: true } },
        },
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    if (users.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          meta: this.buildMeta(0, query.page ?? 1, query.limit ?? 20),
        },
      };
    }

    const customerIds = users.map((u) => u.id);
    const [spendRows, lastBookingRows] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: InvoiceStatus.PAID },
        _sum: { total: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { createdAt: true },
      }),
    ]);

    const spendMap = new Map(
      spendRows.map((r) => [r.customerId, this.r2(r._sum.total ?? 0)]),
    );
    const lastBookingMap = new Map(
      lastBookingRows.map((r) => [r.customerId, r._max.createdAt]),
    );

    const items = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      totalBookings: u._count.customerBookings,
      totalSpent: spendMap.get(u.id) ?? 0,
      lastBooking: lastBookingMap.get(u.id) ?? null,
      createdAt: u.createdAt,
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportCustomerExcel(
    query: CustomerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: this.buildCustomerWhere(query),
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { customerBookings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    const customerIds = users.map((u) => u.id);
    const [spendRows, lastBookingRows] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: InvoiceStatus.PAID },
        _sum: { total: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { createdAt: true },
      }),
    ]);

    const spendMap = new Map(
      spendRows.map((r) => [r.customerId, this.r2(r._sum.total ?? 0)]),
    );
    const lastBookingMap = new Map(
      lastBookingRows.map((r) => [r.customerId, r._max.createdAt]),
    );

    await this.writeExcelResponse(
      res,
      `customers-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Total Bookings', key: 'totalBookings', width: 16 },
        { header: 'Total Spent (₹)', key: 'totalSpent', width: 16 },
        { header: 'Last Booking', key: 'lastBooking', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Joined', key: 'createdAt', width: 14 },
      ],
      users.map((u) => ({
        name: u.name,
        email: u.email ?? '',
        phone: u.phone ?? '',
        totalBookings: u._count.customerBookings,
        totalSpent: spendMap.get(u.id) ?? 0,
        lastBooking:
          lastBookingMap.get(u.id)?.toLocaleDateString('en-IN') ?? '',
        status: u.isActive ? 'Active' : 'Inactive',
        createdAt: u.createdAt.toLocaleDateString('en-IN'),
      })),
    );
  }

  async exportCustomerPdf(
    query: CustomerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: this.buildCustomerWhere(query),
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        _count: { select: { customerBookings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1_000,
    });

    const customerIds = users.map((u) => u.id);
    const spendRows = await this.prisma.invoice.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, status: InvoiceStatus.PAID },
      _sum: { total: true },
    });
    const spendMap = new Map(
      spendRows.map((r) => [r.customerId, this.r2(r._sum.total ?? 0)]),
    );

    this.writePdfResponse(
      res,
      `customers-report-${this.todayStr()}.pdf`,
      'Customer Report',
      [
        { header: 'Name', width: 140 },
        { header: 'Phone', width: 100 },
        { header: 'Total Bookings', width: 100 },
        { header: 'Total Spent (₹)', width: 110 },
        { header: 'Status', width: 80 },
      ],
      users.map((u) => [
        u.name,
        u.phone ?? '',
        String(u._count.customerBookings),
        String(spendMap.get(u.id) ?? 0),
        u.isActive ? 'Active' : 'Inactive',
      ]),
    );
  }

  // ─── Worker Report ──────────────────────────────────────────────────────────

  async getWorkerReport(query: WorkerReportQueryDto) {
    const workerWhere = await this.buildWorkerWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);

    const [workers, total] = await Promise.all([
      this.prisma.user.findMany({
        where: workerWhere,
        select: {
          id: true,
          name: true,
          phone: true,
          isActive: true,
          workerProfile: {
            select: {
              employeeCode: true,
              area: {
                select: {
                  id: true,
                  name: true,
                  managerAreas: {
                    select: {
                      manager: {
                        select: { user: { select: { id: true, name: true } } },
                      },
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        skip,
        take,
        orderBy: { name: query.sortOrder ?? 'asc' },
      }),
      this.prisma.user.count({ where: workerWhere }),
    ]);

    if (workers.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          meta: this.buildMeta(0, query.page ?? 1, query.limit ?? 20),
        },
      };
    }

    const workerIds = workers.map((w) => w.id);
    const bookingDateFilter: Prisma.BookingWhereInput = dateWhere
      ? { createdAt: dateWhere }
      : {};
    const attendanceDateFilter: Prisma.AttendanceWhereInput = dateWhere
      ? { checkInTime: dateWhere }
      : {};

    const [completedRows, pendingRows, earningRows, attendanceRows] =
      await Promise.all([
        this.prisma.booking.groupBy({
          by: ['workerId'],
          where: {
            workerId: { in: workerIds },
            status: BookingStatus.COMPLETED,
            ...bookingDateFilter,
          },
          _count: true,
        }),
        this.prisma.booking.groupBy({
          by: ['workerId'],
          where: {
            workerId: { in: workerIds },
            status: {
              in: [
                BookingStatus.PENDING,
                BookingStatus.CONFIRMED,
                BookingStatus.ASSIGNED,
                BookingStatus.IN_PROGRESS,
              ],
            },
            ...bookingDateFilter,
          },
          _count: true,
        }),
        this.prisma.booking.findMany({
          where: {
            workerId: { in: workerIds },
            invoice: { is: { status: InvoiceStatus.PAID } },
            ...bookingDateFilter,
          },
          select: { workerId: true, invoice: { select: { total: true } } },
        }),
        this.prisma.attendance.groupBy({
          by: ['userId'],
          where: { userId: { in: workerIds }, ...attendanceDateFilter },
          _count: true,
        }),
      ]);

    const completedMap = new Map(
      completedRows.map((r) => [r.workerId!, r._count]),
    );
    const pendingMap = new Map(pendingRows.map((r) => [r.workerId!, r._count]));
    const attendanceMap = new Map(
      attendanceRows.map((r) => [r.userId, r._count]),
    );
    const earningsMap = new Map<string, number>();
    for (const b of earningRows) {
      if (!b.workerId) continue;
      earningsMap.set(
        b.workerId,
        (earningsMap.get(b.workerId) ?? 0) + (b.invoice?.total ?? 0),
      );
    }

    const totalDays = dateWhere
      ? Math.max(
          1,
          Math.ceil(
            ((dateWhere.lte ?? new Date()).getTime() -
              (
                dateWhere.gte ?? new Date(Date.now() - 30 * 86400000)
              ).getTime()) /
              86_400_000,
          ) + 1,
        )
      : 30;

    const items = workers.map((w) => ({
      id: w.id,
      name: w.name,
      phone: w.phone,
      employeeCode: w.workerProfile?.employeeCode ?? null,
      isActive: w.isActive,
      area: w.workerProfile?.area
        ? { id: w.workerProfile.area.id, name: w.workerProfile.area.name }
        : null,
      manager: w.workerProfile?.area?.managerAreas?.[0]?.manager?.user ?? null,
      completedJobs: completedMap.get(w.id) ?? 0,
      pendingJobs: pendingMap.get(w.id) ?? 0,
      earnings: this.r2(earningsMap.get(w.id) ?? 0),
      attendancePct: +(
        ((attendanceMap.get(w.id) ?? 0) / totalDays) *
        100
      ).toFixed(1),
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportWorkerExcel(
    query: WorkerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const workerWhere = await this.buildWorkerWhere(query);
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const bookingDateFilter: Prisma.BookingWhereInput = dateWhere
      ? { createdAt: dateWhere }
      : {};

    const workers = await this.prisma.user.findMany({
      where: workerWhere,
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        workerProfile: {
          select: {
            employeeCode: true,
            area: {
              select: {
                name: true,
                managerAreas: {
                  select: {
                    manager: { select: { user: { select: { name: true } } } },
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 10_000,
    });

    const workerIds = workers.map((w) => w.id);
    const [completedRows, earningRows, attendanceRows] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['workerId'],
        where: {
          workerId: { in: workerIds },
          status: BookingStatus.COMPLETED,
          ...bookingDateFilter,
        },
        _count: true,
      }),
      this.prisma.booking.findMany({
        where: {
          workerId: { in: workerIds },
          invoice: { is: { status: InvoiceStatus.PAID } },
          ...bookingDateFilter,
        },
        select: { workerId: true, invoice: { select: { total: true } } },
      }),
      this.prisma.attendance.groupBy({
        by: ['userId'],
        where: {
          userId: { in: workerIds },
          ...(dateWhere ? { checkInTime: dateWhere } : {}),
        },
        _count: true,
      }),
    ]);

    const completedMap = new Map(
      completedRows.map((r) => [r.workerId!, r._count]),
    );
    const earningsMap = new Map<string, number>();
    for (const b of earningRows) {
      if (b.workerId)
        earningsMap.set(
          b.workerId,
          (earningsMap.get(b.workerId) ?? 0) + (b.invoice?.total ?? 0),
        );
    }
    const attendanceMap = new Map(
      attendanceRows.map((r) => [r.userId, r._count]),
    );
    const totalDays = 30;

    await this.writeExcelResponse(
      res,
      `workers-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Employee Code', key: 'employeeCode', width: 16 },
        { header: 'Area', key: 'area', width: 18 },
        { header: 'Manager', key: 'manager', width: 18 },
        { header: 'Completed Jobs', key: 'completedJobs', width: 16 },
        { header: 'Earnings (₹)', key: 'earnings', width: 14 },
        { header: 'Attendance %', key: 'attendancePct', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
      ],
      workers.map((w) => ({
        name: w.name,
        phone: w.phone ?? '',
        employeeCode: w.workerProfile?.employeeCode ?? '',
        area: w.workerProfile?.area?.name ?? '',
        manager:
          w.workerProfile?.area?.managerAreas?.[0]?.manager?.user?.name ?? '',
        completedJobs: completedMap.get(w.id) ?? 0,
        earnings: this.r2(earningsMap.get(w.id) ?? 0),
        attendancePct: +(
          ((attendanceMap.get(w.id) ?? 0) / totalDays) *
          100
        ).toFixed(1),
        status: w.isActive ? 'Active' : 'Inactive',
      })),
    );
  }

  async exportWorkerPdf(
    query: WorkerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const workerWhere = await this.buildWorkerWhere(query);
    const workers = await this.prisma.user.findMany({
      where: workerWhere,
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        workerProfile: {
          select: { employeeCode: true, area: { select: { name: true } } },
        },
      },
      orderBy: { name: 'asc' },
      take: 1_000,
    });

    const workerIds = workers.map((w) => w.id);
    const completedRows = await this.prisma.booking.groupBy({
      by: ['workerId'],
      where: { workerId: { in: workerIds }, status: BookingStatus.COMPLETED },
      _count: true,
    });
    const completedMap = new Map(
      completedRows.map((r) => [r.workerId!, r._count]),
    );

    this.writePdfResponse(
      res,
      `workers-report-${this.todayStr()}.pdf`,
      'Worker Report',
      [
        { header: 'Name', width: 130 },
        { header: 'Phone', width: 90 },
        { header: 'Emp Code', width: 85 },
        { header: 'Area', width: 100 },
        { header: 'Completed Jobs', width: 100 },
        { header: 'Status', width: 75 },
      ],
      workers.map((w) => [
        w.name,
        w.phone ?? '',
        w.workerProfile?.employeeCode ?? '',
        w.workerProfile?.area?.name ?? '',
        String(completedMap.get(w.id) ?? 0),
        w.isActive ? 'Active' : 'Inactive',
      ]),
    );
  }

  // ─── Manager Report ─────────────────────────────────────────────────────────

  async getManagerReport(query: ManagerReportQueryDto) {
    const where = this.buildManagerWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const bookingDateFilter: Prisma.BookingWhereInput = dateWhere
      ? { createdAt: dateWhere }
      : {};

    const [managers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          isActive: true,
          managerProfile: {
            select: {
              employeeCode: true,
              officeLocation: { select: { id: true, name: true } },
              areas: {
                select: { area: { select: { id: true, name: true } } },
                take: 1,
              },
            },
          },
        },
        skip,
        take,
        orderBy: { name: query.sortOrder ?? 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    if (managers.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          meta: this.buildMeta(0, query.page ?? 1, query.limit ?? 20),
        },
      };
    }

    const managerIds = managers.map((m) => m.id);

    // Get worker counts for each manager (through their areas)
    const managerProfiles = await this.prisma.managerProfile.findMany({
      where: { userId: { in: managerIds } },
      select: { userId: true, areas: { select: { areaId: true } } },
    });
    const managerAreaMap = new Map(
      managerProfiles.map((p) => [p.userId, p.areas.map((a) => a.areaId)]),
    );
    const allAreaIds = [...new Set([...managerAreaMap.values()].flat())];

    const [workerCountRows, completedRows, pendingRows, earningRows] =
      await Promise.all([
        allAreaIds.length > 0
          ? this.prisma.workerProfile.groupBy({
              by: ['areaId'],
              where: { areaId: { in: allAreaIds } },
              _count: true,
            })
          : Promise.resolve(
              [] as Array<{ areaId: string | null; _count: number }>,
            ),
        this.prisma.booking.groupBy({
          by: ['managerId'],
          where: {
            managerId: { in: managerIds },
            status: BookingStatus.COMPLETED,
            ...bookingDateFilter,
          },
          _count: true,
        }),
        this.prisma.booking.groupBy({
          by: ['managerId'],
          where: {
            managerId: { in: managerIds },
            status: {
              in: [
                BookingStatus.PENDING,
                BookingStatus.CONFIRMED,
                BookingStatus.ASSIGNED,
                BookingStatus.IN_PROGRESS,
              ],
            },
            ...bookingDateFilter,
          },
          _count: true,
        }),
        this.prisma.booking.findMany({
          where: {
            managerId: { in: managerIds },
            invoice: { is: { status: InvoiceStatus.PAID } },
            ...bookingDateFilter,
          },
          select: { managerId: true, invoice: { select: { total: true } } },
        }),
      ]);

    const workerByArea = new Map(
      workerCountRows.map((r) => [r.areaId!, r._count]),
    );
    const completedMap = new Map(
      completedRows.map((r) => [r.managerId!, r._count]),
    );
    const pendingMap = new Map(
      pendingRows.map((r) => [r.managerId!, r._count]),
    );
    const revenueMap = new Map<string, number>();
    for (const b of earningRows) {
      if (!b.managerId) continue;
      revenueMap.set(
        b.managerId,
        (revenueMap.get(b.managerId) ?? 0) + (b.invoice?.total ?? 0),
      );
    }

    const items = managers.map((m) => {
      const areaIds = managerAreaMap.get(m.id) ?? [];
      const workerCount = areaIds.reduce(
        (s, aid) => s + (workerByArea.get(aid) ?? 0),
        0,
      );
      return {
        id: m.id,
        name: m.name,
        phone: m.phone,
        employeeCode: m.managerProfile?.employeeCode ?? null,
        isActive: m.isActive,
        officeLocation: m.managerProfile?.officeLocation ?? null,
        area: m.managerProfile?.areas?.[0]?.area ?? null,
        workerCount,
        completedJobs: completedMap.get(m.id) ?? 0,
        pendingJobs: pendingMap.get(m.id) ?? 0,
        revenue: this.r2(revenueMap.get(m.id) ?? 0),
      };
    });

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportManagerExcel(
    query: ManagerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const managers = await this.prisma.user.findMany({
      where: this.buildManagerWhere(query),
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        managerProfile: {
          select: {
            employeeCode: true,
            officeLocation: { select: { name: true } },
            areas: { select: { area: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 10_000,
    });

    const managerIds = managers.map((m) => m.id);
    const completedRows = await this.prisma.booking.groupBy({
      by: ['managerId'],
      where: { managerId: { in: managerIds }, status: BookingStatus.COMPLETED },
      _count: true,
    });
    const completedMap = new Map(
      completedRows.map((r) => [r.managerId!, r._count]),
    );

    await this.writeExcelResponse(
      res,
      `managers-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Employee Code', key: 'employeeCode', width: 16 },
        { header: 'Office Location', key: 'office', width: 20 },
        { header: 'Area', key: 'area', width: 18 },
        { header: 'Completed Jobs', key: 'completedJobs', width: 16 },
        { header: 'Status', key: 'status', width: 10 },
      ],
      managers.map((m) => ({
        name: m.name,
        phone: m.phone ?? '',
        employeeCode: m.managerProfile?.employeeCode ?? '',
        office: m.managerProfile?.officeLocation?.name ?? '',
        area: m.managerProfile?.areas?.[0]?.area?.name ?? '',
        completedJobs: completedMap.get(m.id) ?? 0,
        status: m.isActive ? 'Active' : 'Inactive',
      })),
    );
  }

  async exportManagerPdf(
    query: ManagerReportQueryDto,
    res: Response,
  ): Promise<void> {
    const managers = await this.prisma.user.findMany({
      where: this.buildManagerWhere(query),
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        managerProfile: {
          select: {
            employeeCode: true,
            officeLocation: { select: { name: true } },
            areas: { select: { area: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 1_000,
    });

    const managerIds = managers.map((m) => m.id);
    const completedRows = await this.prisma.booking.groupBy({
      by: ['managerId'],
      where: { managerId: { in: managerIds }, status: BookingStatus.COMPLETED },
      _count: true,
    });
    const completedMap = new Map(
      completedRows.map((r) => [r.managerId!, r._count]),
    );

    this.writePdfResponse(
      res,
      `managers-report-${this.todayStr()}.pdf`,
      'Manager Report',
      [
        { header: 'Name', width: 130 },
        { header: 'Phone', width: 90 },
        { header: 'Office', width: 110 },
        { header: 'Area', width: 100 },
        { header: 'Completed Jobs', width: 100 },
        { header: 'Status', width: 70 },
      ],
      managers.map((m) => [
        m.name,
        m.phone ?? '',
        m.managerProfile?.officeLocation?.name ?? '',
        m.managerProfile?.areas?.[0]?.area?.name ?? '',
        String(completedMap.get(m.id) ?? 0),
        m.isActive ? 'Active' : 'Inactive',
      ]),
    );
  }

  // ─── Attendance Report ───────────────────────────────────────────────────────

  async getAttendanceReport(query: AttendanceReportQueryDto) {
    const where = this.buildAttendanceWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          officeLocation: { select: { id: true, name: true } },
        },
        skip,
        take,
        orderBy: { checkInTime: query.sortOrder ?? 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    const items = records.map((r) => {
      const hours = r.checkOutTime
        ? this.r2(
            (r.checkOutTime.getTime() - r.checkInTime.getTime()) / 3_600_000,
          )
        : null;
      return {
        id: r.id,
        user: { id: r.user.id, name: r.user.name, phone: r.user.phone },
        officeLocation: r.officeLocation,
        checkInTime: r.checkInTime,
        checkOutTime: r.checkOutTime,
        workingHours: hours,
        status: r.status,
        date: r.checkInTime,
      };
    });

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportAttendanceExcel(
    query: AttendanceReportQueryDto,
    res: Response,
  ): Promise<void> {
    const records = await this.prisma.attendance.findMany({
      where: this.buildAttendanceWhere(query),
      include: {
        user: { select: { name: true, phone: true } },
        officeLocation: { select: { name: true } },
      },
      orderBy: { checkInTime: 'desc' },
      take: 10_000,
    });

    await this.writeExcelResponse(
      res,
      `attendance-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Employee', key: 'name', width: 22 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Office Location', key: 'office', width: 20 },
        { header: 'Check In', key: 'checkIn', width: 18 },
        { header: 'Check Out', key: 'checkOut', width: 18 },
        { header: 'Working Hours', key: 'hours', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Date', key: 'date', width: 14 },
      ],
      records.map((r) => {
        const hours = r.checkOutTime
          ? this.r2(
              (r.checkOutTime.getTime() - r.checkInTime.getTime()) / 3_600_000,
            )
          : '';
        return {
          name: r.user.name,
          phone: r.user.phone ?? '',
          office: r.officeLocation.name,
          checkIn: r.checkInTime.toLocaleTimeString('en-IN'),
          checkOut: r.checkOutTime?.toLocaleTimeString('en-IN') ?? '',
          hours,
          status: r.status,
          date: r.checkInTime.toLocaleDateString('en-IN'),
        };
      }),
    );
  }

  async exportAttendancePdf(
    query: AttendanceReportQueryDto,
    res: Response,
  ): Promise<void> {
    const records = await this.prisma.attendance.findMany({
      where: this.buildAttendanceWhere(query),
      include: {
        user: { select: { name: true } },
        officeLocation: { select: { name: true } },
      },
      orderBy: { checkInTime: 'desc' },
      take: 1_000,
    });

    this.writePdfResponse(
      res,
      `attendance-report-${this.todayStr()}.pdf`,
      'Attendance Report',
      [
        { header: 'Employee', width: 130 },
        { header: 'Office', width: 110 },
        { header: 'Check In', width: 90 },
        { header: 'Check Out', width: 90 },
        { header: 'Hours', width: 70 },
        { header: 'Status', width: 80 },
        { header: 'Date', width: 80 },
      ],
      records.map((r) => {
        const hours = r.checkOutTime
          ? String(
              this.r2(
                (r.checkOutTime.getTime() - r.checkInTime.getTime()) /
                  3_600_000,
              ),
            )
          : '';
        return [
          r.user.name,
          r.officeLocation.name,
          r.checkInTime.toLocaleTimeString('en-IN'),
          r.checkOutTime?.toLocaleTimeString('en-IN') ?? '',
          hours,
          r.status,
          r.checkInTime.toLocaleDateString('en-IN'),
        ];
      }),
    );
  }

  // ─── Complaint Report ────────────────────────────────────────────────────────

  async getComplaintReport(query: ComplaintReportQueryDto) {
    const where = this.buildComplaintWhere(query);
    const { skip, take } = this.buildPagination(query.page, query.limit);

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
        },
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const items = tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      customer: t.customer
        ? { id: t.customer.id, name: t.customer.name, phone: t.customer.phone }
        : null,
      assignedTo: t.assignedTo
        ? { id: t.assignedTo.id, name: t.assignedTo.name }
        : null,
      closedAt: t.closedAt,
      createdAt: t.createdAt,
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
      },
    };
  }

  async exportComplaintExcel(
    query: ComplaintReportQueryDto,
    res: Response,
  ): Promise<void> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: this.buildComplaintWhere(query),
      include: {
        customer: { select: { name: true, phone: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    await this.writeExcelResponse(
      res,
      `complaints-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Ticket #', key: 'ticketNumber', width: 14 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Assigned To', key: 'assignedTo', width: 20 },
        { header: 'Created', key: 'createdAt', width: 14 },
        { header: 'Closed', key: 'closedAt', width: 14 },
      ],
      tickets.map((t) => ({
        ticketNumber: t.ticketNumber ?? '',
        title: t.title,
        customer: t.customer?.name ?? '',
        phone: t.customer?.phone ?? '',
        priority: t.priority,
        status: t.status,
        assignedTo: t.assignedTo?.name ?? '',
        createdAt: t.createdAt.toLocaleDateString('en-IN'),
        closedAt: t.closedAt?.toLocaleDateString('en-IN') ?? '',
      })),
    );
  }

  async exportComplaintPdf(
    query: ComplaintReportQueryDto,
    res: Response,
  ): Promise<void> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: this.buildComplaintWhere(query),
      include: {
        customer: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1_000,
    });

    this.writePdfResponse(
      res,
      `complaints-report-${this.todayStr()}.pdf`,
      'Complaints Report',
      [
        { header: 'Ticket #', width: 80 },
        { header: 'Customer', width: 120 },
        { header: 'Priority', width: 70 },
        { header: 'Status', width: 80 },
        { header: 'Assigned To', width: 120 },
        { header: 'Created', width: 80 },
      ],
      tickets.map((t) => [
        t.ticketNumber ?? '',
        t.customer?.name ?? '',
        t.priority,
        t.status,
        t.assignedTo?.name ?? '',
        t.createdAt.toLocaleDateString('en-IN'),
      ]),
    );
  }

  // ─── Tax Report ──────────────────────────────────────────────────────────────

  async getTaxReport(query: AdminReportQueryDto) {
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const where: Prisma.InvoiceWhereInput = {
      status: {
        in: [
          InvoiceStatus.PAID,
          InvoiceStatus.SENT,
          InvoiceStatus.PARTIALLY_PAID,
        ],
      },
    };
    if (dateWhere) where.createdAt = dateWhere;
    if (query.search) {
      where.OR = [
        {
          booking: {
            bookingRef: { contains: query.search, mode: 'insensitive' },
          },
        },
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = this.buildPagination(query.page, query.limit);
    const [invoices, total, totalTaxAgg] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          booking: {
            select: { bookingRef: true, service: { select: { name: true } } },
          },
          customer: { select: { id: true, name: true } },
        },
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({
        where,
        _sum: { taxAmount: true, total: true },
      }),
    ]);

    const items = invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      bookingRef: inv.booking?.bookingRef ?? null,
      service: inv.booking?.service?.name ?? null,
      customer: inv.customer
        ? { id: inv.customer.id, name: inv.customer.name }
        : null,
      subtotal: this.r2(inv.subtotal),
      gstRate: inv.gstRate,
      taxAmount: this.r2(inv.taxAmount),
      total: this.r2(inv.total),
      status: inv.status,
      date: inv.createdAt,
    }));

    return {
      success: true,
      data: {
        items,
        meta: this.buildMeta(total, query.page ?? 1, query.limit ?? 20),
        summary: {
          totalTaxCollected: this.r2(totalTaxAgg._sum.taxAmount ?? 0),
          totalRevenue: this.r2(totalTaxAgg._sum.total ?? 0),
        },
      },
    };
  }

  async exportTaxExcel(
    query: AdminReportQueryDto,
    res: Response,
  ): Promise<void> {
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const where: Prisma.InvoiceWhereInput = {
      status: {
        in: [
          InvoiceStatus.PAID,
          InvoiceStatus.SENT,
          InvoiceStatus.PARTIALLY_PAID,
        ],
      },
    };
    if (dateWhere) where.createdAt = dateWhere;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        booking: {
          select: { bookingRef: true, service: { select: { name: true } } },
        },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    await this.writeExcelResponse(
      res,
      `tax-report-${this.todayStr()}.xlsx`,
      [
        { header: 'Invoice #', key: 'invoiceNumber', width: 18 },
        { header: 'Booking Ref', key: 'bookingRef', width: 16 },
        { header: 'Service', key: 'service', width: 22 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Subtotal (₹)', key: 'subtotal', width: 14 },
        { header: 'GST Rate (%)', key: 'gstRate', width: 12 },
        { header: 'Tax Amount (₹)', key: 'taxAmount', width: 16 },
        { header: 'Total (₹)', key: 'total', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Date', key: 'date', width: 14 },
      ],
      invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        bookingRef: inv.booking?.bookingRef ?? '',
        service: inv.booking?.service?.name ?? '',
        customer: inv.customer?.name ?? '',
        subtotal: this.r2(inv.subtotal),
        gstRate: inv.gstRate,
        taxAmount: this.r2(inv.taxAmount),
        total: this.r2(inv.total),
        status: inv.status,
        date: inv.createdAt.toLocaleDateString('en-IN'),
      })),
    );
  }

  async exportTaxPdf(query: AdminReportQueryDto, res: Response): Promise<void> {
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const where: Prisma.InvoiceWhereInput = {
      status: {
        in: [
          InvoiceStatus.PAID,
          InvoiceStatus.SENT,
          InvoiceStatus.PARTIALLY_PAID,
        ],
      },
    };
    if (dateWhere) where.createdAt = dateWhere;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        booking: { select: { bookingRef: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1_000,
    });

    this.writePdfResponse(
      res,
      `tax-report-${this.todayStr()}.pdf`,
      'Tax Report',
      [
        { header: 'Invoice #', width: 100 },
        { header: 'Booking Ref', width: 90 },
        { header: 'Customer', width: 110 },
        { header: 'Subtotal', width: 75 },
        { header: 'GST %', width: 55 },
        { header: 'Tax (₹)', width: 70 },
        { header: 'Total (₹)', width: 75 },
        { header: 'Date', width: 75 },
      ],
      invoices.map((inv) => [
        inv.invoiceNumber,
        inv.booking?.bookingRef ?? '',
        inv.customer?.name ?? '',
        String(this.r2(inv.subtotal)),
        String(inv.gstRate),
        String(this.r2(inv.taxAmount)),
        String(this.r2(inv.total)),
        inv.createdAt.toLocaleDateString('en-IN'),
      ]),
    );
  }

  // ─── Charts ──────────────────────────────────────────────────────────────────

  async getCharts(query: ChartsQueryDto) {
    const topN = query.limit ?? 5;
    const { start, end } = this.buildChartDateRange(
      query.startDate,
      query.endDate,
    );
    const dateRange = { gte: start, lte: end };

    const [
      revenueRows,
      bookingRows,
      topServiceRows,
      topWorkerRows,
      topManagerRows,
      paymentMethodRows,
      complaintStatusRows,
    ] = await Promise.all([
      // Revenue trend: sum invoices grouped by day (use JS aggregation)
      this.prisma.invoice.findMany({
        where: { status: InvoiceStatus.PAID, createdAt: dateRange },
        select: { total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Booking trend
      this.prisma.booking.findMany({
        where: { createdAt: dateRange },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Top services by booking count
      this.prisma.booking.groupBy({
        by: ['serviceId'],
        where: { createdAt: dateRange },
        _count: true,
        orderBy: { _count: { serviceId: 'desc' } },
        take: topN,
      }),
      // Top workers by completed jobs
      this.prisma.booking.groupBy({
        by: ['workerId'],
        where: {
          workerId: { not: null },
          status: BookingStatus.COMPLETED,
          createdAt: dateRange,
        },
        _count: true,
        orderBy: { _count: { workerId: 'desc' } },
        take: topN,
      }),
      // Top managers by revenue
      this.prisma.booking.groupBy({
        by: ['managerId'],
        where: {
          managerId: { not: null },
          invoice: { is: { status: InvoiceStatus.PAID } },
          createdAt: dateRange,
        },
        _count: true,
        orderBy: { _count: { managerId: 'desc' } },
        take: topN,
      }),
      // Payment methods distribution
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { status: PaymentStatus.SUCCESS, createdAt: dateRange },
        _count: true,
        _sum: { amount: true },
      }),
      // Complaint status distribution
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        _count: true,
      }),
    ]);

    // Aggregate revenue trend by date
    const revenueTrendMap = new Map<string, number>();
    for (const inv of revenueRows) {
      const d = inv.createdAt.toISOString().slice(0, 10);
      revenueTrendMap.set(d, (revenueTrendMap.get(d) ?? 0) + inv.total);
    }
    const revenueTrend = [...revenueTrendMap.entries()].map(
      ([date, value]) => ({ date, value: this.r2(value) }),
    );

    // Aggregate booking trend by date
    const bookingTrendMap = new Map<string, number>();
    for (const b of bookingRows) {
      const d = b.createdAt.toISOString().slice(0, 10);
      bookingTrendMap.set(d, (bookingTrendMap.get(d) ?? 0) + 1);
    }
    const bookingTrend = [...bookingTrendMap.entries()].map(
      ([date, count]) => ({ date, count }),
    );

    // Resolve service names
    const serviceIds = topServiceRows.map((r) => r.serviceId);
    const services =
      serviceIds.length > 0
        ? await this.prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, name: true },
          })
        : [];
    const serviceNameMap = new Map(services.map((s) => [s.id, s.name]));
    const topServices = topServiceRows.map((r) => ({
      id: r.serviceId,
      name: serviceNameMap.get(r.serviceId) ?? '',
      count: r._count,
    }));

    // Resolve worker names
    const workerIds = topWorkerRows.map((r) => r.workerId!).filter(Boolean);
    const workerUsers =
      workerIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: workerIds } },
            select: { id: true, name: true },
          })
        : [];
    const workerNameMap = new Map(workerUsers.map((u) => [u.id, u.name]));
    const topWorkers = topWorkerRows.map((r) => ({
      id: r.workerId!,
      name: workerNameMap.get(r.workerId!) ?? '',
      count: r._count,
    }));

    // Resolve manager names
    const managerIds = topManagerRows.map((r) => r.managerId!).filter(Boolean);
    const managerUsers =
      managerIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: managerIds } },
            select: { id: true, name: true },
          })
        : [];
    const managerNameMap = new Map(managerUsers.map((u) => [u.id, u.name]));
    const topManagers = topManagerRows.map((r) => ({
      id: r.managerId!,
      name: managerNameMap.get(r.managerId!) ?? '',
      count: r._count,
    }));

    // Payment methods
    const totalPayments = paymentMethodRows.reduce((s, r) => s + r._count, 0);
    const paymentMethods = paymentMethodRows.map((r) => ({
      method: r.method,
      count: r._count,
      amount: this.r2(r._sum.amount ?? 0),
      percentage:
        totalPayments > 0 ? +((r._count / totalPayments) * 100).toFixed(1) : 0,
    }));

    // Complaint status
    const totalComplaints = complaintStatusRows.reduce(
      (s, r) => s + r._count,
      0,
    );
    const complaintStatus = complaintStatusRows.map((r) => ({
      status: r.status,
      count: r._count,
      percentage:
        totalComplaints > 0
          ? +((r._count / totalComplaints) * 100).toFixed(1)
          : 0,
    }));

    return {
      success: true,
      data: {
        revenueTrend,
        bookingTrend,
        topServices,
        topWorkers,
        topManagers,
        paymentMethods,
        complaintStatus,
      },
    };
  }

  // ─── Export — generate file, save to /exports, return download URL ───────────

  async generateExport(query: ExportReportQueryDto): Promise<{
    success: boolean;
    message: string;
    data: {
      downloadUrl: string;
      fileName: string;
      contentType: string;
      expiresAt: string;
    };
  }> {
    const baseUrl = this.configService.get<string>('baseUrl');
    if (!baseUrl) {
      this.logger.warn(
        'BASE_URL is not configured — cannot generate a public download URL. Set BASE_URL=http://<lan-ip>:3000 in .env',
      );
      throw new InternalServerErrorException(
        'BASE_URL is not configured. Set BASE_URL=http://<server-ip>:3000 in .env',
      );
    }

    const { type, format, startDate, endDate } = query;
    const dateWhere = this.buildDateWhere(startDate, endDate);
    const fileName = this.buildExportFilename(type, format, startDate, endDate);
    const contentType =
      format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
    const dir = join(process.cwd(), 'exports');
    const filepath = join(dir, fileName);

    try {
      await mkdir(dir, { recursive: true });
      if (format === 'excel') {
        await this.generateExcelFile(
          type,
          dateWhere,
          filepath,
          startDate,
          endDate,
        );
      } else {
        await this.generatePdfFile(
          type,
          dateWhere,
          filepath,
          startDate,
          endDate,
        );
      }
    } catch (err) {
      console.error('[ReportsService] Export generation failed:', err);
      throw new InternalServerErrorException('Unable to generate report.');
    }

    return {
      success: true,
      message: 'Report generated successfully.',
      data: {
        downloadUrl: `${baseUrl}/exports/${fileName}`,
        fileName,
        contentType,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    };
  }

  private buildExportFilename(
    type: ExportReportType,
    format: ExportReportFormat,
    startDate?: string,
    endDate?: string,
  ): string {
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    const refDate = startDate
      ? new Date(startDate)
      : endDate
        ? new Date(endDate)
        : new Date();
    const month = refDate.toLocaleString('en-US', { month: 'long' });
    const year = refDate.getFullYear();
    return `${typeLabel}_Report_${month}_${year}.${ext}`;
  }

  private async generateExcelFile(
    type: ExportReportType,
    dateWhere: { gte?: Date; lte?: Date } | undefined,
    filepath: string,
    startDate?: string,
    endDate?: string,
  ): Promise<void> {
    const { columns, rows } = await this.fetchExportData(type, dateWhere);
    const title = type.charAt(0).toUpperCase() + type.slice(1) + ' Report';

    const wb = new Workbook();
    wb.creator = 'Ziclo Reports';
    wb.created = new Date();
    const ws = wb.addWorksheet('Report');

    // Set column widths without auto-inserting a header row
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    // Row 1 — Report title
    const titleRow = ws.addRow([title]);
    ws.mergeCells(1, 1, 1, columns.length);
    titleRow.getCell(1).value = title;
    titleRow.getCell(1).font = {
      bold: true,
      size: 14,
      color: { argb: 'FF1F4E79' },
    };
    titleRow.getCell(1).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    titleRow.height = 26;

    // Row 2 — Meta (generated date + optional period)
    const genStr = `Generated: ${new Date().toLocaleDateString('en-IN')}`;
    const periodStr =
      startDate || endDate
        ? `   |   Period: ${startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'All'} – ${endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'All'}`
        : '';
    const metaRow = ws.addRow([genStr + periodStr]);
    ws.mergeCells(2, 1, 2, columns.length);
    metaRow.getCell(1).value = genStr + periodStr;
    metaRow.getCell(1).font = {
      italic: true,
      size: 9,
      color: { argb: 'FF555555' },
    };
    metaRow.getCell(1).alignment = { horizontal: 'center' };
    metaRow.height = 16;

    // Row 3 — Spacer
    ws.addRow([]);

    // Row 4 — Column headers
    const hdrValues = columns.map((c) => c.header);
    const headerRow = ws.addRow(hdrValues);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E79' },
      } as any;
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: false,
      };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } };
    });
    headerRow.height = 22;

    // Data rows (starting row 5)
    const STRIPE = 'FFEEF3FA';
    rows.forEach((row, idx) => {
      const values = columns.map((c) => row[c.key] ?? '');
      const dataRow = ws.addRow(values);
      if (idx % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: STRIPE },
          } as any;
        });
      }
      dataRow.alignment = { vertical: 'middle' };
    });

    // Freeze top 4 rows (title + meta + spacer + header)
    ws.views = [{ state: 'frozen', ySplit: 4 } as any];

    // Auto-filter on the header row
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: columns.length },
    };

    await wb.xlsx.writeFile(filepath);
  }

  private async generatePdfFile(
    type: ExportReportType,
    dateWhere: { gte?: Date; lte?: Date } | undefined,
    filepath: string,
    startDate?: string,
    endDate?: string,
  ): Promise<void> {
    const { columns, rows } = await this.fetchExportData(type, dateWhere);
    const title = type.charAt(0).toUpperCase() + type.slice(1) + ' Report';

    // Distribute columns evenly across landscape A4 usable width (~782 px at 72 dpi)
    const pageUsableWidth = 782;
    const colWidth = Math.floor(pageUsableWidth / columns.length);
    const pdfCols = columns.map((c) => ({ header: c.header, width: colWidth }));
    const pdfRows = rows.map((row) =>
      columns.map((c) => String(row[c.key] ?? '')),
    );

    const doc = new PDFDocument({
      margin: 30,
      size: 'A4',
      layout: 'landscape',
    });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    // ── Header banner ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 62).fill('#1F4E79');

    doc
      .fill('white')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(title, 30, 14, { lineBreak: false });

    doc
      .fontSize(8)
      .font('Helvetica')
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 30, 38, {
        lineBreak: false,
      });

    if (startDate || endDate) {
      const s = startDate
        ? new Date(startDate).toLocaleDateString('en-IN')
        : 'All';
      const e = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'All';
      doc.text(`   |   Period: ${s} – ${e}`, {
        continued: true,
        lineBreak: false,
      });
    }

    doc.fill('#000000');

    // Move cursor below the banner and draw the table
    doc.y = 72;
    this.drawPdfTable(doc, pdfCols, pdfRows);

    // ── Page numbers ──────────────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange?.()?.count ?? 1;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(7)
        .font('Helvetica')
        .fill('#888888')
        .text(
          `Page ${i + 1} of ${totalPages}   |   Ziclo Reports   |   ${new Date().toLocaleDateString('en-IN')}`,
          30,
          doc.page.height - 25,
          { align: 'center' },
        );
    }

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  private async fetchExportData(
    type: ExportReportType,
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ): Promise<{
    columns: Array<{ header: string; key: string; width: number }>;
    rows: Record<string, unknown>[];
  }> {
    switch (type) {
      case 'overview':
        return this.fetchOverviewExportData();
      case 'revenue':
        return this.fetchRevenueExportData(dateWhere);
      case 'bookings':
        return this.fetchBookingsExportData(dateWhere);
      case 'customers':
        return this.fetchCustomersExportData(dateWhere);
      case 'workers':
        return this.fetchWorkersExportData();
      case 'managers':
        return this.fetchManagersExportData();
      case 'attendance':
        return this.fetchAttendanceExportData(dateWhere);
      case 'complaints':
        return this.fetchComplaintsExportData(dateWhere);
    }
  }

  private async fetchOverviewExportData() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [
      revMonth,
      revTotal,
      totalBookings,
      activeBookings,
      totalUsers,
      totalWorkers,
      totalManagers,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID, createdAt: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID },
        _sum: { total: true },
      }),
      this.prisma.booking.count(),
      this.prisma.booking.count({
        where: {
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.CONFIRMED,
              BookingStatus.ASSIGNED,
              BookingStatus.IN_PROGRESS,
            ],
          },
        },
      }),
      this.prisma.user.count({ where: { role: Role.USER } }),
      this.prisma.user.count({ where: { role: Role.WORKER } }),
      this.prisma.user.count({ where: { role: Role.MANAGER } }),
    ]);
    return {
      columns: [
        { header: 'Metric', key: 'metric', width: 32 },
        { header: 'Value', key: 'value', width: 20 },
      ],
      rows: [
        {
          metric: 'Revenue This Month (₹)',
          value: this.r2(revMonth._sum.total ?? 0),
        },
        {
          metric: 'Total Revenue (₹)',
          value: this.r2(revTotal._sum.total ?? 0),
        },
        { metric: 'Total Bookings', value: totalBookings },
        { metric: 'Active Bookings', value: activeBookings },
        { metric: 'Total Customers', value: totalUsers },
        { metric: 'Total Workers', value: totalWorkers },
        { metric: 'Total Managers', value: totalManagers },
      ],
    };
  }

  private async fetchRevenueExportData(
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ) {
    const where: Prisma.BookingWhereInput = { invoice: { isNot: null } };
    if (dateWhere) where.createdAt = dateWhere;
    const bookings = await this.prisma.booking.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        invoice: {
          select: {
            total: true,
            taxAmount: true,
            subtotal: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Booking Ref', key: 'bookingRef', width: 16 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Service', key: 'service', width: 22 },
        { header: 'Amount (₹)', key: 'amount', width: 14 },
        { header: 'Tax (₹)', key: 'taxAmount', width: 12 },
        { header: 'Net (₹)', key: 'netAmount', width: 12 },
        { header: 'Invoice Status', key: 'invoiceStatus', width: 16 },
        { header: 'Date', key: 'date', width: 14 },
      ],
      rows: bookings.map((b) => ({
        bookingRef: b.bookingRef ?? '',
        customer: b.customer?.name ?? '',
        service: b.service?.name ?? '',
        amount: this.r2(b.invoice?.total ?? 0),
        taxAmount: this.r2(b.invoice?.taxAmount ?? 0),
        netAmount: this.r2(b.invoice?.subtotal ?? 0),
        invoiceStatus: b.invoice?.status ?? '',
        date: b.createdAt.toLocaleDateString('en-IN'),
      })),
    };
  }

  private async fetchBookingsExportData(
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ) {
    const where: Prisma.BookingWhereInput = {};
    if (dateWhere) where.createdAt = dateWhere;
    const bookings = await this.prisma.booking.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        worker: { select: { name: true } },
        manager: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Booking Ref', key: 'bookingRef', width: 16 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Service', key: 'service', width: 22 },
        { header: 'Worker', key: 'worker', width: 18 },
        { header: 'Manager', key: 'manager', width: 18 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Amount (₹)', key: 'amount', width: 14 },
        { header: 'Date', key: 'date', width: 14 },
      ],
      rows: bookings.map((b) => ({
        bookingRef: b.bookingRef ?? '',
        customer: b.customer?.name ?? '',
        service: b.service?.name ?? '',
        worker: b.worker?.name ?? '',
        manager: b.manager?.name ?? '',
        status: b.status,
        amount: this.r2((b as any).totalAmount ?? 0),
        date: b.createdAt.toLocaleDateString('en-IN'),
      })),
    };
  }

  private async fetchCustomersExportData(
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ) {
    const where: Prisma.UserWhereInput = { role: Role.USER };
    if (dateWhere) where.createdAt = dateWhere;
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { customerBookings: true } },
      },
      orderBy: { name: 'asc' },
      take: 10_000,
    });
    const userIds = users.map((u) => u.id);
    const spendRows =
      userIds.length > 0
        ? await this.prisma.invoice.groupBy({
            by: ['customerId'],
            where: { customerId: { in: userIds } },
            _sum: { total: true },
          })
        : [];
    const spendMap = new Map(
      spendRows.map((r) => [r.customerId, r._sum.total ?? 0]),
    );
    return {
      columns: [
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Total Bookings', key: 'totalBookings', width: 16 },
        { header: 'Total Spent (₹)', key: 'totalSpent', width: 16 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Joined', key: 'joinedAt', width: 14 },
      ],
      rows: users.map((u) => ({
        name: u.name,
        email: u.email ?? '',
        phone: u.phone ?? '',
        totalBookings: u._count.customerBookings,
        totalSpent: this.r2(spendMap.get(u.id) ?? 0),
        status: u.isActive ? 'Active' : 'Inactive',
        joinedAt: u.createdAt.toLocaleDateString('en-IN'),
      })),
    };
  }

  private async fetchWorkersExportData() {
    const workers = await this.prisma.workerProfile.findMany({
      include: {
        user: { select: { name: true, phone: true, isActive: true } },
        area: { select: { name: true } },
      },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Area', key: 'area', width: 22 },
        { header: 'Status', key: 'status', width: 12 },
      ],
      rows: workers.map((w) => ({
        name: w.user.name,
        phone: w.user.phone ?? '',
        area: w.area?.name ?? '',
        status: w.user.isActive ? 'Active' : 'Inactive',
      })),
    };
  }

  private async fetchManagersExportData() {
    const managers = await this.prisma.managerProfile.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
            isActive: true,
            createdAt: true,
          },
        },
        officeLocation: { select: { name: true } },
      },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'Office', key: 'office', width: 24 },
        { header: 'Shift', key: 'shift', width: 12 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Joined', key: 'joinedAt', width: 14 },
      ],
      rows: managers.map((m) => ({
        name: m.user.name,
        email: m.user.email ?? '',
        phone: m.user.phone ?? '',
        office: m.officeLocation?.name ?? '',
        shift: m.shift ?? '',
        status: m.user.isActive ? 'Active' : 'Inactive',
        joinedAt: m.user.createdAt.toLocaleDateString('en-IN'),
      })),
    };
  }

  private async fetchAttendanceExportData(
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ) {
    const where: Prisma.AttendanceWhereInput = {};
    if (dateWhere) where.checkInTime = dateWhere;
    const records = await this.prisma.attendance.findMany({
      where,
      include: { user: { select: { name: true, role: true } } },
      orderBy: { checkInTime: 'desc' },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Role', key: 'role', width: 12 },
        { header: 'Check-in', key: 'checkIn', width: 22 },
        { header: 'Check-out', key: 'checkOut', width: 22 },
        { header: 'Status', key: 'status', width: 12 },
      ],
      rows: records.map((r) => ({
        name: r.user.name,
        role: r.user.role,
        checkIn: r.checkInTime.toLocaleString('en-IN'),
        checkOut: r.checkOutTime?.toLocaleString('en-IN') ?? '',
        status: r.status,
      })),
    };
  }

  private async fetchComplaintsExportData(
    dateWhere: { gte?: Date; lte?: Date } | undefined,
  ) {
    const where: Prisma.SupportTicketWhereInput = {};
    if (dateWhere) where.createdAt = dateWhere;
    const tickets = await this.prisma.supportTicket.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    return {
      columns: [
        { header: 'Ticket #', key: 'ticketNumber', width: 16 },
        { header: 'Title', key: 'title', width: 32 },
        { header: 'Customer', key: 'customer', width: 22 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Assigned To', key: 'assignedTo', width: 22 },
        { header: 'Created', key: 'createdAt', width: 14 },
      ],
      rows: tickets.map((t) => ({
        ticketNumber: t.ticketNumber ?? '',
        title: t.title,
        customer: t.customer?.name ?? '',
        priority: t.priority,
        status: t.status,
        assignedTo: t.assignedTo?.name ?? '',
        createdAt: t.createdAt.toLocaleDateString('en-IN'),
      })),
    };
  }

  // ─── Legacy Methods (preserved) ──────────────────────────────────────────────

  async getTasksSummary(query: ReportsQueryDto) {
    const where = this.buildTaskWhere(query);
    const [byStatus, byPriority, overdue] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.task.groupBy({ by: ['priority'], where, _count: true }),
      this.prisma.task.count({
        where: {
          ...where,
          dueDate: { lt: new Date() },
          status: { notIn: [TaskStatus.COMPLETED] },
        },
      }),
    ]);
    const total = byStatus.reduce((s, g) => s + g._count, 0);
    const completedCount =
      byStatus.find((g) => g.status === TaskStatus.COMPLETED)?._count ?? 0;
    const completionRate = total
      ? +((completedCount / total) * 100).toFixed(1)
      : 0;
    return {
      success: true,
      data: {
        total,
        completionRate,
        overdue,
        byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count])),
        byPriority: Object.fromEntries(
          byPriority.map((g) => [g.priority, g._count]),
        ),
      },
    };
  }

  async getWorkerPerformance(query: ReportsQueryDto) {
    const taskWhere = this.buildTaskWhere(query);
    const workers = await this.prisma.user.findMany({
      where: {
        role: 'WORKER',
        isActive: true,
        ...(query.pincodeId && {
          workerProfile: { pincodeId: query.pincodeId },
        }),
        ...(!query.pincodeId &&
          query.areaId && { workerProfile: { areaId: query.areaId } }),
        ...(query.workerId && { id: query.workerId }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        workerProfile: {
          select: { employeeCode: true, pincodeId: true, areaId: true },
        },
        assignedTasks: {
          where: taskWhere,
          select: {
            status: true,
            completedAt: true,
            dueDate: true,
            createdAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    const data = workers.map((w) => {
      const tasks = w.assignedTasks;
      const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
      const onTime = completed.filter(
        (t) => t.completedAt && t.completedAt <= t.dueDate,
      );
      const avgMs =
        completed.length > 0
          ? completed.reduce(
              (s, t) =>
                s +
                (t.completedAt
                  ? t.completedAt.getTime() - t.createdAt.getTime()
                  : 0),
              0,
            ) / completed.length
          : 0;
      return {
        id: w.id,
        name: w.name,
        email: w.email,
        employeeCode: w.workerProfile?.employeeCode ?? null,
        pincodeId: w.workerProfile?.pincodeId ?? null,
        areaId: w.workerProfile?.areaId ?? null,
        totalTasks: tasks.length,
        completedTasks: completed.length,
        onTimeCompletions: onTime.length,
        completionRate: tasks.length
          ? +((completed.length / tasks.length) * 100).toFixed(1)
          : 0,
        avgCompletionHours: avgMs ? +(avgMs / 3_600_000).toFixed(1) : 0,
      };
    });
    return { success: true, data };
  }

  async getCrmPipeline(query: ReportsQueryDto) {
    const [leadsByStatus, dealsByStage] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        orderBy: { stage: 'asc' },
        _count: { _all: true },
        _sum: { value: true },
      }),
    ]);
    const leads = Object.fromEntries(
      Object.values(LeadStatus).map((s) => {
        const row = leadsByStatus.find((r) => r.status === s);
        return [s, row?._count._all ?? 0];
      }),
    );
    const deals = Object.values(DealStage).map((stage) => {
      const row = dealsByStage.find((r) => r.stage === stage);
      return {
        stage,
        count: row?._count._all ?? 0,
        totalValue: this.r2(row?._sum?.value ?? 0),
      };
    });
    const totalLeads = Object.values(leads).reduce((s, v) => s + v, 0);
    const convertedLeads = leads[LeadStatus.WON] ?? 0;
    const activeDeals = deals
      .filter(
        (d) =>
          d.stage !== DealStage.CLOSED_WON && d.stage !== DealStage.CLOSED_LOST,
      )
      .reduce((s, d) => s + d.count, 0);
    const forecastValue = this.r2(
      deals
        .filter((d) => d.stage !== DealStage.CLOSED_LOST)
        .reduce((s, d) => s + d.totalValue, 0),
    );
    return {
      success: true,
      data: {
        totalLeads,
        convertedLeads,
        activeDeals,
        forecastValue,
        leads,
        deals,
      },
    };
  }

  async exportCsv(query: ExportQueryDto): Promise<string> {
    const { type } = query;
    if (type === ExportType.TASKS) {
      const tasks = await this.prisma.task.findMany({
        where: this.buildTaskWhere(query),
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          area: { select: { name: true } },
          pincode: { select: { pincode: true, city: true } },
          assignedManager: { select: { name: true } },
          assignedWorker: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return this.toCsv(
        tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          pincode: t.pincode ? `${t.pincode.pincode} (${t.pincode.city})` : '',
          area: t.area?.name ?? '',
          assignedManager: t.assignedManager?.name ?? '',
          assignedWorker: t.assignedWorker?.name ?? '',
          dueDate: t.dueDate.toISOString(),
          completedAt: t.completedAt?.toISOString() ?? '',
          createdAt: t.createdAt.toISOString(),
        })),
      );
    }
    if (type === ExportType.ATTENDANCE) {
      const { start, end } = this.buildLegacyDateRange(query);
      const records = await this.prisma.attendance.findMany({
        where: {
          checkInTime: { gte: start, lte: end },
          ...(query.workerId && { userId: query.workerId }),
        },
        select: {
          id: true,
          checkInTime: true,
          checkOutTime: true,
          status: true,
          user: { select: { name: true, email: true } },
          officeLocation: { select: { name: true } },
        },
        orderBy: { checkInTime: 'desc' },
      });
      return this.toCsv(
        records.map((r) => ({
          id: r.id,
          workerName: r.user.name,
          workerEmail: r.user.email,
          officeLocation: r.officeLocation.name,
          checkInTime: r.checkInTime.toISOString(),
          checkOutTime: r.checkOutTime?.toISOString() ?? '',
          status: r.status,
        })),
      );
    }
    const { data } = await this.getWorkerPerformance(query);
    return this.toCsv(data);
  }

  // ─── Private WHERE builders ───────────────────────────────────────────────────

  private buildRevenueWhere(
    query: RevenueReportQueryDto,
  ): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    if (dateWhere) where.createdAt = dateWhere;
    if (query.managerId) where.managerId = query.managerId;
    if (query.areaId)
      where.worker = { workerProfile: { areaId: query.areaId } };
    if (query.paymentMethod) {
      where.invoice = {
        is: { payments: { some: { method: query.paymentMethod } } },
      };
    } else {
      where.invoice = { isNot: null };
    }
    if (query.search) {
      where.OR = [
        { bookingRef: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  private buildBookingWhere(
    query: BookingReportQueryDto,
  ): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    if (dateWhere) where.createdAt = dateWhere;
    if (query.status) where.status = query.status;
    if (query.managerId) where.managerId = query.managerId;
    if (query.workerId) where.workerId = query.workerId;
    if (query.serviceId) where.serviceId = query.serviceId;
    if (query.areaId)
      where.worker = { workerProfile: { areaId: query.areaId } };
    if (query.search) {
      where.OR = [
        { bookingRef: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  private buildCustomerWhere(
    query: CustomerReportQueryDto,
  ): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { role: Role.USER };
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    if (dateWhere) where.createdAt = dateWhere;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
      ];
    }
    return where;
  }

  private async buildWorkerWhere(
    query: WorkerReportQueryDto,
  ): Promise<Prisma.UserWhereInput> {
    const where: Prisma.UserWhereInput = { role: Role.WORKER };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.workerId) where.id = query.workerId;

    const workerProfileFilter: Prisma.WorkerProfileWhereInput = {};
    if (query.managerId) {
      const areas = await this.prisma.managerArea.findMany({
        where: { manager: { userId: query.managerId } },
        select: { areaId: true },
      });
      workerProfileFilter.areaId =
        areas.length > 0 ? { in: areas.map((a) => a.areaId) } : undefined;
    } else if (query.areaId) {
      workerProfileFilter.areaId = query.areaId;
    }

    if (Object.keys(workerProfileFilter).length > 0) {
      where.workerProfile = workerProfileFilter;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        {
          workerProfile: {
            employeeCode: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    return where;
  }

  private buildManagerWhere(
    query: ManagerReportQueryDto,
  ): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { role: Role.MANAGER };
    if (query.managerId) where.id = query.managerId;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        {
          managerProfile: {
            employeeCode: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    return where;
  }

  private buildAttendanceWhere(
    query: AttendanceReportQueryDto,
  ): Prisma.AttendanceWhereInput {
    const type = query.type ?? 'worker';
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    const userFilter: Prisma.UserWhereInput = {
      role: type === 'worker' ? Role.WORKER : Role.MANAGER,
    };
    if (query.userId) userFilter.id = query.userId;
    if (query.areaId && type === 'worker')
      userFilter.workerProfile = { areaId: query.areaId };
    if (query.search)
      userFilter.name = { contains: query.search, mode: 'insensitive' };

    const where: Prisma.AttendanceWhereInput = { user: userFilter };
    if (dateWhere) where.checkInTime = dateWhere;
    return where;
  }

  private buildComplaintWhere(
    query: ComplaintReportQueryDto,
  ): Prisma.SupportTicketWhereInput {
    const where: Prisma.SupportTicketWhereInput = {};
    const dateWhere = this.buildDateWhere(query.startDate, query.endDate);
    if (dateWhere) where.createdAt = dateWhere;
    if (query.priority) where.priority = query.priority;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { ticketNumber: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private buildDateWhere(
    startDate?: string,
    endDate?: string,
  ): { gte?: Date; lte?: Date } | undefined {
    if (!startDate && !endDate) return undefined;
    const cond: { gte?: Date; lte?: Date } = {};
    if (startDate) cond.gte = new Date(startDate);
    if (endDate) {
      const d = new Date(endDate);
      d.setHours(23, 59, 59, 999);
      cond.lte = d;
    }
    return cond;
  }

  private buildChartDateRange(
    startDate?: string,
    endDate?: string,
  ): { start: Date; end: Date } {
    const end = endDate ? new Date(endDate) : new Date();
    if (endDate) end.setHours(23, 59, 59, 999);
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 86_400_000);
    return { start, end };
  }

  private buildPagination(page = 1, limit = 20) {
    return { skip: (page - 1) * limit, take: limit };
  }

  private buildMeta(total: number, page: number, limit: number) {
    return { total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private r2(n: number): number {
    return parseFloat(n.toFixed(2));
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async writeExcelResponse(
    res: Response,
    filename: string,
    columns: Array<{ header: string; key: string; width: number }>,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const wb = new Workbook();
    wb.creator = 'Ziclo Reports';
    wb.created = new Date();

    const ws = wb.addWorksheet('Report');
    ws.columns = columns;

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' },
    } as any;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    rows.forEach((row) => ws.addRow(row));

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: 'middle' };
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res as any);
    res.end();
  }

  private writePdfResponse(
    res: Response,
    filename: string,
    title: string,
    columns: Array<{ header: string; width: number }>,
    rows: string[][],
  ): void {
    const doc = new PDFDocument({
      margin: 30,
      size: 'A4',
      layout: 'landscape',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, {
        align: 'center',
      });
    doc.moveDown(0.5);

    this.drawPdfTable(doc, columns, rows);

    doc.end();
  }

  private drawPdfTable(
    doc: any,
    columns: Array<{ header: string; width: number }>,
    rows: string[][],
  ): void {
    const startX = 30;
    let y = doc.y + 5;

    doc.fontSize(8).font('Helvetica-Bold');
    let x = startX;
    columns.forEach((col) => {
      doc.text(col.header, x, y, { width: col.width - 4, ellipsis: true });
      x += col.width;
    });

    y += 14;
    doc
      .moveTo(startX, y - 2)
      .lineTo(startX + columns.reduce((s, c) => s + c.width, 0), y - 2)
      .stroke();

    doc.fontSize(7).font('Helvetica');
    for (const row of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }
      x = startX;
      columns.forEach((col, i) => {
        doc.text(row[i] ?? '', x, y, { width: col.width - 4, ellipsis: true });
        x += col.width;
      });
      y += 12;
    }
  }

  // ─── Legacy helpers (preserved) ───────────────────────────────────────────────

  private buildTaskWhere(query: ReportsQueryDto): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {};
    const { start, end } = this.buildLegacyDateRange(query);
    where.createdAt = { gte: start, lte: end };
    if (query.pincodeId) where.pincodeId = query.pincodeId;
    else if (query.areaId) where.areaId = query.areaId;
    if (query.managerId) where.assignedManagerId = query.managerId;
    if (query.workerId) where.assignedWorkerId = query.workerId;
    return where;
  }

  private buildLegacyDateRange(query: ReportsQueryDto): {
    start: Date;
    end: Date;
  } {
    const { start: todayStart } = getTodayRange();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return {
      start: query.startDate ? new Date(query.startDate) : thirtyDaysAgo,
      end: query.endDate
        ? new Date(query.endDate)
        : new Date(todayStart.getTime() + 86_400_000),
    };
  }

  private toCsv(data: Record<string, unknown>[]): string {
    if (!data.length) return '';
    const headers = Object.keys(data[0]);
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      headers.join(','),
      ...data.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  }
}
