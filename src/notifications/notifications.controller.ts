import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard } from '../common/guards/role.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { SendPushNotificationDto } from './dto/send-push-notification.dto';
import { TestNotificationDto } from './dto/test-notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RoleGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-device')
  @ApiOperation({
    summary: 'Register or update a FCM device token',
    description:
      'Associates a Firebase Cloud Messaging token with the authenticated user. ' +
      'Call this on app start-up and whenever the FCM token is refreshed. ' +
      'Expired / invalid tokens are automatically deactivated when a push fails.',
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered',
    schema: { example: { success: true, data: { id: 'uuid', token: 'fcm-token...', platform: 'ANDROID', isActive: true } } },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.notificationsService.registerDevice(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get own notifications inbox',
    description: 'Returns notifications for the authenticated user ordered by newest first. Pass `?unreadOnly=true` to filter unread.',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification list',
    schema: {
      example: {
        success: true,
        data: {
          items: [{ id: 'uuid', title: 'Booking Confirmed', body: 'Your booking BK-000042 is confirmed.', isRead: false, createdAt: '2026-06-21T10:00:00Z' }],
          unreadCount: 3,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMyNotifications(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notificationsService.getMyNotifications(user.id, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all own notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read', schema: { example: { success: true, data: { updated: 5 } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the count of unread notifications for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Unread count', schema: { example: { success: true, data: { unreadCount: 3 } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Post('send-push')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Send a push notification to one or more users — ADMIN',
    description:
      'Dispatches FCM push notifications and creates in-app notification records for each target user. ' +
      'Invalid or expired device tokens are automatically deactivated. ' +
      'Returns per-user delivery result summary.',
  })
  @ApiBody({ type: SendPushNotificationDto })
  @ApiResponse({
    status: 201,
    description: 'Push dispatched',
    schema: {
      example: {
        success: true,
        data: { sent: 3, failed: 1, results: [{ userId: 'uuid', status: 'sent' }, { userId: 'uuid2', status: 'no_token' }] },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  sendPush(@Body() dto: SendPushNotificationDto) {
    return this.notificationsService.sendPush(dto);
  }

  @Post('test')
  @ApiOperation({
    summary: 'Send a test push notification to verify FCM integration',
    description:
      'Sends a test notification to the authenticated user\'s registered devices. ' +
      'ADMIN can optionally target another user via `userId`. ' +
      'Returns FCM configuration status, registered token count, and delivery result.',
  })
  @ApiBody({ type: TestNotificationDto })
  @ApiResponse({
    status: 201,
    description: 'Test notification sent',
    schema: {
      example: {
        success: true,
        data: { fcmConfigured: true, tokenCount: 2, deliveryResult: 'sent', message: 'Test notification delivered' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'No registered device tokens found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  sendTest(@CurrentUser() user: AuthUser, @Body() dto: TestNotificationDto) {
    return this.notificationsService.sendTestNotification(user.id, user.role, dto);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiParam({ name: 'id', description: 'Notification UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found or belongs to another user' })
  markAsRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notificationsService.markAsRead(id, user.id);
  }
}
