import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  // ── Channel toggles ─────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true, description: 'Enable / disable push notifications globally' })
  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  smsNotifications?: boolean;

  // ── Booking events ───────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newBooking?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  bookingAssigned?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  bookingCompleted?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  bookingCancelled?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  bookingRescheduled?: boolean;

  // ── Customer events ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newCustomer?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  customerComplaint?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  customerDeactivated?: boolean;

  // ── Worker events ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  workerCheckIn?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  workerCheckOut?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  workerLeave?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  workerDeactivated?: boolean;

  // ── Manager events ───────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newManager?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  managerAttendance?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  managerDeactivated?: boolean;

  // ── Support ticket events ────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newTicket?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  ticketAssigned?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  ticketClosed?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  highPriorityTicket?: boolean;

  // ── Report schedule ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  dailyReport?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  weeklyReport?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  monthlyReport?: boolean;
}

// Shape of the stored / returned settings object
export interface NotificationSettings {
  pushNotifications: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;

  newBooking: boolean;
  bookingAssigned: boolean;
  bookingCompleted: boolean;
  bookingCancelled: boolean;
  bookingRescheduled: boolean;

  newCustomer: boolean;
  customerComplaint: boolean;
  customerDeactivated: boolean;

  workerCheckIn: boolean;
  workerCheckOut: boolean;
  workerLeave: boolean;
  workerDeactivated: boolean;

  newManager: boolean;
  managerAttendance: boolean;
  managerDeactivated: boolean;

  newTicket: boolean;
  ticketAssigned: boolean;
  ticketClosed: boolean;
  highPriorityTicket: boolean;

  dailyReport: boolean;
  weeklyReport: boolean;
  monthlyReport: boolean;
}

export const NOTIFICATION_SETTINGS_DEFAULTS: NotificationSettings = {
  pushNotifications:  true,
  emailNotifications: true,
  smsNotifications:   false,

  newBooking:         true,
  bookingAssigned:    true,
  bookingCompleted:   true,
  bookingCancelled:   true,
  bookingRescheduled: false,

  newCustomer:         true,
  customerComplaint:   true,
  customerDeactivated: false,

  workerCheckIn:    true,
  workerCheckOut:   true,
  workerLeave:      true,
  workerDeactivated: true,

  newManager:        true,
  managerAttendance: true,
  managerDeactivated: true,

  newTicket:         true,
  ticketAssigned:    true,
  ticketClosed:      true,
  highPriorityTicket: true,

  dailyReport:  false,
  weeklyReport: true,
  monthlyReport: true,
};
