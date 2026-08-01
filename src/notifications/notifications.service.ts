import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, PushDeliveryStatus, Role } from '@prisma/client';

import { FirebaseService } from '../firebase/firebase.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { SendPushNotificationDto } from './dto/send-push-notification.dto';
import { TestNotificationDto } from './dto/test-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
  ) {}

  // ─── Internal — called by other services (fire-and-forget safe) ──────────────

  async notify(userId: string, title: string, message: string, data?: Record<string, unknown>, type?: NotificationType) {
    try {
      // 1. Persist in-app notification
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          data: data as Prisma.InputJsonValue,
          pushStatus: PushDeliveryStatus.PENDING,
        },
      });

      // 2. Skip push when FCM is not wired up
      if (!this.firebase.isConfigured()) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { pushStatus: PushDeliveryStatus.SKIPPED },
        });
        return;
      }

      // 3. Fetch active device tokens
      const rows = await this.prisma.deviceToken.findMany({
        where: { userId, isActive: true },
        select: { token: true },
      });

      if (!rows.length) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { pushStatus: PushDeliveryStatus.SKIPPED },
        });
        return;
      }

      const tokens = rows.map((r) => r.token);

      // Stringify all data values for FCM — include notificationId so the client can route
      const fcmData: Record<string, string> = {
        notificationId: notification.id,
        ...(type && { type }),
        ...(data
          ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
          : {}),
      };

      // 4. Send with up to 3 attempts (exponential back-off for transient FCM errors)
      let sendResult: { successCount: number; failureCount: number; invalidTokens: string[] } | undefined;
      let lastError: string | undefined;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          sendResult = await this.firebase.sendToTokens(tokens, { title, body: message }, fcmData);
          break;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
          this.logger.warn(`FCM attempt ${attempt}/3 for user ${userId}: ${lastError}`);
          if (attempt < 3) {
            await new Promise((res) => setTimeout(res, 500 * attempt)); // 500ms, 1000ms
          }
        }
      }

      // 5. Persist delivery status
      if (sendResult) {
        const pushStatus =
          sendResult.successCount > 0 ? PushDeliveryStatus.SENT : PushDeliveryStatus.FAILED;

        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            pushStatus,
            pushSentAt: sendResult.successCount > 0 ? new Date() : undefined,
            pushError:
              sendResult.failureCount > 0 && sendResult.successCount === 0
                ? `All ${sendResult.failureCount} token(s) failed`
                : null,
          },
        });

        // 6. Deactivate permanently dead tokens
        if (sendResult.invalidTokens.length > 0) {
          await this.prisma.deviceToken.updateMany({
            where: { token: { in: sendResult.invalidTokens } },
            data: { isActive: false },
          });
          this.logger.warn(
            `Deactivated ${sendResult.invalidTokens.length} dead FCM token(s) for user ${userId}`,
          );
        }
      } else {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { pushStatus: PushDeliveryStatus.FAILED, pushError: lastError ?? 'All retries exhausted' },
        });
      }
    } catch {
      // Never block the calling operation
    }
  }

  // ─── Admin send-push ──────────────────────────────────────────────────────────

  async sendPush(dto: SendPushNotificationDto) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.userIds } },
      select: { id: true, name: true },
    });

    const foundIds = new Set(users.map((u) => u.id));
    const notFoundIds = dto.userIds.filter((id) => !foundIds.has(id));

    const results = await Promise.all(
      users.map(async (user) => {
        await this.notify(user.id, dto.title, dto.message, dto.data);
        const tokenCount = await this.prisma.deviceToken.count({ where: { userId: user.id, isActive: true } });
        return { userId: user.id, name: user.name, activeTokens: tokenCount };
      }),
    );

    return {
      success: true,
      message: `Push dispatched to ${results.length} user(s)`,
      data: { dispatched: results, notFound: notFoundIds },
    };
  }

  // ─── Device registration ──────────────────────────────────────────────────────

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const deviceToken = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform, isActive: true },
      update: { userId, platform: dto.platform, isActive: true }, // re-activate on re-registration
    });
    return { success: true, message: 'Device registered successfully', data: deviceToken };
  }

  // ─── Test push notification ───────────────────────────────────────────────────

  async sendTestNotification(actorId: string, actorRole: Role, dto: TestNotificationDto) {
    const targetUserId = dto.userId && actorRole === Role.ADMIN ? dto.userId : actorId;

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: targetUserId, isActive: true },
      select: { id: true, platform: true, token: true },
    });

    // Fire async; the method is fire-and-forget safe
    await this.notify(targetUserId, dto.title, dto.message, { source: 'test', actorId });

    return {
      success: true,
      message: 'Test notification dispatched',
      data: {
        targetUserId,
        targetName: user.name,
        fcmConfigured: this.firebase.isConfigured(),
        activeTokenCount: tokens.length,
        tokenPreviews: tokens.map((t) => ({
          id: t.id,
          platform: t.platform,
          preview: `${t.token.slice(0, 16)}...`,
        })),
      },
    };
  }

  // ─── User-facing reads ────────────────────────────────────────────────────────

  async getMyNotifications(userId: string, query: NotificationQueryDto) {
    const { page = 1, limit = 20, unreadOnly, type } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = { userId };
    if (unreadOnly) where.isRead = false;
    if (type) where.type = type;

    const [notifications, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      success: true,
      data: {
        notifications,
        unreadCount,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
    return { success: true, data: updated };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { success: true, message: 'All notifications marked as read', data: { updated: result.count } };
  }

  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { success: true, data: { unreadCount } };
  }
}
