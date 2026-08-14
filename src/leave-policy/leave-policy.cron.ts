import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { LeavePolicyService } from './leave-policy.service';

// Both jobs fire on a fixed monthly schedule — which calendar month actually triggers an
// allocation or a financial-year reset is decided entirely inside LeavePolicyService by
// reading LeavePolicy from the database (financialYearEndMonth, the "last run" guards, ...).
// Nothing about *when* a reset happens is hardcoded into the cron expression itself beyond
// "check once a month".
@Injectable()
export class LeavePolicyCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeavePolicyCronService.name);

  constructor(private readonly leavePolicyService: LeavePolicyService) {}

  // Root cause of Worker leave balances staying at 0 forever: the @Cron jobs below only ever
  // fire if the process happens to be alive at exactly 1st-of-month 00:00/00:01 — in practice
  // a server that restarts/redeploys around then (or simply wasn't running yet when this
  // feature shipped) silently misses every scheduled run, and there is no other path that ever
  // credits a LeaveBalance row. Both target methods are already idempotent per month/year
  // (LeavePolicy.lastMonthlyAllocationRunMonth / lastFinancialYearResetRunYear), so re-running
  // them on every boot is always safe — a no-op once this month/year has already run, and a
  // catch-up the moment it hasn't.
  async onApplicationBootstrap(): Promise<void> {
    try {
      const allocationResult = await this.leavePolicyService.runMonthlyAllocation();
      this.logger.log(`[startup catch-up] ${allocationResult.message}`);
    } catch (err) {
      this.logger.error(`[startup catch-up] monthly allocation failed: ${(err as Error).message}`, (err as Error).stack);
    }
    try {
      const resetResult = await this.leavePolicyService.runFinancialYearReset();
      this.logger.log(`[startup catch-up] ${resetResult.message}`);
    } catch (err) {
      this.logger.error(`[startup catch-up] financial year reset failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

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
