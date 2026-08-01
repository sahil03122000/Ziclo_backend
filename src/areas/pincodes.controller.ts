import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AssignManagerPincodesDto } from './dto/assign-manager-pincodes.dto';
import { AssignWorkerPincodeDto } from './dto/assign-worker-pincode.dto';
import { CreatePincodeDto } from './dto/create-pincode.dto';
import { PincodeQueryDto } from './dto/pincode-query.dto';
import { UpdatePincodeDto } from './dto/update-pincode.dto';
import { PincodesService } from './pincodes.service';

@ApiTags('Pincodes')
@ApiBearerAuth('JWT')
@Controller('pincodes')
@UseGuards(JwtAuthGuard, RoleGuard)
export class PincodesController {
  constructor(private readonly pincodesService: PincodesService) {}

  // Static routes must precede /:id

  @Get('lookup/:pincode')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Look up a PIN Code by its 6-digit code',
    description: 'Returns city, state, and district details for a 6-digit Indian PIN Code stored in the system.',
  })
  @ApiParam({ name: 'pincode', description: '6-digit PIN Code', example: '302020' })
  @ApiOkResponse({
    description: 'PIN Code found',
    schema: {
      example: {
        success: true,
        message: 'PIN Code found',
        data: { pincode: '302020', city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', country: 'India' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'PIN Code not found' })
  @ApiResponse({ status: 400, description: 'PIN Code must be exactly 6 digits' })
  lookupByCode(@Param('pincode') pincode: string) {
    if (!/^\d{6}$/.test(pincode)) {
      throw new BadRequestException('PIN Code must be exactly 6 digits');
    }
    return this.pincodesService.lookupByCode(pincode);
  }

  @Get('my-pincodes')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: "Manager's assigned pincodes — MANAGER" })
  @ApiResponse({ status: 200, description: 'Pincodes assigned to the manager' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER required' })
  getMyPincodes(@CurrentUser() user: AuthUser) {
    return this.pincodesService.getMyPincodes(user.id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new pincode — ADMIN' })
  @ApiResponse({ status: 201, description: 'Pincode created' })
  @ApiResponse({ status: 400, description: 'Pincode already exists or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  create(@Body() dto: CreatePincodeDto) {
    return this.pincodesService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List all pincodes with optional filters — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated pincode list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: PincodeQueryDto) {
    return this.pincodesService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Pincode detail with assigned manager and workers — ADMIN' })
  @ApiParam({ name: 'id', description: 'Pincode UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pincode detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Pincode not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pincodesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update pincode — ADMIN' })
  @ApiParam({ name: 'id', description: 'Pincode UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pincode updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Pincode not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePincodeDto) {
    return this.pincodesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate pincode — ADMIN' })
  @ApiParam({ name: 'id', description: 'Pincode UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pincode deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Pincode not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.pincodesService.remove(id);
  }

  // ─── Assignment endpoints ──────────────────────────────────────────────────────

  @Put('managers/:managerId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Assign multiple pincodes to a manager — ADMIN',
    description: 'Replaces all current pincode assignments for the manager. Pass an empty array to remove all assignments.',
  })
  @ApiParam({ name: 'managerId', description: 'Manager user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pincodes assigned' })
  @ApiResponse({ status: 400, description: 'Validation error or pincode not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Manager not found' })
  assignToManager(
    @Param('managerId', ParseUUIDPipe) managerId: string,
    @Body() dto: AssignManagerPincodesDto,
  ) {
    return this.pincodesService.assignToManager(managerId, dto);
  }

  @Put('workers/:workerId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Assign a pincode to a worker — ADMIN / MANAGER' })
  @ApiParam({ name: 'workerId', description: 'Worker user UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pincode assigned to worker' })
  @ApiResponse({ status: 400, description: 'Validation error or pincode not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  assignToWorker(
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Body() dto: AssignWorkerPincodeDto,
  ) {
    return this.pincodesService.assignToWorker(workerId, dto);
  }
}
