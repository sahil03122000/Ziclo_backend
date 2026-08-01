import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AttendanceService } from './attendance.service';

// Missed Checkout Detection — runs alongside the Leave Policy cron jobs (Monthly Allocation,
// Financial Year Reset). Every 30 minutes, sweeps every currently-open attendance row and
// marks any past its own shift-end deadline as ABSENT (missedCheckout = true). 30 minutes
// (rather than a single fixed end-of-day run) is needed because different workers/managers
// can have different shift end times — a single daily run would catch some deadlines hours
// late. The lazy per-request check in AttendanceService covers the gap between runs for
// whoever happens to call checkOut/getTodayAttendance in the meantime.
@Injectable()
export class AttendanceCronService {
  private readonly logger = new Logger(AttendanceCronService.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  @Cron('*/30 * * * *')
  async handleMissedCheckoutDetection(): Promise<void> {
    const affected = await this.attendanceService.runMissedCheckoutDetection();
    if (affected > 0) {
      this.logger.log(`Missed Checkout Detection — marked ${affected} attendance row(s) ABSENT`);
    }
  }
}
