import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AttendanceReportQueryDto } from './dto/attendance-report-query.dto';
import { BookingReportQueryDto } from './dto/booking-report-query.dto';
import { ChartsQueryDto } from './dto/charts-query.dto';
import { ComplaintReportQueryDto } from './dto/complaint-report-query.dto';
import { CustomerReportQueryDto } from './dto/customer-report-query.dto';
import { ExportReportQueryDto } from './dto/export-report-query.dto';
import { ManagerReportQueryDto } from './dto/manager-report-query.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { WorkerReportQueryDto } from './dto/worker-report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@Controller('reports')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dashboard summary cards — total revenue, bookings, jobs, customers, workers, managers, complaints',
  })
  @ApiOkResponse({ description: 'Dashboard summary data' })
  getDashboard(@Query() query: AdminReportQueryDto) {
    return this.reportsService.getDashboard(query);
  }

  // ─── Revenue Report ─────────────────────────────────────────────────────────

  @Get('revenue/export/excel')
  @ApiOperation({ summary: 'Export revenue report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async exportRevenueExcel(
    @Query() query: RevenueReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportRevenueExcel(query, res);
  }

  @Get('revenue/export/pdf')
  @ApiOperation({ summary: 'Export revenue report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportRevenuePdf(
    @Query() query: RevenueReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportRevenuePdf(query, res);
  }

  @Get('revenue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revenue report — paginated list of bookings with invoice, tax, payment details',
  })
  @ApiOkResponse({ description: 'Paginated revenue list' })
  getRevenueReport(@Query() query: RevenueReportQueryDto) {
    return this.reportsService.getRevenueReport(query);
  }

  // ─── Booking Report ─────────────────────────────────────────────────────────

  @Get('bookings/export/excel')
  @ApiOperation({ summary: 'Export bookings report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportBookingExcel(
    @Query() query: BookingReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportBookingExcel(query, res);
  }

  @Get('bookings/export/pdf')
  @ApiOperation({ summary: 'Export bookings report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportBookingPdf(
    @Query() query: BookingReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportBookingPdf(query, res);
  }

  @Get('bookings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bookings report — paginated list with status, customer, service, area, manager, worker, amount',
  })
  @ApiOkResponse({ description: 'Paginated booking list' })
  getBookingReport(@Query() query: BookingReportQueryDto) {
    return this.reportsService.getBookingReport(query);
  }

  // ─── Customer Report ─────────────────────────────────────────────────────────

  @Get('customers/export/excel')
  @ApiOperation({ summary: 'Export customer report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportCustomerExcel(
    @Query() query: CustomerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportCustomerExcel(query, res);
  }

  @Get('customers/export/pdf')
  @ApiOperation({ summary: 'Export customer report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportCustomerPdf(
    @Query() query: CustomerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportCustomerPdf(query, res);
  }

  @Get('customers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Customer report — name, phone, total bookings, total spent, last booking, status',
  })
  @ApiOkResponse({ description: 'Paginated customer list' })
  getCustomerReport(@Query() query: CustomerReportQueryDto) {
    return this.reportsService.getCustomerReport(query);
  }

  // ─── Worker Report ──────────────────────────────────────────────────────────

  @Get('workers/export/excel')
  @ApiOperation({ summary: 'Export worker report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportWorkerExcel(
    @Query() query: WorkerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportWorkerExcel(query, res);
  }

  @Get('workers/export/pdf')
  @ApiOperation({ summary: 'Export worker report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportWorkerPdf(
    @Query() query: WorkerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportWorkerPdf(query, res);
  }

  @Get('workers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Worker report — worker, area, manager, completed jobs, pending jobs, earnings, attendance %',
  })
  @ApiOkResponse({ description: 'Paginated worker list' })
  getWorkerReport(@Query() query: WorkerReportQueryDto) {
    return this.reportsService.getWorkerReport(query);
  }

  // ─── Manager Report ─────────────────────────────────────────────────────────

  @Get('managers/export/excel')
  @ApiOperation({ summary: 'Export manager report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportManagerExcel(
    @Query() query: ManagerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportManagerExcel(query, res);
  }

  @Get('managers/export/pdf')
  @ApiOperation({ summary: 'Export manager report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportManagerPdf(
    @Query() query: ManagerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportManagerPdf(query, res);
  }

  @Get('managers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manager report — manager, office, area, worker count, completed/pending jobs, revenue. ' +
      'Supports managerId to fetch a single manager.',
  })
  @ApiOkResponse({ description: 'Paginated manager list' })
  getManagerReport(@Query() query: ManagerReportQueryDto) {
    return this.reportsService.getManagerReport(query);
  }

  // ─── Attendance Report ───────────────────────────────────────────────────────

  @Get('attendance/export/excel')
  @ApiOperation({ summary: 'Export attendance report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportAttendanceExcel(
    @Query() query: AttendanceReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportAttendanceExcel(query, res);
  }

  @Get('attendance/export/pdf')
  @ApiOperation({ summary: 'Export attendance report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportAttendancePdf(
    @Query() query: AttendanceReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportAttendancePdf(query, res);
  }

  @Get('attendance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Attendance report — employee, check-in, check-out, working hours, status. Use ?type=worker (default) or ?type=manager',
  })
  @ApiOkResponse({ description: 'Paginated attendance list' })
  getAttendanceReport(@Query() query: AttendanceReportQueryDto) {
    return this.reportsService.getAttendanceReport(query);
  }

  // ─── Complaint Report ────────────────────────────────────────────────────────

  @Get('complaints/export/excel')
  @ApiOperation({ summary: 'Export complaints report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportComplaintExcel(
    @Query() query: ComplaintReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportComplaintExcel(query, res);
  }

  @Get('complaints/export/pdf')
  @ApiOperation({ summary: 'Export complaints report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportComplaintPdf(
    @Query() query: ComplaintReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportComplaintPdf(query, res);
  }

  @Get('complaints')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complaints report — ticket number, customer, priority, status, assigned agent, dates',
  })
  @ApiOkResponse({ description: 'Paginated complaint list' })
  getComplaintReport(@Query() query: ComplaintReportQueryDto) {
    return this.reportsService.getComplaintReport(query);
  }

  // ─── Tax Report ──────────────────────────────────────────────────────────────

  @Get('tax/export/excel')
  @ApiOperation({ summary: 'Export tax report as Excel (.xlsx)' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ description: 'Excel file download' })
  async exportTaxExcel(
    @Query() query: AdminReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportTaxExcel(query, res);
  }

  @Get('tax/export/pdf')
  @ApiOperation({ summary: 'Export tax report as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download' })
  async exportTaxPdf(
    @Query() query: AdminReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.reportsService.exportTaxPdf(query, res);
  }

  @Get('tax')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Tax report — invoice, booking, subtotal, GST rate, tax amount, total. Includes summary totals.',
  })
  @ApiOkResponse({ description: 'Paginated tax/invoice list with summary' })
  getTaxReport(@Query() query: AdminReportQueryDto) {
    return this.reportsService.getTaxReport(query);
  }

  // ─── Charts ──────────────────────────────────────────────────────────────────

  @Get('charts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'All chart data — revenue trend, booking trend, top services, top workers, top managers, payment methods, complaint status',
  })
  @ApiOkResponse({ description: 'Chart datasets' })
  getCharts(@Query() query: ChartsQueryDto) {
    return this.reportsService.getCharts(query);
  }

  // ─── Legacy endpoints (preserved) ────────────────────────────────────────────

  @Get('tasks-summary')
  @ApiOperation({
    summary: 'Task completion rates by status and priority (legacy)',
  })
  @ApiOkResponse({ description: 'Task summary report' })
  getTasksSummary(@Query() query: ReportsQueryDto) {
    return this.reportsService.getTasksSummary(query);
  }

  @Get('worker-performance')
  @ApiOperation({ summary: 'Per-worker task completion metrics (legacy)' })
  @ApiOkResponse({ description: 'Worker performance metrics list' })
  getWorkerPerformance(@Query() query: ReportsQueryDto) {
    return this.reportsService.getWorkerPerformance(query);
  }

  @Get('crm-pipeline')
  @ApiOperation({
    summary:
      'CRM pipeline — lead counts by status, deal counts and forecast value by stage',
  })
  @ApiOkResponse({ description: 'CRM pipeline report' })
  getCrmPipeline(@Query() query: ReportsQueryDto) {
    return this.reportsService.getCrmPipeline(query);
  }

  @Get('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a report file and return a download URL',
    description:
      'Generates a real `.xlsx` or `.pdf` report for the requested type and optional date range. ' +
      'The file is written to `/exports` on the server and served as a static asset. ' +
      'The response includes a direct download URL that remains valid for **1 hour**. ' +
      'Supported types: `overview`, `revenue`, `bookings`, `customers`, `workers`, `managers`, `attendance`, `complaints`. ' +
      'Supported formats: `excel` (xlsx), `pdf`.',
  })
  @ApiOkResponse({
    description: 'File generated successfully — download URL returned',
    schema: {
      example: {
        success: true,
        message: 'Report generated successfully.',
        data: {
          downloadUrl:
            'http://192.168.1.9:3000/exports/Revenue_Report_June_2026.xlsx',
          fileName: 'Revenue_Report_June_2026.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          expiresAt: '2026-07-01T18:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error — invalid type or format',
    schema: {
      example: {
        success: false,
        message: 'Validation failed',
        errors: [
          'type must be one of: overview, revenue, bookings, customers, workers, managers, attendance, complaints',
        ],
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'File generation failed',
    schema: {
      example: { success: false, message: 'Unable to generate report.' },
    },
  })
  async exportReport(@Query() query: ExportReportQueryDto) {
    return this.reportsService.generateExport(query);
  }
}
