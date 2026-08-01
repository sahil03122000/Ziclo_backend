import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { AreasService } from '../areas/areas.service';
import { AreaQueryDto } from '../areas/dto/area-query.dto';
import { CreateAreaDto } from '../areas/dto/create-area.dto';
import { UpdateAreaDto } from '../areas/dto/update-area.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateOfficeLocationDto } from '../office-locations/dto/create-office-location.dto';
import { OfficeLocationQueryDto } from '../office-locations/dto/office-location-query.dto';
import { UpdateOfficeLocationDto } from '../office-locations/dto/update-office-location.dto';
import { OfficeLocationsService } from '../office-locations/office-locations.service';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AdminService } from './admin.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import {
  NotificationSettings,
  UpdateNotificationSettingsDto,
} from './dto/notification-settings.dto';
import {
  AttendanceRulesResponseDto,
  UpdateAttendanceRulesDto,
} from './dto/attendance-rules.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { QuerySupportTicketsDto } from './dto/query-support-tickets.dto';
import { UpdateOrgSettingsDto } from './dto/org-settings.dto';
import { QueryManagersDto } from './dto/query-managers.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { QueryWorkersDto } from './dto/query-workers.dto';
import { QueryLiveWorkersDto } from './dto/query-live-workers.dto';
import { QueryLiveTrackingDto } from './dto/query-live-tracking.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { QueryShiftsDto } from './dto/query-shifts.dto';

