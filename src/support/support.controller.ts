import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { SupportService } from './support.service';

@ApiTags('Support')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @ApiOperation({ summary: 'Create a support ticket — any authenticated user' })
  @ApiResponse({
    status: 201,
    description: 'Ticket created with status OPEN',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          ticketRef: 'TKT-000001',
          status: 'OPEN',
          priority: 'MEDIUM',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.supportService.create(dto, user, (req as any).organizationId);
  }

  @Get()
  @ApiOperation({
    summary:
      'List tickets — USER/WORKER: own only | MANAGER: own team (tickets tied to bookings ' +
      'they manage or their own workers performed) | ADMIN: all in org',
  })
  @ApiResponse({ status: 200, description: 'Paginated ticket list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Query() query: TicketQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.supportService.findAll(
      query,
      user,
      (req as any).organizationId,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get ticket detail — USER/WORKER: own only | MANAGER: own team only | ADMIN: any',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Ticket detail with comments and attachments',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      "Forbidden — USER/WORKER can only view own tickets; MANAGER can only view their own team's",
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Update ticket title / description / priority — ADMIN / MANAGER',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ticket updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — ADMIN or MANAGER required',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.update(id, dto, user);
  }

  @Post(':id/comments')
  @ApiOperation({
    summary:
      'Add comment — USER: own ticket only | MANAGER/ADMIN: any. isInternal=true is staff-only',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Comment added' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — USER can only comment on own tickets',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.addComment(id, dto, user);
  }

  @Post(':id/attachments')
  @ApiOperation({
    summary:
      'Add attachment URL (from POST /uploads) — USER: own ticket only | MANAGER/ADMIN: any',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Attachment added' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — USER can only attach to own tickets',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAttachmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.addAttachment(id, dto, user);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary:
      'Assign ticket to a user and set status to IN_PROGRESS — ADMIN / MANAGER',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Ticket assigned — status set to IN_PROGRESS',
  })
  @ApiResponse({
    status: 400,
    description: 'Ticket is already RESOLVED or CLOSED',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Ticket or assignee not found' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.assign(id, dto, user);
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Escalate ticket to a higher priority — ADMIN / MANAGER',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ticket escalated' })
  @ApiResponse({
    status: 400,
    description: 'Ticket is already RESOLVED or CLOSED',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EscalateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.escalate(id, dto, user);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mark ticket as RESOLVED — ADMIN' })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ticket resolved' })
  @ApiResponse({
    status: 400,
    description: 'Ticket is already RESOLVED or CLOSED',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.supportService.resolve(id, dto, user);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mark ticket as CLOSED — ADMIN' })
  @ApiParam({ name: 'id', description: 'Ticket UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ticket closed' })
  @ApiResponse({ status: 400, description: 'Ticket is already CLOSED' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.supportService.close(id, user);
  }
}
