import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LeaveTransactionType, LeaveType, Prisma, Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { QueryLeaveTransactionsDto } from './dto/query-leave-transactions.dto';
import { UpdateLeavePolicyDto } from './dto/update-leave-policy.dto';

const SINGLETON_ID = 'singleton';

export interface LeavePolicyData {
  financialYearStartMonth: number;
  financialYearEndMonth: number;
  casualMonthlyAllocation: number;
  casualCarryForwardEnabled: boolean;
  casualCarryForwardLimit: number | null;
  casualFinancialYearReset: boolean;
  casualEnabled: boolean;
  sickYearlyAllocation: number;
  sickCarryForwardEnabled: boolean;
  sickCarryForwardLimit: number | null;
  sickFinancialYearReset: boolean;
  sickEnabled: boolean;
  plannedMonthlyAllocation: number;
  plannedCarryForwardEnabled: boolean;
  plannedCarryForwardLimit: number | null;
  plannedFinancialYearReset: boolean;
  plannedEnabled: boolean;
  requireAdminLeaveApproval: boolean;
}

export const LEAVE_POLICY_DEFAULTS: LeavePolicyData = {
  financialYearStartMonth: 4,
  financialYearEndMonth: 3,
  casualMonthlyAllocation: 1,
  casualCarryForwardEnabled: true,
  casualCarryForwardLimit: null,
  casualFinancialYearReset: true,
  casualEnabled: true,
  sickYearlyAllocation: 6,
  sickCarryForwardEnabled: false,
  sickCarryForwardLimit: null,
  sickFinancialYearReset: true,
  sickEnabled: true,
  plannedMonthlyAllocation: 3,
  plannedCarryForwardEnabled: true,
  plannedCarryForwardLimit: null,
  plannedFinancialYearReset: false,
  plannedEnabled: true,
  requireAdminLeaveApproval: false,
};

// One column pair (allocated/used) per policy-governed leave type on LeaveBalance —
// centralized here so every read/write against a specific type goes through the same map
// instead of duplicating `casualAllocated`/`sickAllocated`/... field-name strings everywhere.
// "allocated" is a gross running total (only grows, via allocation/carry-forward) — it is
// NEVER decremented directly by usage. "used" is what apply/cancel actually mutate; the
// spendable "remaining" balance is always (allocated - used), computed on every read.
const BALANCE_FIELDS: Record<'CASUAL' | 'SICK' | 'PLANNED', { allocated: string; used: string }> = {
  CASUAL: { allocated: 'casualAllocated', used: 'casualUsed' },
  SICK: { allocated: 'sickAllocated', used: 'sickUsed' },
  PLANNED: { allocated: 'plannedAllocated', used: 'plannedUsed' },
};

export type PolicyGovernedType = keyof typeof BALANCE_FIELDS;
type BalanceRow = Record<string, number> & { lwpUsed: number };