@ApiTags('Admin / Staff')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly areasService: AreasService,
    private readonly officeLocationsService: OfficeLocationsService,
  ) {}

  // ─── Areas ────────────────────────────────────────────────────────────────────

  @Get('areas')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'List all areas — ADMIN',
    description:
      'Paginated list of service areas. Supports search by name/city/state, filtering by ' +
      'active status, and filtering by office location via officeLocationId (single UUID) or ' +
      'officeLocationIds (comma-separated, repeated values, or a single UUID). Empty values are ignored.',
  })
  @ApiOkResponse({
    description: 'Paginated area list',
    schema: {
      example: {
        success: true,
        data: {
          areas: [
            {
              id: 'uuid',
              name: 'South Bangalore',
              city: 'Bangalore',
              state: 'Karnataka',
              isActive: true,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { total: 12, page: 1, limit: 20, totalPages: 1 },
        },
      },
    },
  })
  getAreas(@Query() query: AreaQueryDto) {
    return this.areasService.findAll(query);
  }

  @Get('areas/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Area detail — ADMIN' })
  @ApiParam({ name: 'id', description: 'Area UUID' })
  @ApiOkResponse({
    description: 'Area detail with office locations and assigned manager',
  })
  @ApiNotFoundResponse({ description: 'Area not found' })
  getArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.areasService.findOne(id);
  }

  @Post('areas')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create area — ADMIN' })
  @ApiBody({ type: CreateAreaDto })
  @ApiCreatedResponse({ description: 'Area created' })
  createArea(@Body() dto: CreateAreaDto, @CurrentUser() actor: AuthUser) {
    return this.areasService.create(dto, actor.id, actor.name);
  }

  @Patch('areas/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update area — ADMIN' })
  @ApiParam({ name: 'id', description: 'Area UUID' })
  @ApiBody({ type: UpdateAreaDto })
  @ApiOkResponse({ description: 'Area updated' })
  @ApiNotFoundResponse({ description: 'Area not found' })
  updateArea(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.areasService.update(id, dto, actor.id, actor.name);
  }

  @Delete('areas/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'Delete area — ADMIN',
    description:
      'Hard-deletes the area. Returns 409 if the area is referenced by any Office Location, Manager, Worker, or Task.',
  })
  @ApiParam({ name: 'id', description: 'Area UUID' })
  @ApiOkResponse({
    description: 'Area deleted',
    schema: {
      example: { success: true, message: 'Area deleted successfully.' },
    },
  })
  @ApiNotFoundResponse({ description: 'Area not found' })
  @ApiResponse({
    status: 409,
    description: 'Area is assigned to existing records — cannot delete',
    schema: {
      example: {
        success: false,
        message:
          'Cannot delete Area because it is assigned to existing records.',
      },
    },
  })
  deleteArea(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.areasService.delete(id, actor.id, actor.name);
  }

  // ─── Office Locations ─────────────────────────────────────────────────────────

  @Get('office-locations')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'List all office locations — ADMIN',
    description:
      'Paginated list of geofenced office locations. Supports search by name, filter by areaId and active status.',
  })
  @ApiOkResponse({
    description: 'Paginated office location list',
    schema: {
      example: {
        success: true,
        data: {
          officeLocations: [
            {
              id: 'uuid',
              name: 'Koramangala Office',
              latitude: 12.9352,
              longitude: 77.6245,
              radius: 200,
              isActive: true,
              area: { id: 'uuid', name: 'South Bangalore' },
            },
          ],
          meta: { total: 8, page: 1, limit: 20, totalPages: 1 },
        },
      },
    },
  })
  getOfficeLocations(@Query() query: OfficeLocationQueryDto) {
    return this.officeLocationsService.findAll(query);
  }

  @Get('office-locations/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Office location detail — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID' })
  @ApiOkResponse({
    description: 'Office location detail with area and manager counts',
  })
  @ApiNotFoundResponse({ description: 'Office location not found' })
  getOfficeLocation(@Param('id', ParseUUIDPipe) id: string) {
    return this.officeLocationsService.findOne(id);
  }

  @Post('office-locations')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create office location — ADMIN' })
  @ApiBody({ type: CreateOfficeLocationDto })
  @ApiCreatedResponse({ description: 'Office location created' })
  createOfficeLocation(
    @Body() dto: CreateOfficeLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.officeLocationsService.create(dto, actor.id, actor.name);
  }

  @Patch('office-locations/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update office location — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID' })
  @ApiBody({ type: UpdateOfficeLocationDto })
  @ApiOkResponse({ description: 'Office location updated' })
  @ApiNotFoundResponse({ description: 'Office location not found' })
  updateOfficeLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfficeLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.officeLocationsService.update(id, dto, actor.id, actor.name);
  }

  @Delete('office-locations/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft-deactivate office location — ADMIN' })
  @ApiParam({ name: 'id', description: 'Office location UUID' })
  @ApiOkResponse({ description: 'Office location deactivated' })
  @ApiNotFoundResponse({ description: 'Office location not found' })
  deleteOfficeLocation(@Param('id', ParseUUIDPipe) id: string) {
    return this.officeLocationsService.remove(id);
  }

  // ─── Organization Settings ────────────────────────────────────────────────────

  @Get('settings')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get organization settings — ADMIN',
    description:
      'Returns the current organization-level system settings. ' +
      'Falls back to platform defaults if a value has never been configured.',
  })
  @ApiOkResponse({
    description: 'Organization settings',
    schema: {
      example: {
        success: true,
        message: 'Settings fetched successfully',
        data: {
          taxPercentage: 18,
          advancePaymentPercentage: 20,
          maxActiveSessions: 3,
        },
      },
    },
  })
  getOrgSettings() {
    return this.adminService.getOrgSettings();
  }

  @Patch('settings')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update organization settings — ADMIN',
    description:
      'Partially updates one or more organization-level settings. ' +
      'Only the fields provided in the request body are updated; omitted fields are left unchanged. ' +
      'All changes are logged to the activity log.',
  })
  @ApiBody({ type: UpdateOrgSettingsDto })
  @ApiOkResponse({
    description:
      'Settings updated — returns the full settings object after the update',
    schema: {
      example: {
        success: true,
        message: 'Settings updated successfully',
        data: {
          taxPercentage: 20,
          advancePaymentPercentage: 25,
          maxActiveSessions: 5,
        },
      },
    },
  })
  updateOrgSettings(
    @Body() dto: UpdateOrgSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateOrgSettings(dto, actor);
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  @Get('stats')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dashboard KPI stats — revenue, bookings, users, workers, managers',
  })
  @ApiOkResponse({
    description: 'Stats summary',
    schema: {
      example: {
        success: true,
        data: {
          revenueThisMonth: 50000,
          revenueTotal: 320000,
          totalBookings: 480,
          activeBookings: 32,
          totalUsers: 220,
          totalWorkers: 45,
          totalManagers: 8,
        },
      },
    },
  })
  getStats() {
    return this.adminService.getStats();
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────

  @Get('analytics')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin analytics — booking trend, top services, top workers by period',
    description: 'period: today | week | month | year',
  })
  @ApiOkResponse({
    description: 'Analytics data for the requested period',
    schema: {
      example: {
        success: true,
        data: {
          bookings: [
            { date: '2026-06-01', count: 12 },
            { date: '2026-06-02', count: 9 },
          ],
          topServices: [{ id: 'uuid', name: 'AC Service', count: 84 }],
          topWorkers: [{ id: 'uuid', name: 'Ravi Kumar', count: 42 }],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid period value' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — ADMIN / SUPER_ADMIN / ORGANIZATION_ADMIN required',
  })
  getAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.adminService.getAnalytics(query);
  }

  // ─── Customers ───────────────────────────────────────────────────────────────

  @Get('users')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'List all customers (USER role) — ADMIN',
    description:
      'Returns paginated customer accounts with booking counts and total spend. ' +
      'Supports search by name, email, or phone and filtering by active status.',
  })
  @ApiOkResponse({
    description: 'Paginated customer list',
    schema: {
      example: {
        success: true,
        message: 'Users fetched successfully',
        data: {
          items: [
            {
              id: 'uuid',
              name: 'Rahul Sharma',
              email: 'rahul@example.com',
              phone: '9876543210',
              profileImage: 'https://cdn.example.com/img.jpg',
              isActive: true,
              createdAt: '2026-06-26T12:00:00.000Z',
              totalBookings: 15,
              totalSpent: 4200,
            },
          ],
          pagination: { page: 1, limit: 20, total: 150, totalPages: 8 },
        },
      },
    },
  })
  getCustomers(@Query() query: QueryCustomersDto) {
    return this.adminService.getCustomers(query);
  }

  @Get('users/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'Get customer detail — ADMIN',
    description:
      'Returns full profile, booking statistics, total spend, saved addresses, and the 5 most recent bookings for a single customer account.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiOkResponse({
    description: 'Customer detail',
    schema: {
      example: {
        success: true,
        message: 'Customer fetched successfully',
        data: {
          id: 'uuid',
          name: 'Rahul Sharma',
          email: 'rahul@example.com',
          phone: '9876543210',
          profileImage: 'https://cdn.example.com/img.jpg',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-06-26T12:00:00.000Z',
          totalBookings: 15,
          completedBookings: 12,
          cancelledBookings: 2,
          pendingBookings: 1,
          totalSpent: 5400,
          addresses: [
            {
              id: 'uuid',
              label: 'Home',
              addressType: 'HOME',
              houseNo: '12A',
              street: 'MG Road',
              landmark: 'Near Metro',
              city: 'Bengaluru',
              state: 'Karnataka',
              pincode: '560001',
              isDefault: true,
            },
          ],
          recentBookings: [
            {
              id: 'uuid',
              bookingNumber: 'BK-20240001',
              serviceName: 'AC Service',
              status: 'COMPLETED',
              amount: 1200,
              createdAt: '2026-06-20T10:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  getCustomerById(@Param('id') id: string) {
    return this.adminService.getCustomerById(id);
  }

  @Patch('users/:id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate or deactivate a user — ADMIN',
    description:
      'Sets the `isActive` flag on any user (customer, worker, or manager). ' +
      'Does not delete any data — bookings, invoices, attendance, and audit logs are fully preserved. ' +
      'An admin cannot deactivate their own account.',
  })
  @ApiParam({ name: 'id', description: 'Target user UUID' })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({
    description: 'Status updated',
    schema: {
      example: {
        success: true,
        message: 'User status updated successfully',
        data: { id: 'uuid', isActive: false },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateUserStatus(id, dto, actor);
  }

  // ─── Managers ─────────────────────────────────────────────────────────────────

  @Post('managers')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new manager — ADMIN',
    description:
      'Creates a User account with role MANAGER and a linked ManagerProfile in a single atomic transaction. ' +
      'An employee code (MGR-XXXXXX) is auto-generated. ' +
      'Returns 409 if email or phone is already in use. Use shiftId (validated against the real ' +
      'Shift table — must exist and be active) to assign a shift; the legacy hardcoded shift enum ' +
      'is now fully optional and only kept for backward compatibility. Other optional fields: ' +
      'gender, dateOfBirth, address, employmentType (MONTHLY | COMMISSION), monthlySalary ' +
      '(required and > 0 when MONTHLY), ' +
      'bankDetails (accountHolderName, bankName, branchName, accountNumber, ifscCode, upiId), ' +
      'remarks, aadhaarNumber, aadhaarFrontImage, aadhaarBackImage, panNumber, panImage — the ' +
      'exact same identity document fields as the Worker create API.',
  })
  @ApiBody({ type: CreateManagerDto })
  @ApiCreatedResponse({
    description: 'Manager created successfully',
    schema: {
      example: {
        success: true,
        message: 'Manager created successfully',
        data: {
          id: 'uuid',
          name: 'Rahul Sharma',
          email: 'rahul@example.com',
          phone: '9876543210',
          role: 'MANAGER',
          profileImage: 'https://cdn.example.com/avatars/manager.jpg',
          isActive: true,
          createdAt: '2026-06-21T10:00:00.000Z',
          employeeCode: 'MGR-3A9F2C',
          shift: 'MORNING',
          officeLocationId: 'uuid1',
          officeLocation: { id: 'uuid1', name: 'Koramangala Office' },
          officeLocationIds: ['uuid1', 'uuid2'],
          officeLocations: [
            { id: 'uuid1', name: 'Koramangala Office' },
            { id: 'uuid2', name: 'HSR Layout Office' },
          ],
          areaIds: ['areaUuid1'],
          assignedAreas: [{ id: 'areaUuid1', name: 'Koramangala' }],
          areas: [{ id: 'areaUuid1', name: 'Koramangala' }],
          employmentType: 'MONTHLY',
          monthlySalary: 45000,
          bankDetails: {
            accountHolderName: 'Rahul Sharma',
            bankName: 'State Bank of India',
            branchName: 'MG Road Branch',
            accountNumber: '123456789012',
            ifscCode: 'SBIN0001234',
            upiId: 'rahul@okhdfcbank',
          },
          remarks: null,
          aadhaarNumber: null,
          aadhaarFrontImage: null,
          aadhaarBackImage: null,
          panNumber: null,
          panImage: null,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error, invalid area/office combination, or inactive office location',
  })
  @ApiResponse({
    status: 404,
    description: 'Office location or area not found',
  })
  @ApiResponse({ status: 409, description: 'Email or phone already in use' })
  createManager(@Body() dto: CreateManagerDto, @CurrentUser() actor: AuthUser) {
    const { password: _pw, ...loggable } = dto;
    this.logger.log(
      `[createManager] Incoming DTO: ${JSON.stringify(loggable)}`,
    );
    return this.adminService.createManager(dto, actor);
  }

  @Get('managers')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List all managers — ADMIN',
    description:
      "Returns paginated managers with their office location, shift, today's attendance status " +
      '(`todayAttendanceStatus`: PRESENT | ABSENT | HALF_DAY | LEAVE | NO_CHECKIN — only PRESENT ' +
      'and NO_CHECKIN are currently reachable; this schema has no half-day/leave tracking), ' +
      'and worker headcount (totalWorkers / presentWorkers / absentWorkers, derived from each ' +
      "manager's own assigned areas — same source as the manager dashboard). " +
      'Supports search by name/email/phone and filtering by active status.',
  })
  @ApiOkResponse({
    description: 'Paginated manager list',
    schema: {
      example: {
        success: true,
        data: {
          managers: [
            {
              id: 'uuid',
              name: 'Rahul Sharma',
              email: 'rahul@example.com',
              phone: '+919876543210',
              profileImage: 'https://cdn.example.com/img.jpg',
              officeLocation: { id: 'uuid', name: 'Head Office' },
              shift: 'MORNING',
              isActive: true,
              todayAttendanceStatus: 'PRESENT',
              createdAt: '2026-01-15T10:00:00.000Z',
              totalWorkers: 12,
              presentWorkers: 9,
              absentWorkers: 3,
            },
          ],
          meta: { total: 42, page: 1, limit: 20, totalPages: 3 },
        },
      },
    },
  })
  getManagers(@Query() query: QueryManagersDto) {
    console.log('[AdminController] Managers Query:', JSON.stringify(query));
    return this.adminService.getManagers(query);
  }

  @Get('managers/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'Get manager detail — ADMIN',
    description:
      'Returns full profile for a single manager including all assigned office locations and areas ' +
      "(so an edit screen can be prefilled), today's attendance status, total workers under " +
      "management, last login time, and the manager's own team as `workers[]` (id, name, " +
      'profileImage, phone, office, areas, shift, employmentType, salary, commission, ' +
      'attendanceStatus) — the People module should reach worker records through this, not ' +
      'through a standalone worker list. Also includes gender/dateOfBirth/address, bankDetails, ' +
      'aadhaar, pan, remarks, `commission`/`commissionConfiguration` (always empty — no ' +
      'ManagerCommission table exists), `attendanceSummary` (current calendar month only — ' +
      '{present, absent, halfDay, leave, workingHours, attendancePercentage}; halfDay/leave are ' +
      'always 0, not tracked), and `workSummary` (totalWorkers/completedJobs/pendingJobs).',
  })
  @ApiParam({ name: 'id', description: 'Manager user UUID' })
  @ApiOkResponse({
    description: 'Manager detail',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          name: 'Sahil Manager',
          email: 'alwarghar7@gmail.com',
          phone: '9638527410',
          employeeCode: 'MGR-3A9F2C',
          profileImage: 'http://192.168.1.9:3000/uploads/images/manager.jpg',
          officeLocationId: 'uuid1',
          officeLocation: { id: 'uuid1', name: 'HDQ ATELI MANDI' },
          officeLocationIds: ['uuid1', 'uuid2'],
          officeLocations: [
            { id: 'uuid1', name: 'HDQ ATELI MANDI' },
            { id: 'uuid2', name: 'Narnaul Office' },
          ],
          area: { id: 'areaUuid1', name: 'Ateli Area' },
          areaIds: ['areaUuid1', 'areaUuid2'],
          assignedAreas: [
            { id: 'areaUuid1', name: 'Ateli Area' },
            { id: 'areaUuid2', name: 'Narnaul Area' },
          ],
          areas: [
            { id: 'areaUuid1', name: 'Ateli Area' },
            { id: 'areaUuid2', name: 'Narnaul Area' },
          ],
          shift: 'MORNING',
          isActive: true,
          todayAttendanceStatus: 'Absent',
          totalWorkers: 18,
          createdAt: '2026-06-30T07:28:51.350Z',
          lastLogin: '2026-06-30T09:15:00.000Z',
          employmentType: 'MONTHLY',
          monthlySalary: 45000,
          bankDetails: {
            accountHolderName: 'Sahil Manager',
            bankName: 'State Bank of India',
            branchName: 'MG Road Branch',
            accountNumber: '123456789012',
            ifscCode: 'SBIN0001234',
            upiId: 'sahil@okhdfcbank',
          },
          remarks: null,
          aadhaarNumber: null,
          aadhaarFrontImage: null,
          aadhaarBackImage: null,
          panNumber: null,
          panImage: null,
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Manager not found',
    schema: {
      example: {
        success: false,
        statusCode: 404,
        message: 'Manager not found',
      },
    },
  })
  getManagerById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getManagerById(id);
  }

  @Patch('managers/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update manager profile — ADMIN',
    description:
      "Partially updates a manager's profile. All fields are optional — only provided fields are changed; " +
      'existing data is never cleared just because a field is omitted. Email and phone must remain unique. ' +
      'gender, dateOfBirth, and address are each updated independently when sent. ' +
      "officeLocationIds fully replaces the manager's office assignments (all must exist and be active); " +
      'areaIds fully replaces area assignments (each area must belong to at least one of the effective ' +
      'office locations). When employmentType is sent as MONTHLY, monthlySalary is required (> 0) in the ' +
      'same request. bankDetails sub-fields (accountHolderName, bankName, branchName, accountNumber, ' +
      'ifscCode, upiId) are each updated independently — sending only one sub-field leaves the rest ' +
      'untouched. aadhaarNumber, aadhaarFrontImage, aadhaarBackImage, panNumber, panImage, and ' +
      'remarks are also supported — the exact same identity document fields as the Worker APIs. ' +
      "If aadhaarFrontImage/aadhaarBackImage/panImage/profileImage aren't sent, the existing " +
      'image is kept unchanged (reuse the shared POST /api/v1/uploads/image?type=manager ' +
      'endpoint to get a new URL first). shiftId (if sent) must reference an existing, active Shift.',
  })
  @ApiParam({ name: 'id', description: 'Manager user UUID' })
  @ApiBody({ type: UpdateManagerDto })
  @ApiOkResponse({
    description: 'Manager updated',
    schema: {
      example: {
        success: true,
        message: 'Manager updated successfully.',
        data: {
          id: 'uuid',
          name: 'Rahul Sharma',
          email: 'rahul@example.com',
          phone: '9876543210',
          officeLocationId: 'uuid1',
          officeLocation: { id: 'uuid1', name: 'HDQ ATELI MANDI' },
          officeLocationIds: ['uuid1', 'uuid2'],
          officeLocations: [
            { id: 'uuid1', name: 'HDQ ATELI MANDI' },
            { id: 'uuid2', name: 'Narnaul Office' },
          ],
          shift: 'MORNING',
          profileImage: 'https://cdn.example.com/images/manager.jpg',
          areaIds: ['areaUuid1'],
          assignedAreas: [{ id: 'areaUuid1', name: 'Ateli Area' }],
          areas: [{ id: 'areaUuid1', name: 'Ateli Area' }],
          employmentType: 'MONTHLY',
          monthlySalary: 45000,
          bankDetails: {
            accountHolderName: 'Rahul Sharma',
            bankName: 'State Bank of India',
            branchName: 'MG Road Branch',
            accountNumber: '123456789012',
            ifscCode: 'SBIN0001234',
            upiId: 'rahul@okhdfcbank',
          },
          remarks: null,
          aadhaarNumber: null,
          aadhaarFrontImage: null,
          aadhaarBackImage: null,
          panNumber: null,
          panImage: null,
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Manager, office location, or area not found',
    schema: {
      example: {
        success: false,
        statusCode: 404,
        message: 'Manager not found',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone already in use',
    schema: {
      example: {
        success: false,
        statusCode: 409,
        message: 'A user with this email already exists',
      },
    },
  })
  updateManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateManager(id, dto, actor);
  }

  @Patch('managers/:id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate or deactivate a manager — ADMIN',
    description:
      'Sets the `isActive` flag on a manager and cascades the same status to all workers ' +
      "assigned to that manager's areas. All changes are applied in a single transaction.",
  })
  @ApiParam({ name: 'id', description: 'Manager user UUID' })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({
    description: 'Manager status updated',
    schema: {
      example: {
        success: true,
        message: 'Manager status updated successfully.',
        data: { id: 'uuid', isActive: false },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Manager not found',
    schema: {
      example: {
        success: false,
        statusCode: 404,
        message: 'Manager not found',
      },
    },
  })
  updateManagerStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateManagerStatus(id, dto, actor);
  }

  // ─── Workers ──────────────────────────────────────────────────────────────────

  @Get('workers')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List all workers — ADMIN (Attendance Report)',
    description:
      'Returns every active worker for the requested date range (defaults to today), left-joining ' +
      'attendance so the worker is always included even if they have no attendance record — ' +
      'shown as ABSENT with checkInTime/checkOutTime null and workingHours "00:00". ' +
      '`attendanceStatus` is: `CHECKED_IN`, `CHECKED_OUT`, or `ABSENT`. ' +
      '`officeLocationId` only narrows which attendance record is joined in — it never excludes a worker. ' +
      'Supports search by name/phone/employee code and filtering by status or managerId. ' +
      'Optional params are never rejected when sent empty. ' +
      'Powers the Attendance Report screen only — the People module must not use this as a ' +
      'standalone worker directory; workers are reached there via GET /admin/managers/:id, ' +
      "whose `workers[]` array is scoped to that manager's own team.",
  })
  @ApiOkResponse({
    description: 'Paginated worker list',
    schema: {
      example: {
        success: true,
        data: {
          workers: [
            {
              id: 'uuid',
              workerId: 'uuid',
              employeeCode: 'WRK-1001',
              name: 'Rahul Sharma',
              phone: '9876543210',
              officeLocation: { id: 'uuid', name: 'Delhi Office' },
              manager: { id: 'uuid', name: 'Sahil Manager' },
              attendanceStatus: 'CHECKED_IN',
              todayAttendanceStatus: 'Present',
              checkInTime: '09:10',
              checkOutTime: null,
              workingHours: '03:45',
              isActive: true,
            },
            {
              id: 'uuid',
              employeeCode: 'WRK-1002',
              name: 'Priya Singh',
              phone: '9876500000',
              officeLocation: null,
              manager: { id: 'uuid', name: 'Sahil Manager' },
              attendanceStatus: 'ABSENT',
              todayAttendanceStatus: 'Absent',
              checkInTime: null,
              checkOutTime: null,
              workingHours: '00:00',
              isActive: true,
            },
          ],
          meta: { total: 12, page: 1, limit: 100, totalPages: 1 },
        },
      },
    },
  })
  getWorkers(@Query() query: QueryWorkersDto) {
    console.log('[AdminController] Workers Query:', JSON.stringify(query));
    return this.adminService.getWorkers(query);
  }

  @Get('workers/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get full worker details — ADMIN',
    description:
      "Looks the worker up by either id returned from the workers list — `id` (the worker's " +
      "User id) or `workerId` (the WorkerProfile's own primary key) — never by employeeCode. " +
      'Returns 404 only if no worker matches either id. Includes profile (profileImage, name, ' +
      'email, phone, gender, dateOfBirth, address), office locations, assigned areas, shift, ' +
      'employment type, salary, commission, bank details, Aadhaar, PAN, remarks, this ' +
      "month's attendance summary, and `todayAttendanceStatus` (PRESENT | ABSENT | HALF_DAY | " +
      'LEAVE | NO_CHECKIN — only PRESENT/NO_CHECKIN are currently reachable).',
  })
  @ApiParam({
    name: 'id',
    description: "Worker's User id or WorkerProfile id",
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Worker details' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  getWorkerById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getWorkerById(id);
  }

  // ─── Live Worker Tracking ────────────────────────────────────────────────────

  @Get('live-workers')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Live worker tracking — ADMIN',
    description:
      "Returns active workers with their live status derived from today's attendance and current task assignment. " +
      '`active` = checked in with an in-progress task. `free` = checked in, no in-progress task. ' +
      '`offline` = not checked in, checked out, or no location update in the last 5 minutes. ' +
      "Location is the worker's most recent GPS pin from today's attendance (check-out coordinates once " +
      'checked out, otherwise check-in coordinates) — there is no separate live GPS ping table. ' +
      '`distanceFromOffice` is computed from that location to the office they checked into, in km. ' +
      'Optional params are never rejected when sent empty.',
  })
  @ApiOkResponse({
    description: 'Paginated live worker list',
    schema: {
      example: {
        success: true,
        message: 'Live workers fetched successfully',
        data: {
          workers: [
            {
              id: 'uuid',
              name: 'Rahul Sharma',
              phone: '9876543210',
              status: 'active',
              currentJob: 'Solar Cleaning',
              currentLocation: { latitude: 28.6139, longitude: 77.209 },
              lastUpdated: '2026-07-14T09:12:00.000Z',
              distanceFromOffice: 3.42,
              isAvailable: false,
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getLiveWorkers(@Query() query: QueryLiveWorkersDto) {
    return this.adminService.getLiveWorkers(query);
  }

  @Get('live-tracking')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Live tracking — workers and/or managers — ADMIN',
    description:
      'Distinct from GET /admin/live-workers (kept unchanged for backward compatibility) — ' +
      'this returns a richer per-record shape and supports role=WORKER|MANAGER|BOTH (default ' +
      'BOTH). WORKER and MANAGER records share an IDENTICAL structure — office/area/shift/' +
      "employmentStatus are resolved the same way for both (a worker's own area and its " +
      "office, a manager's own office/area/shift assignment). trackingStatus: LIVE (checked " +
      'in, not checked out, GPS fix within the last 5 minutes) | CHECKED_IN (checked in but ' +
      'no fresh GPS fix — device GPS off or location timed out) | OFFLINE (not checked in ' +
      'today, checked out, or no attendance at all). latitude/longitude are the unified ' +
      'best-available position (same value as lastKnownLatitude/Longitude, kept alongside for ' +
      'backward compatibility, along with current* which is null unless trackingStatus=LIVE). ' +
      'attendanceStatus is PRESENT/CHECKED_OUT/NOT_CHECKED_IN — ABSENT is a valid value of the ' +
      'field but unreachable (no leave/absence tracking exists in this schema). ' +
      "employmentStatus is the worker's SalaryType (SALARY/COMMISSION) or the manager's " +
      'ManagerEmploymentType (MONTHLY/COMMISSION, nullable). currentJobId/currentJobStatus/' +
      'currentJob come from an in-progress Task and are always null for MANAGER records ' +
      '(managers do not execute jobs themselves). gpsEnabled is derived from GPS freshness, ' +
      'not a device-level toggle (none is tracked). whatsappNumber is always null — no such ' +
      'field is captured anywhere yet.',
  })
  @ApiOkResponse({
    description:
      'Paginated live tracking list — identical structure for WORKER and MANAGER',
    schema: {
      example: {
        success: true,
        data: {
          records: [
            {
              id: 'uuid',
              name: 'Rahul Sharma',
              profileImage: 'http://server/uploads/images/worker-1.jpg',
              phone: '9876543210',
              whatsappNumber: null,
              role: 'WORKER',
              employmentStatus: 'SALARY',
              attendanceStatus: 'PRESENT',
              trackingStatus: 'LIVE',
              latitude: 28.6139,
              longitude: 77.209,
              currentLatitude: 28.6139,
              currentLongitude: 77.209,
              lastKnownLatitude: 28.6139,
              lastKnownLongitude: 77.209,
              lastLocationTime: '2026-07-19T09:12:00.000Z',
              gpsEnabled: true,
              currentJobId: 'uuid',
              currentJobStatus: 'IN_PROGRESS',
              currentJob: {
                id: 'uuid',
                status: 'IN_PROGRESS',
                title: 'AC Repair',
              },
              officeId: 'uuid',
              areaId: 'uuid',
              office: { id: 'uuid', name: 'HSR Office' },
              area: { id: 'uuid', name: 'HSR Layout' },
              shift: { id: 'uuid5', name: 'Morning Shift' },
            },
            {
              id: 'uuid2',
              name: 'Priya Manager',
              profileImage: null,
              phone: '9876500000',
              whatsappNumber: null,
              role: 'MANAGER',
              employmentStatus: 'MONTHLY',
              attendanceStatus: 'PRESENT',
              trackingStatus: 'LIVE',
              latitude: 28.61,
              longitude: 77.2,
              currentLatitude: 28.61,
              currentLongitude: 77.2,
              lastKnownLatitude: 28.61,
              lastKnownLongitude: 77.2,
              lastLocationTime: '2026-07-19T09:10:00.000Z',
              gpsEnabled: true,
              currentJobId: null,
              currentJobStatus: null,
              currentJob: null,
              officeId: 'uuid3',
              areaId: 'uuid4',
              office: { id: 'uuid3', name: 'HSR Office' },
              area: { id: 'uuid4', name: 'HSR Layout' },
              shift: { id: 'uuid5', name: 'Morning Shift' },
            },
          ],
          meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  getLiveTracking(@Query() query: QueryLiveTrackingDto) {
    return this.adminService.getLiveTracking(query);
  }

  // ─── Support Tickets ──────────────────────────────────────────────────────────

  @Get('support/tickets')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List support / complaint tickets — ADMIN',
    description:
      'Paginated support tickets. Supports filtering by status, priority, and free-text search.',
  })
  @ApiOkResponse({
    description: 'Paginated support ticket list',
    schema: {
      example: {
        success: true,
        data: {
          items: [
            {
              id: 'uuid',
              ticketNumber: 'TKT-2026-001',
              title: 'AC not cooling',
              subject: 'Service complaint',
              priority: 'HIGH',
              status: 'OPEN',
              customer: {
                id: 'uuid',
                name: 'Rahul Sharma',
                phone: '9876543210',
              },
              assignedTo: { id: 'uuid', name: 'Support Agent' },
              createdBy: { id: 'uuid', name: 'Rahul Sharma' },
              closedAt: null,
              createdAt: '2026-06-30T10:00:00.000Z',
            },
          ],
          pagination: { page: 1, limit: 20, total: 42, totalPages: 3 },
        },
      },
    },
  })
  getSupportTickets(@Query() query: QuerySupportTicketsDto) {
    console.log(
      '[AdminController] Support Tickets Query:',
      JSON.stringify(query),
    );
    return this.adminService.getSupportTickets(query);
  }

  // ─── Notification Settings ────────────────────────────────────────────────────

  @Get('notification-settings')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get notification settings — ADMIN',
    description:
      'Returns the current notification preferences for this organization. ' +
      'Defaults are returned the first time (before any PATCH has been made).',
  })
  @ApiOkResponse({
    description: 'Current notification settings',
    schema: {
      example: {
        success: true,
        data: {
          pushNotifications: true,
          emailNotifications: true,
          smsNotifications: false,
          newBooking: true,
          bookingAssigned: true,
          bookingCompleted: true,
          bookingCancelled: true,
          bookingRescheduled: false,
          newCustomer: true,
          customerComplaint: true,
          customerDeactivated: false,
          workerCheckIn: true,
          workerCheckOut: true,
          workerLeave: true,
          workerDeactivated: true,
          newManager: true,
          managerAttendance: true,
          managerDeactivated: true,
          newTicket: true,
          ticketAssigned: true,
          ticketClosed: true,
          highPriorityTicket: true,
          dailyReport: false,
          weeklyReport: true,
          monthlyReport: true,
        } satisfies NotificationSettings,
      },
    },
  })
  getNotificationSettings() {
    return this.adminService.getNotificationSettings();
  }

  @Patch('notification-settings')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update notification settings — ADMIN',
    description:
      'Partially updates notification preferences. Send only the fields you want to change — ' +
      'all other settings keep their current values. Changes are persisted immediately.',
  })
  @ApiBody({ type: UpdateNotificationSettingsDto })
  @ApiOkResponse({
    description: 'Settings updated',
    schema: {
      example: {
        success: true,
        message: 'Notification settings updated successfully.',
      },
    },
  })
  updateNotificationSettings(
    @Body() dto: UpdateNotificationSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateNotificationSettings(dto, actor);
  }

  // ─── Attendance Rules ─────────────────────────────────────────────────────

  @Get('attendance-rules')
  @ApiOperation({ summary: 'Get current attendance rules configuration' })
  @ApiOkResponse({
    description: 'Current attendance rules',
    type: AttendanceRulesResponseDto,
  })
  getAttendanceRules() {
    return this.adminService.getAttendanceRules();
  }

  @Put('attendance-rules')
  @ApiOperation({ summary: 'Update attendance rules configuration' })
  @ApiBody({ type: UpdateAttendanceRulesDto })
  @ApiOkResponse({
    description: 'Rules updated',
    schema: {
      example: {
        success: true,
        message: 'Attendance rules updated successfully',
      },
    },
  })
  updateAttendanceRules(
    @Body() dto: UpdateAttendanceRulesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateAttendanceRules(dto, actor);
  }

  // ─── Shifts ───────────────────────────────────────────────────────────────────

  @Get('shifts')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'List all shifts — ADMIN',
    description:
      'Seeds two default shifts ("Shift A" 08:00–17:00, "Shift B" 10:00–19:00) the first ' +
      'time this is called if none exist yet. The UI only manages these two permanent shifts.',
  })
  @ApiOkResponse({
    description: 'Shift list',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid-a',
            name: 'Shift A',
            startTime: '08:00',
            endTime: '17:00',
            graceMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            lateAfterMinutes: 15,
            earlyLeaveMinutes: 15,
            workingDays: [1, 2, 3, 4, 5, 6],
            isActive: true,
          },
          {
            id: 'uuid-b',
            name: 'Shift B',
            startTime: '10:00',
            endTime: '19:00',
            graceMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            lateAfterMinutes: 15,
            earlyLeaveMinutes: 15,
            workingDays: [1, 2, 3, 4, 5, 6],
            isActive: true,
          },
        ],
      },
    },
  })
  getShifts(@Query() query: QueryShiftsDto) {
    return this.adminService.getShifts(query);
  }

  @Post('shifts')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create or update a shift by name — ADMIN (upsert)',
    description:
      'Behaves as an upsert keyed on name (case-insensitive): if a shift with this name ' +
      'already exists (e.g. "Shift A" or "Shift B"), it is updated in place instead of ' +
      'failing with a duplicate-name conflict.',
  })
  @ApiBody({ type: CreateShiftDto })
  @ApiCreatedResponse({
    description: 'Shift created or updated',
    schema: {
      example: {
        success: true,
        message: 'Shift created successfully',
        data: {},
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'startTime/endTime/workingDays missing or invalid, endTime <= startTime, or halfDayHours >= fullDayHours',
  })
  createShift(@Body() dto: CreateShiftDto, @CurrentUser() actor: AuthUser) {
    return this.adminService.createShift(dto, actor);
  }

  @Patch('shifts/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a shift — ADMIN' })
  @ApiParam({ name: 'id', description: 'Shift UUID' })
  @ApiBody({ type: UpdateShiftDto })
  @ApiOkResponse({ description: 'Shift updated' })
  @ApiNotFoundResponse({ description: 'Shift not found' })
  @ApiResponse({
    status: 400,
    description: 'endTime <= startTime, or halfDayHours >= fullDayHours',
  })
  @ApiResponse({
    status: 409,
    description: 'A shift with this name already exists',
  })
  updateShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateShift(id, dto, actor);
  }

  @Patch('shifts/:id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Activate/deactivate a shift — ADMIN' })
  @ApiParam({ name: 'id', description: 'Shift UUID' })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({ description: 'Shift status updated' })
  @ApiNotFoundResponse({ description: 'Shift not found' })
  updateShiftStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.updateShiftStatus(id, dto, actor);
  }

  @Delete('shifts/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete a shift — ADMIN',
    description:
      'Rejected with 400 for the permanent shifts (Shift A / Shift B — update them instead), ' +
      'or with 409 if the shift is assigned to any manager or worker.',
  })
  @ApiParam({ name: 'id', description: 'Shift UUID' })
  @ApiOkResponse({
    description: 'Shift deleted',
    schema: {
      example: { success: true, message: 'Shift deleted successfully' },
    },
  })
  @ApiNotFoundResponse({ description: 'Shift not found' })
  @ApiResponse({
    status: 400,
    description:
      'Shift is a permanent shift (Shift A / Shift B) and cannot be deleted',
  })
  @ApiResponse({
    status: 409,
    description: 'Shift is assigned to existing managers/workers',
  })
  deleteShift(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminService.deleteShift(id, actor);
  }
}
