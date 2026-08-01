import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { LeavePolicyService } from './leave-policy.service';

// Both jobs fire on a fixed monthly schedule — which calendar month actually triggers an
// allocation or a financial-year reset is decided entirely inside LeavePolicyService by
// reading LeavePolicy from the database (financialYearEndMonth, the "last run" guards, ...).
// Nothing about *when* a reset happens is hardcoded into the cron expression itself beyond
// "check once a month".
@Injectable()
export class LeavePolicyCronService {
  private readonly logger = new Logger(LeavePolicyCronService.name);

  constructor(private readonly leavePolicyService: LeavePolicyService) {}

  @Cron('0 0 1 * *') // 1st of every month, 00:00
  async handleMonthlyAllocation(): Promise<void> {
    const result = await this.leavePolicyService.runMonthlyAllocation();
    this.logger.log(result.message);
  }

  @Cron('0 1 1 * *') // 1st of every month, 00:01 — after the monthly allocation above
  async handleFinancialYearReset(): Promise<void> {
    const result = await this.leavePolicyService.runFinancialYearReset();
    this.logger.log(result.message);
  }
}
