import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hashPassword } from "./_core/auth";
import { adminProcedure, operationsFinanceProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as finance from "./financeDb";

const roleSchema = z.enum(["user", "operations_finance", "admin"]);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(128);
const dateString = z.string().min(1).refine(value => !Number.isNaN(new Date(value).getTime()), "Invalid date");
const accountClassSchema = z.enum(["asset", "liability", "equity", "income", "expense"]);
const ledgerTypeSchema = z.enum(["control", "detail"]);

const journalLineSchema = z.object({
  accountId: z.number().int().positive(),
  description: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
});

export const accessRouter = router({
  users: adminProcedure.query(async () => finance.listUsers()),

  createUser: adminProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email(),
      password: passwordSchema,
      role: roleSchema.default("operations_finance"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const user = await db.createUserAccount(input);
        await finance.createAuditLog({
          action: "user.created",
          entityType: "user",
          entityId: user.id,
          details: { email: user.email, role: user.role },
          createdBy: ctx.user.id,
        });
        return user;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
      }
    }),

  updateRole: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), role: roleSchema }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A Super Admin cannot remove their own Super Admin access" });
      }
      return finance.updateUserRole(input.userId, input.role, ctx.user.id);
    }),

  setActive: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && !input.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot deactivate your own account" });
      }
      const target = await db.getPublicUserById(input.userId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const updated = await db.setUserFields(input.userId, { isActive: input.isActive });
      await finance.createAuditLog({
        action: input.isActive ? "user.activated" : "user.deactivated",
        entityType: "user",
        entityId: input.userId,
        createdBy: ctx.user.id,
      });
      return updated;
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), password: passwordSchema }))
    .mutation(async ({ input, ctx }) => {
      const target = await db.getPublicUserById(input.userId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      await db.setUserFields(input.userId, { passwordHash: await hashPassword(input.password) });
      await finance.createAuditLog({
        action: "user.password_reset",
        entityType: "user",
        entityId: input.userId,
        createdBy: ctx.user.id,
      });
      return { success: true } as const;
    }),

  auditLog: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => finance.getAuditLogs(input?.limit ?? 100)),
});

export const financeRouter = router({
  initialize: operationsFinanceProcedure.mutation(async ({ ctx }) => {
    return finance.ensureFinanceSetup(ctx.user.id);
  }),

  summary: operationsFinanceProcedure.query(async ({ ctx }) => {
    await finance.ensureFinanceSetup(ctx.user.id);
    return finance.getFinanceSummary();
  }),

  accounts: router({
    list: operationsFinanceProcedure
      .input(z.object({
        search: z.string().optional(),
        ledgerType: ledgerTypeSchema.optional(),
        activeOnly: z.boolean().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        await finance.ensureFinanceSetup(ctx.user.id);
        return finance.getLedgerAccounts(input);
      }),
    create: operationsFinanceProcedure
      .input(z.object({
        code: z.string().min(2).max(20).optional(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        accountClass: accountClassSchema,
        ledgerType: ledgerTypeSchema,
        parentId: z.number().int().positive().optional(),
        openingBalance: z.string().default("0"),
        openingBalanceSide: z.enum(["debit", "credit"]).default("debit"),
        isInventory: z.boolean().default(false),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => finance.createLedgerAccount(input, ctx.user.id)),
    update: operationsFinanceProcedure
      .input(z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        accountClass: accountClassSchema.optional(),
        ledgerType: ledgerTypeSchema.optional(),
        parentId: z.number().int().positive().nullable().optional(),
        openingBalance: z.string().optional(),
        openingBalanceSide: z.enum(["debit", "credit"]).optional(),
        isInventory: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return finance.updateLedgerAccount(id, data, ctx.user.id);
      }),
  }),

  vouchers: router({
    create: operationsFinanceProcedure
      .input(z.object({
        voucherType: z.enum(["cash_receipt", "cash_payment"]),
        entryDate: dateString,
        cashAccountId: z.number().int().positive(),
        narration: z.string().optional(),
        counterpartLines: z.array(z.object({
          accountId: z.number().int().positive(),
          amount: z.string(),
          description: z.string().optional(),
        })).min(1),
      }))
      .mutation(async ({ input, ctx }) => finance.createCashVoucher({
        ...input,
        entryDate: new Date(input.entryDate),
        createdBy: ctx.user.id,
      })),
  }),

  journals: router({
    list: operationsFinanceProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
      .query(async ({ input, ctx }) => {
        await finance.ensureFinanceSetup(ctx.user.id);
        return finance.getJournalEntries(input?.limit ?? 100);
      }),
    get: operationsFinanceProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => finance.getJournalEntryById(input.id)),
    create: operationsFinanceProcedure
      .input(z.object({
        entryDate: dateString,
        narration: z.string().min(1),
        lines: z.array(journalLineSchema).min(2),
      }))
      .mutation(async ({ input, ctx }) => finance.createJournalEntry({
        entryType: "general_journal",
        entryDate: new Date(input.entryDate),
        narration: input.narration,
        lines: input.lines,
        createdBy: ctx.user.id,
      })),
    reverse: adminProcedure
      .input(z.object({ id: z.number().int().positive(), reason: z.string().min(3) }))
      .mutation(async ({ input, ctx }) => finance.reverseJournalEntry(input.id, input.reason, ctx.user.id)),
  }),

  reports: router({
    trialBalance: operationsFinanceProcedure.query(async ({ ctx }) => {
      await finance.ensureFinanceSetup(ctx.user.id);
      return finance.getTrialBalance();
    }),
    accountLedger: operationsFinanceProcedure
      .input(z.object({ accountId: z.number().int().positive() }))
      .query(async ({ input }) => finance.getAccountStatement(input.accountId)),
  }),
});