@Injectable()
export class LeavePolicyService {
  private readonly logger = new Logger(LeavePolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Policy CRUD ────────────────────────────────────────────────────────────────

  async getPolicy(): Promise<{ success: boolean; data: LeavePolicyData }> {
    const row = await this.prisma.leavePolicy.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return { success: true, data: { ...LEAVE_POLICY_DEFAULTS } };

    return {
      success: true,
      data: {
        financialYearStartMonth: row.financialYearStartMonth,
        financialYearEndMonth: row.financialYearEndMonth,
        casualMonthlyAllocation: row.casualMonthlyAllocation,
        casualCarryForwardEnabled: row.casualCarryForwardEnabled,
        casualCarryForwardLimit: row.casualCarryForwardLimit,
        casualFinancialYearReset: row.casualFinancialYearReset,
        casualEnabled: row.casualEnabled,
        sickYearlyAllocation: row.sickYearlyAllocation,
        sickCarryForwardEnabled: row.sickCarryForwardEnabled,
        sickCarryForwardLimit: row.sickCarryForwardLimit,
        sickFinancialYearReset: row.sickFinancialYearReset,
        sickEnabled: row.sickEnabled,
        plannedMonthlyAllocation: row.plannedMonthlyAllocation,
        plannedCarryForwardEnabled: row.plannedCarryForwardEnabled,
        plannedCarryForwardLimit: row.plannedCarryForwardLimit,
        plannedFinancialYearReset: row.plannedFinancialYearReset,
        plannedEnabled: row.plannedEnabled,
        requireAdminLeaveApproval: row.requireAdminLeaveApproval,
      },
    };
  }

  async updatePolicy(dto: UpdateLeavePolicyDto): Promise<{ success: boolean; message: string; data: LeavePolicyData }> {
    const current = (await this.getPolicy()).data;
    // class-transformer (with this project's ES2023 target / useDefineForClassFields) leaves
    // every *unset* optional DTO field present as an own property with value `undefined` —
    // spreading it directly would blow away `current`'s real values for every field the caller
    // didn't send. Only merge keys the caller actually provided.
    const provided = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const merged: LeavePolicyData = { ...current, ...provided };

    if (merged.financialYearStartMonth === merged.financialYearEndMonth) {
      throw new BadRequestException('financialYearStartMonth and financialYearEndMonth cannot be the same month');
    }

    await this.prisma.leavePolicy.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...merged },
      update: { ...merged },
    });

    return { success: true, message: 'Leave policy updated successfully', data: merged };
  }

  // ─── Balance ────────────────────────────────────────────────────────────────────
  // Entitled / Available / Used / Remaining per type, plus Leave Without Pay Used — computed
  // here so no consumer (including the UI) ever has to derive "remaining" itself. Shared by
  // both Worker (GET workers/me/dashboard) and Manager (GET managers/me/dashboard) — one
  // implementation, so a fix here is a fix for both, never a second leave system.
  //
  // `entitled` vs `available` — these are deliberately different numbers, not a naming
  // duplicate: `entitled` is the Admin-configured target straight from LeavePolicy
  // (casualMonthlyAllocation / sickYearlyAllocation / plannedMonthlyAllocation) — what the
  // employee is *entitled to*. `available` (unchanged) is what has actually been *credited*
  // onto LeaveBalance so far via the allocation/FY-reset cron jobs, which is the real spendable
  // pool `remaining` is computed from — never touched or redefined here. For Casual/Planned
  // (monthly accrual) these track closely once a few cycles have run. For Sick (a single
  // once-a-year grant at the financial-year reset — see runFinancialYearReset) `available`
  // legitimately stays 0 for an employee whose FY reset hasn't fired yet this cycle, even
  // though Admin has configured a real non-zero entitlement — that was previously invisible to
  // Manager/Worker (they only ever saw the 0), which is the root cause `entitled` fixes: it
  // surfaces the real configured number end-to-end (Admin → DB → Manager/Worker) regardless of
  // where a given employee's accrual cycle currently stands.
  async getBalance(userId: string) {
    const [balance, policy] = await Promise.all([this.ensureBalanceRow(userId), this.getPolicy()]);
    const ENTITLED_FIELD: Record<PolicyGovernedType, keyof LeavePolicyData> = {
      CASUAL: 'casualMonthlyAllocation',
      SICK: 'sickYearlyAllocation',
      PLANNED: 'plannedMonthlyAllocation',
    };
    const shape = (type: PolicyGovernedType) => {
      const fields = BALANCE_FIELDS[type];
      const allocated = (balance as unknown as BalanceRow)[fields.allocated];
      const used = (balance as unknown as BalanceRow)[fields.used];
      return {
        entitled: policy.data[ENTITLED_FIELD[type]] as number,
        available: allocated,
        used,
        remaining: allocated - used,
      };
    };

    return {
      success: true,
      data: {
        casual: shape('CASUAL'),
        sick: shape('SICK'),
        planned: shape('PLANNED'),
        // LWP has no entitled/allocated pool — it's whatever is left once all paid leave is
        // exhausted, so `remaining` mirrors `used` (both are the same running unpaid-days
        // total) rather than implying a cap that doesn't exist.
        leaveWithoutPay: { used: balance.lwpUsed, remaining: balance.lwpUsed },
      },
    };
  }

  async ensureBalanceRow(userId: string) {
    const existing = await this.prisma.leaveBalance.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.leaveBalance.create({ data: { userId } });
  }

  // ─── Transactions ───────────────────────────────────────────────────────────────

  async getTransactions(query: QueryLeaveTransactionsDto) {
    const { page = 1, limit = 20, userId, leaveType } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.LeaveTransactionWhereInput = {};
    if (userId) where.userId = userId;
    if (leaveType) where.leaveType = leaveType;

    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.leaveTransaction.findMany({
        where,
        include: { user: { select: { id: true, name: true, role: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leaveTransaction.count({ where }),
    ]);

    return {
      success: true,
      data: { transactions, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  // ─── Deduct on leave approval — used by LeaveRequestService at the terminal decision ──────
  // Deduction happens once, at final approval (manager-level if no admin escalation is
  // required, admin-level otherwise) — never at apply time and never on rejection. "Leave
  // Without Pay is available only after all paid leave is exhausted": this never rejects for
  // insufficient balance — it pays out of `remaining` first, then routes any shortfall to LWP.
  //
  // EMERGENCY is intentionally excluded — it is not governed by LeavePolicy (see the
  // LeaveType enum comment), so callers should skip this entirely for that type.
  async deductForApprovedLeave(
    userId: string,
    type: PolicyGovernedType,
    amount: number,
    note?: string,
  ): Promise<{ paidDays: number; lwpDays: number }> {
    const policy = (await this.getPolicy()).data;
    const enabledKey = `${type.toLowerCase()}Enabled` as keyof LeavePolicyData;
    if (!policy[enabledKey]) {
      throw new BadRequestException(`${this.typeLabel(type)} leave is currently disabled`);
    }

    const balance = await this.ensureBalanceRow(userId);
    const fields = BALANCE_FIELDS[type];
    const allocated = (balance as unknown as BalanceRow)[fields.allocated];
    const used = (balance as unknown as BalanceRow)[fields.used];
    const remaining = Math.max(0, allocated - used);

    const paidDays = Math.min(remaining, amount);
    const lwpDays = amount - paidDays;

    if (paidDays > 0) {
      const newUsed = used + paidDays;
      await this.prisma.$transaction([
        this.prisma.leaveBalance.update({ where: { userId }, data: { [fields.used]: { increment: paidDays } } }),
        this.prisma.leaveTransaction.create({
          data: {
            userId,
            leaveType: type as LeaveType,
            transactionType: LeaveTransactionType.DEDUCTION,
            amount: -paidDays,
            balanceAfter: allocated - newUsed,
            note,
          },
        }),
      ]);
    }
    if (lwpDays > 0) {
      await this.recordUnpaidAbsence(userId, lwpDays);
    }

    return { paidDays, lwpDays };
  }

  // ─── Leave Without Pay ──────────────────────────────────────────────────────────
  // Every day that settles as an unpaid ABSENT — a missed checkout that's detected (and not
  // yet/never resolved) or a rejected missed-checkout request — counts here. Reversed if a
  // later missed-checkout approval converts the day to PRESENT/HALF_DAY. Clamped at 0.
  async recordUnpaidAbsence(userId: string, deltaDays: number): Promise<void> {
    const balance = await this.ensureBalanceRow(userId);
    const newValue = Math.max(0, balance.lwpUsed + deltaDays);
    await this.prisma.leaveBalance.update({ where: { userId }, data: { lwpUsed: newValue } });
  }

  // ─── Monthly Allocation Job ─────────────────────────────────────────────────────
  // Every month: +casualMonthlyAllocation to Casual, +plannedMonthlyAllocation to Planned —
  // for active WORKER/MANAGER users only. Sick is a yearly allocation (granted by the
  // financial year reset job below), so it is untouched here. Every number comes from the
  // LeavePolicy row — nothing here is a hardcoded +1/+3.
  async runMonthlyAllocation(force = false): Promise<{ success: boolean; message: string; data: { employeesAffected: number } }> {
    const policy = await this.getOrCreatePolicyRow();
    const thisMonthKey = this.monthKey(new Date());

    if (policy.lastMonthlyAllocationRunMonth === thisMonthKey && !force) {
      return { success: true, message: `Monthly allocation already ran for ${thisMonthKey}`, data: { employeesAffected: 0 } };
    }

    const employees = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [Role.WORKER, Role.MANAGER] } },
      select: { id: true },
    });

    for (const employee of employees) {
      await this.ensureBalanceRow(employee.id);

      if (policy.casualEnabled && policy.casualMonthlyAllocation > 0) {
        await this.credit(employee.id, 'CASUAL', policy.casualMonthlyAllocation, LeaveTransactionType.ALLOCATION, `Monthly allocation — ${thisMonthKey}`);
      }
      if (policy.plannedEnabled && policy.plannedMonthlyAllocation > 0) {
        await this.credit(employee.id, 'PLANNED', policy.plannedMonthlyAllocation, LeaveTransactionType.ALLOCATION, `Monthly allocation — ${thisMonthKey}`);
      }
    }

    await this.prisma.leavePolicy.update({
      where: { id: SINGLETON_ID },
      data: { lastMonthlyAllocationRunMonth: thisMonthKey },
    });

    this.logger.log(`Monthly leave allocation run for ${thisMonthKey} — ${employees.length} employee(s)`);
    return {
      success: true,
      message: `Monthly allocation applied for ${thisMonthKey}`,
      data: { employeesAffected: employees.length },
    };
  }

  // ─── Financial Year Reset Job ──────────────────────────────────────────────────
  // Runs only in the month immediately after the configured financial-year end month
  // (fully DB-driven — no calendar month is hardcoded). For each policy-governed type,
  // whether it resets, whether it carries forward, and the carry-forward limit are all
  // read from the LeavePolicy row.
  async runFinancialYearReset(force = false): Promise<{ success: boolean; message: string; data: { employeesAffected: number } }> {
    const policy = await this.getOrCreatePolicyRow();
    const now = new Date();
    const resetTriggerMonth = (policy.financialYearEndMonth % 12) + 1;

    if (now.getMonth() + 1 !== resetTriggerMonth && !force) {
      return {
        success: true,
        message: `Not the financial-year reset month (runs in month ${resetTriggerMonth})`,
        data: { employeesAffected: 0 },
      };
    }

    const thisRunYear = now.getFullYear();
    if (policy.lastFinancialYearResetRunYear === thisRunYear && !force) {
      return { success: true, message: `Financial year reset already ran for ${thisRunYear}`, data: { employeesAffected: 0 } };
    }

    const balances = await this.prisma.leaveBalance.findMany({ select: { userId: true } });

    for (const { userId } of balances) {
      await this.resetTypeAtFinancialYearEnd(userId, 'CASUAL', policy.casualFinancialYearReset, policy.casualCarryForwardEnabled, policy.casualCarryForwardLimit);
      await this.resetTypeAtFinancialYearEnd(userId, 'SICK', policy.sickFinancialYearReset, policy.sickCarryForwardEnabled, policy.sickCarryForwardLimit);
      // Planned: "No yearly reset" by default — only touched if explicitly enabled.
      await this.resetTypeAtFinancialYearEnd(userId, 'PLANNED', policy.plannedFinancialYearReset, policy.plannedCarryForwardEnabled, policy.plannedCarryForwardLimit);

      // Sick is a yearly (not monthly) allocation — granted fresh at the start of each
      // financial year, right after the reset/carry-forward step above.
      if (policy.sickEnabled && policy.sickYearlyAllocation > 0) {
        await this.credit(userId, 'SICK', policy.sickYearlyAllocation, LeaveTransactionType.ALLOCATION, `Yearly allocation — FY reset ${thisRunYear}`);
      }
    }

    await this.prisma.leavePolicy.update({
      where: { id: SINGLETON_ID },
      data: { lastFinancialYearResetRunYear: thisRunYear },
    });

    this.logger.log(`Financial year reset run for ${thisRunYear} — ${balances.length} employee(s)`);
    return {
      success: true,
      message: `Financial year reset applied for ${thisRunYear}`,
      data: { employeesAffected: balances.length },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────────

  private async getOrCreatePolicyRow() {
    const existing = await this.prisma.leavePolicy.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
    return this.prisma.leavePolicy.create({ data: { id: SINGLETON_ID, ...LEAVE_POLICY_DEFAULTS } });
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private typeLabel(type: PolicyGovernedType): string {
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

  // Credits the gross allocated total (allocation, carry-forward) — never touches `used`.
  private async credit(
    userId: string,
    type: PolicyGovernedType,
    amount: number,
    transactionType: LeaveTransactionType,
    note: string,
  ): Promise<void> {
    const fields = BALANCE_FIELDS[type];
    const balance = await this.ensureBalanceRow(userId);
    const allocated = (balance as unknown as BalanceRow)[fields.allocated];
    const used = (balance as unknown as BalanceRow)[fields.used];
    const newAllocated = allocated + amount;

    await this.prisma.$transaction([
      this.prisma.leaveBalance.update({ where: { userId }, data: { [fields.allocated]: { increment: amount } } }),
      this.prisma.leaveTransaction.create({
        data: { userId, leaveType: type as LeaveType, transactionType, amount, balanceAfter: newAllocated - used, note },
      }),
    ]);
  }

  // Zeroes `used` and, per the type's own reset/carry-forward configuration, either carries
  // forward some/all of the remaining (allocated - used) balance into the new allocated total
  // or lets it lapse — or, if financial-year reset is disabled for this type, does nothing.
  private async resetTypeAtFinancialYearEnd(
    userId: string,
    type: PolicyGovernedType,
    resetEnabled: boolean,
    carryForwardEnabled: boolean,
    carryForwardLimit: number | null,
  ): Promise<void> {
    if (!resetEnabled) return; // e.g. Planned by default — balance persists untouched

    const fields = BALANCE_FIELDS[type];
    const balance = await this.ensureBalanceRow(userId);
    const currentAllocated = (balance as unknown as BalanceRow)[fields.allocated];
    const currentUsed = (balance as unknown as BalanceRow)[fields.used];
    if (currentAllocated === 0 && currentUsed === 0) return;

    const currentRemaining = currentAllocated - currentUsed;
    const carried = carryForwardEnabled
      ? (carryForwardLimit != null ? Math.min(currentRemaining, carryForwardLimit) : currentRemaining)
      : 0;

    await this.prisma.$transaction([
      this.prisma.leaveBalance.update({
        where: { userId },
        data: { [fields.allocated]: carried, [fields.used]: 0 },
      }),
      this.prisma.leaveTransaction.create({
        data: {
          userId,
          leaveType: type as LeaveType,
          transactionType: LeaveTransactionType.RESET,
          amount: -currentRemaining,
          balanceAfter: 0,
          note: 'Financial year end reset',
        },
      }),
      ...(carried > 0
        ? [
            this.prisma.leaveTransaction.create({
              data: {
                userId,
                leaveType: type as LeaveType,
                transactionType: LeaveTransactionType.CARRY_FORWARD,
                amount: carried,
                balanceAfter: carried,
                note: carryForwardLimit != null ? `Carried forward (limit ${carryForwardLimit})` : 'Carried forward (unlimited)',
              },
            }),
          ]
        : []),
    ]);
  }
}
