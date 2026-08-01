import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { QueryLeaveTransactionsDto } from './dto/query-leave-transactions.dto';
import { UpdateLeavePolicyDto } from './dto/update-leave-policy.dto';
import { LeavePolicyService } from './leave-policy.service';

@ApiTags('Admin / Leave Policy')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZATION_ADMIN)
@Controller('admin/leave-policy')
export class LeavePolicyController {
  constructor(private readonly leavePolicyService: LeavePolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Get the Leave Policy configuration — ADMIN (Admin Panel: Attendance Settings → Leave Policy)' })
  @ApiResponse({ status: 200, description: 'Leave policy — financial year window, and per-type allocation/carry-forward/reset rules' })
  getPolicy() {
    return this.leavePolicyService.getPolicy();
  }

  @Patch()
  @ApiOperation({
    summary: 'Update the Leave Policy configuration — ADMIN',
    description: 'Partial update — only the fields sent are changed. Everything (financial year window, monthly/yearly allocations, carry-forward rules and limits, reset rules) is editable here; nothing about leave rules is hardcoded.',
  })
  @ApiResponse({ status: 200, description: 'Leave policy updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  updatePolicy(@Body() dto: UpdateLeavePolicyDto) {
    return this.leavePolicyService.updatePolicy(dto);
  }

  @Get('balances/:userId')
  @ApiParam({ name: 'userId', description: 'Employee (Worker/Manager) User UUID', format: 'uuid' })
  @ApiOperation({ summary: "Get an employee's leave balance — ADMIN" })
  @ApiResponse({ status: 200, description: 'Available/used balance for Casual, Sick, and Planned leave' })
  getEmployeeBalance(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.leavePolicyService.getBalance(userId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get leave transaction history — ADMIN', description: 'Every allocation, carry-forward, reset, deduction, and refund — optionally filtered by employee and/or leave type.' })
  @ApiQuery({ name: 'userId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'leaveType', required: false, enum: ['SICK', 'CASUAL', 'PLANNED', 'EMERGENCY'] })
  @ApiResponse({ status: 200, description: 'Paginated leave transaction list' })
  getTransactions(@Query() query: QueryLeaveTransactionsDto) {
    return this.leavePolicyService.getTransactions(query);
  }

  @Post('run-monthly-allocation')
  @ApiOperation({
    summary: 'Manually trigger the Monthly Allocation job — ADMIN',
    description: 'Same job the monthly cron runs automatically. No-ops if already run for the current month unless force=true.',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Monthly allocation applied (or skipped if already run this month)' })
  runMonthlyAllocation(@Query('force') force?: string) {
    return this.leavePolicyService.runMonthlyAllocation(force === 'true');
  }

  @Post('run-financial-year-reset')
  @ApiOperation({
    summary: 'Manually trigger the Financial Year Reset job — ADMIN',
    description: 'Same job the cron runs automatically. Only takes effect in the month after the configured financial year end unless force=true; no-ops if already run this year unless force=true.',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Financial year reset applied (or skipped)' })
  runFinancialYearReset(@Query('force') force?: string) {
    return this.leavePolicyService.runFinancialYearReset(force === 'true');
  }
}
