import { Schema } from "mongoose";
import { nanoid } from "nanoid";
import {
  auditLogs as auditLogsTable,
  journalEntries as journalEntriesTable,
  journalLines as journalLinesTable,
  ledgerAccounts as ledgerAccountsTable,
  type LedgerAccount,
} from "../drizzle/schema";
import type { UserRole } from "./_core/types";
import {
  connectDb,
  CustomerModel,
  ensureModel,
  getNextSequence,
  getPublicUserById,
  listUsers as listAllUsers,
  OrderAdvanceMetalModel,
  OrderInvoiceModel,
  OrderModel,
  setUserFields,
  UserModel,
  VendorModel,
} from "./db";
import { toRow } from "./rows";

export type FinanceRole = UserRole;
export type JournalEntryType =
  | "cash_receipt"
  | "cash_payment"
  | "general_journal"
  | "sales_invoice"
  | "customer_advance"
  | "reversal"
  | "opening_balance";

export type JournalLineInput = {
  accountId: number;
  description?: string;
  debit?: string;
  credit?: string;
};

type AccountClass = LedgerAccount["accountClass"];
type LedgerType = LedgerAccount["ledgerType"];

export type LedgerAccountInput = {
  code?: string;
  title: string;
  description?: string | null;
  accountClass: AccountClass;
  ledgerType: LedgerType;
  parentId?: number | null;
  openingBalance?: string;
  openingBalanceSide?: "debit" | "credit";
  isInventory?: boolean;
  isActive?: boolean;
};

// ============ MODELS ============

const withTimestamps = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
};

const LedgerAccountSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    code: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String },
    accountClass: { type: String, enum: ["asset", "liability", "equity", "income", "expense"], required: true },
    ledgerType: { type: String, enum: ["control", "detail"], default: "detail", required: true },
    parentId: { type: Number, index: true },
    // One ledger per customer / vendor (sparse: only entity ledgers carry these ids).
    customerId: { type: Number, unique: true, sparse: true },
    vendorId: { type: Number, unique: true, sparse: true },
    openingBalance: { type: Number, default: 0 },
    openingBalanceSide: { type: String, enum: ["debit", "credit"], default: "debit" },
    isInventory: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "ledger_accounts" }
);

// Journal lines are embedded in their entry, so an entry and its lines are
// written in a single atomic document insert (no partial postings).
const JournalLineSchema = new Schema(
  {
    id: { type: Number, required: true },
    accountId: { type: Number, required: true },
    description: { type: String },
    debitCents: { type: Number, required: true, default: 0 },
    creditCents: { type: Number, required: true, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const JournalEntrySchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    entryNumber: { type: String, required: true, unique: true },
    entryType: {
      type: String,
      enum: ["cash_receipt", "cash_payment", "general_journal", "sales_invoice", "customer_advance", "reversal", "opening_balance"],
      required: true,
    },
    entryDate: { type: Date, required: true },
    narration: { type: String },
    referenceType: { type: String },
    referenceId: { type: Number },
    // Unique key for automatic postings (invoice, advances, reversals) so the
    // same source document can never be posted twice, even under concurrency.
    sourceKey: { type: String, unique: true, sparse: true },
    status: { type: String, enum: ["posted", "reversed"], default: "posted", required: true },
    reversalOfId: { type: Number },
    reversedById: { type: Number },
    reversalReason: { type: String },
    totalDebitCents: { type: Number, required: true },
    totalCreditCents: { type: Number, required: true },
    lines: { type: [JournalLineSchema], required: true },
    createdBy: { type: Number },
    postedAt: { type: Date, default: Date.now },
  },
  { ...withTimestamps, collection: "journal_entries" }
);
JournalEntrySchema.index({ "lines.accountId": 1 });
JournalEntrySchema.index({ referenceType: 1, referenceId: 1 });
JournalEntrySchema.index({ entryDate: -1, id: -1 });

const AuditLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    details: { type: String },
    createdBy: { type: Number },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, collection: "audit_logs" }
);
AuditLogSchema.index({ createdAt: -1 });

export const LedgerAccountModel = ensureModel("LedgerAccount", LedgerAccountSchema);
export const JournalEntryModel = ensureModel("JournalEntry", JournalEntrySchema);
export const AuditLogModel = ensureModel("AuditLog", AuditLogSchema);

type LedgerDoc = {
  id: number;
  code: string;
  title: string;
  description?: string | null;
  accountClass: AccountClass;
  ledgerType: LedgerType;
  parentId?: number | null;
  customerId?: number | null;
  vendorId?: number | null;
  openingBalance?: number | null;
  openingBalanceSide: "debit" | "credit";
  isInventory?: boolean;
  isSystem?: boolean;
  isActive?: boolean;
  createdBy?: number | null;
};

type JournalLineDoc = {
  id: number;
  accountId: number;
  description?: string | null;
  debitCents: number;
  creditCents: number;
  createdAt?: Date;
};

type JournalEntryDoc = {
  id: number;
  entryNumber: string;
  entryType: JournalEntryType;
  entryDate: Date;
  narration?: string | null;
  referenceType?: string | null;
  referenceId?: number | null;
  sourceKey?: string | null;
  status: "posted" | "reversed";
  reversalOfId?: number | null;
  reversedById?: number | null;
  reversalReason?: string | null;
  totalDebitCents: number;
  totalCreditCents: number;
  lines: JournalLineDoc[];
  createdBy?: number | null;
  postedAt?: Date;
  createdAt?: Date;
};

// ============ SYSTEM CHART OF ACCOUNTS ============

type SystemAccount = Omit<LedgerDoc, "id" | "openingBalance" | "parentId"> & { parentCode?: string };

const SYSTEM_ACCOUNTS: SystemAccount[] = [
  { code: "AR000000", title: "Account Receivable", description: "Receivable control account", accountClass: "asset", ledgerType: "control", openingBalanceSide: "debit", isSystem: true, isActive: true },
  { code: "CS000000", title: "Customer Account", description: "Customer detail-ledger control", accountClass: "asset", ledgerType: "control", openingBalanceSide: "debit", isSystem: true, isActive: true, parentCode: "AR000000" },
  { code: "CA000000", title: "Cash / Bank", description: "Cash and bank control account", accountClass: "asset", ledgerType: "control", openingBalanceSide: "debit", isSystem: true, isActive: true },
  { code: "CA000001", title: "Cash In Hand", description: "Primary cash account", accountClass: "asset", ledgerType: "detail", openingBalanceSide: "debit", isSystem: true, isActive: true, parentCode: "CA000000" },
  { code: "CA000002", title: "Bank Account", description: "Primary bank account", accountClass: "asset", ledgerType: "detail", openingBalanceSide: "debit", isSystem: true, isActive: true, parentCode: "CA000000" },
  { code: "VN000000", title: "Vendor Account", description: "Vendor detail-ledger control", accountClass: "liability", ledgerType: "control", openingBalanceSide: "credit", isSystem: true, isActive: true },
  { code: "EX000000", title: "Expense", description: "Expense control account", accountClass: "expense", ledgerType: "control", openingBalanceSide: "debit", isSystem: true, isActive: true },
  { code: "EX000001", title: "Discount Allowed", description: "Customer discounts and adjustments", accountClass: "expense", ledgerType: "detail", openingBalanceSide: "debit", isSystem: true, isActive: true, parentCode: "EX000000" },
  { code: "EX000002", title: "General Expense", description: "General operating expenses", accountClass: "expense", ledgerType: "detail", openingBalanceSide: "debit", isSystem: true, isActive: true, parentCode: "EX000000" },
  { code: "ST000000", title: "Stock Account", description: "Inventory control account", accountClass: "asset", ledgerType: "control", openingBalanceSide: "debit", isInventory: true, isSystem: true, isActive: true },
  { code: "ST000001", title: "Gold & Material Inventory", description: "Gold and other customer material held", accountClass: "asset", ledgerType: "detail", openingBalanceSide: "debit", isInventory: true, isSystem: true, isActive: true, parentCode: "ST000000" },
  { code: "DW000000", title: "Drawing", description: "Owner drawings control account", accountClass: "equity", ledgerType: "control", openingBalanceSide: "debit", isSystem: true, isActive: true },
  { code: "SA000000", title: "Sales", description: "Sales income control account", accountClass: "income", ledgerType: "control", openingBalanceSide: "credit", isSystem: true, isActive: true },
  { code: "SA000001", title: "Jewelry Sales", description: "Jewelry sales income", accountClass: "income", ledgerType: "detail", openingBalanceSide: "credit", isSystem: true, isActive: true, parentCode: "SA000000" },
];

// ============ HELPERS ============

/** Convert a decimal amount to integer cents without floating-point drift (half-up rounding). */
export function moneyToCents(value: string | number | null | undefined) {
  if (value === "" || value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid monetary amount");
    // toFixed(3) removes binary noise (1.005 -> "1.005") before exact string rounding.
    return moneyToCents(value.toFixed(3));
  }
  const match = value.trim().replace(/,/g, "").match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[2] && !match[3])) throw new Error("Invalid monetary amount");
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2] || "0");
  const fraction = (match[3] || "").padEnd(3, "0");
  const cents = whole * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid monetary amount");
  return sign * cents;
}

export function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatEntityCode(prefix: "CS" | "VN", id: number) {
  return `${prefix}${String(id).padStart(6, "0")}`;
}

function isDuplicateKeyError(error: unknown) {
  return (error as { code?: number })?.code === 11000;
}

function ledgerRow(doc: LedgerDoc) {
  return toRow(ledgerAccountsTable, doc);
}

function entryRow(doc: JournalEntryDoc) {
  return toRow(journalEntriesTable, {
    ...doc,
    totalDebit: doc.totalDebitCents / 100,
    totalCredit: doc.totalCreditCents / 100,
  });
}

function lineRow(entryId: number, line: JournalLineDoc) {
  return toRow(journalLinesTable, {
    ...line,
    journalEntryId: entryId,
    debit: line.debitCents / 100,
    credit: line.creditCents / 100,
  });
}

async function getAccountByCode(code: string) {
  await connectDb();
  return LedgerAccountModel.findOne({ code }).lean<LedgerDoc>();
}

async function getAccountById(id: number) {
  await connectDb();
  return LedgerAccountModel.findOne({ id }).lean<LedgerDoc>();
}

/**
 * Insert a ledger account idempotently: if another request already created the
 * ledger for the same unique key, that one is returned. If only the preferred
 * code is taken, a suffixed code is used instead (entity ledgers only).
 */
async function insertLedger(
  values: Omit<LedgerDoc, "id">,
  uniqueFilter: Record<string, unknown>,
  options: { allowCodeSuffix?: boolean } = {}
) {
  let code = values.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const id = await getNextSequence("ledger_accounts");
      const created = await LedgerAccountModel.create({ ...values, code, id });
      return created.toObject() as unknown as LedgerDoc;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrent = await LedgerAccountModel.findOne(uniqueFilter).lean<LedgerDoc>();
      if (concurrent) return concurrent;
      if (!options.allowCodeSuffix) throw error;
      code = `${values.code}-${nanoid(4).toUpperCase()}`;
    }
  }
  throw new Error("Could not allocate a unique ledger code, please retry");
}

// ============ AUDIT ============

export async function createAuditLog(data: {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  details?: unknown;
  createdBy?: number;
}) {
  await connectDb();
  await AuditLogModel.create({
    id: await getNextSequence("audit_logs"),
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId == null ? null : String(data.entityId),
    details: data.details == null ? null : JSON.stringify(data.details),
    createdBy: data.createdBy,
  });
}

export async function getAuditLogs(limit = 100) {
  await connectDb();
  const logs = await AuditLogModel.find({}).sort({ createdAt: -1, id: -1 }).limit(limit).lean();
  const userIds = Array.from(new Set(logs.map(log => log.createdBy).filter(Boolean)));
  const users = userIds.length ? await UserModel.find({ id: { $in: userIds } }, { id: 1, name: 1 }).lean() : [];
  const userMap = new Map(users.map(user => [user.id, user]));
  return logs.map(log => ({
    log: toRow(auditLogsTable, log),
    actorName: ((log.createdBy ? userMap.get(log.createdBy)?.name : null) as string | null | undefined) ?? null,
  }));
}

// ============ SETUP & ENTITY LEDGERS ============

let setupComplete = false;

async function ensureSystemAccounts(userId?: number) {
  const existing = await LedgerAccountModel.find({ code: { $in: SYSTEM_ACCOUNTS.map(a => a.code) } }).lean<LedgerDoc[]>();
  const byCode = new Map(existing.map(account => [account.code, account]));
  const ordered = [
    ...SYSTEM_ACCOUNTS.filter(account => !account.parentCode),
    ...SYSTEM_ACCOUNTS.filter(account => account.parentCode),
  ];
  for (const definition of ordered) {
    if (byCode.has(definition.code)) continue;
    const { parentCode, ...values } = definition;
    const parentId = parentCode ? byCode.get(parentCode)?.id : undefined;
    if (parentCode && !parentId) throw new Error(`Missing parent account ${parentCode}`);
    const created = await insertLedger(
      { ...values, parentId: parentId ?? null, openingBalance: 0, createdBy: userId },
      { code: definition.code }
    );
    byCode.set(definition.code, created);
  }
}

export async function ensureFinanceSetup(userId?: number) {
  await connectDb();
  await ensureSystemAccounts(userId);

  // Create any missing customer / vendor detail ledgers.
  const [customerLedgerIds, vendorLedgerIds] = await Promise.all([
    LedgerAccountModel.distinct("customerId", { customerId: { $ne: null } }),
    LedgerAccountModel.distinct("vendorId", { vendorId: { $ne: null } }),
  ]);
  const [missingCustomers, missingVendors] = await Promise.all([
    CustomerModel.find({ id: { $nin: customerLedgerIds } }, { id: 1 }).lean(),
    VendorModel.find({ id: { $nin: vendorLedgerIds } }, { id: 1 }).lean(),
  ]);
  for (const customer of missingCustomers) await ensureCustomerLedger(customer.id, userId);
  for (const vendor of missingVendors) await ensureVendorLedger(vendor.id, userId);

  setupComplete = true;
  return { success: true } as const;
}

/** Cheap guard used on hot paths: runs the full setup once per process. */
async function ensureSetupOnce(userId?: number) {
  if (!setupComplete) await ensureFinanceSetup(userId);
}

async function requireControlAccount(code: "CS000000" | "VN000000", userId?: number) {
  let parent = await getAccountByCode(code);
  if (!parent) {
    await ensureSystemAccounts(userId);
    parent = await getAccountByCode(code);
  }
  if (!parent) throw new Error(`${code === "CS000000" ? "Customer" : "Vendor"} control account is unavailable`);
  return parent;
}

async function uniqueEntityCode(preferred: string) {
  const owner = await getAccountByCode(preferred);
  return owner ? `${preferred}-${nanoid(4).toUpperCase()}` : preferred;
}

export async function ensureCustomerLedger(customerId: number, userId?: number) {
  await connectDb();
  const existing = await LedgerAccountModel.findOne({ customerId }).lean<LedgerDoc>();
  if (existing) return ledgerRow(existing);

  const customer = await CustomerModel.findOne({ id: customerId }).lean();
  if (!customer) throw new Error("Customer not found");
  const parent = await requireControlAccount("CS000000", userId);
  const name = `${customer.firstName} ${customer.lastName || ""}`.trim();

  const created = await insertLedger(
    {
      code: await uniqueEntityCode(formatEntityCode("CS", customer.id)),
      title: name,
      description: `Customer account for ${name}`,
      accountClass: "asset",
      ledgerType: "detail",
      parentId: parent.id,
      customerId: customer.id,
      openingBalance: 0,
      openingBalanceSide: "debit",
      isSystem: true,
      isActive: true,
      createdBy: userId,
    },
    { customerId },
    { allowCodeSuffix: true }
  );
  return ledgerRow(created);
}

export async function ensureVendorLedger(vendorId: number, userId?: number) {
  await connectDb();
  const existing = await LedgerAccountModel.findOne({ vendorId }).lean<LedgerDoc>();
  if (existing) return ledgerRow(existing);

  const vendor = await VendorModel.findOne({ id: vendorId }).lean();
  if (!vendor) throw new Error("Vendor not found");
  const parent = await requireControlAccount("VN000000", userId);

  const created = await insertLedger(
    {
      code: await uniqueEntityCode(formatEntityCode("VN", vendor.id)),
      title: vendor.name,
      description: `Vendor account for ${vendor.name}`,
      accountClass: "liability",
      ledgerType: "detail",
      parentId: parent.id,
      vendorId: vendor.id,
      openingBalance: 0,
      openingBalanceSide: "credit",
      isSystem: true,
      isActive: vendor.isActive !== false,
      createdBy: userId,
    },
    { vendorId },
    { allowCodeSuffix: true }
  );
  return ledgerRow(created);
}

/** Keep the customer's ledger title in sync after a rename. */
export async function syncCustomerLedgerTitle(customerId: number) {
  await connectDb();
  const customer = await CustomerModel.findOne({ id: customerId }).lean();
  if (!customer) return;
  const name = `${customer.firstName} ${customer.lastName || ""}`.trim();
  await LedgerAccountModel.updateOne(
    { customerId },
    { $set: { title: name, description: `Customer account for ${name}` } }
  );
}

export async function syncVendorLedger(vendorId: number) {
  await connectDb();
  const vendor = await VendorModel.findOne({ id: vendorId }).lean();
  if (!vendor) return;
  await LedgerAccountModel.updateOne(
    { vendorId },
    { $set: { title: vendor.name, description: `Vendor account for ${vendor.name}`, isActive: vendor.isActive !== false } }
  );
}

async function accountHasPostings(accountId: number) {
  return (await JournalEntryModel.countDocuments({ "lines.accountId": accountId })) > 0;
}

/**
 * Customers with accounting history cannot be deleted. When a customer has no
 * postings its (empty) ledger is removed together with the customer.
 */
export async function assertCustomerLedgerDeletable(customerId: number) {
  await connectDb();
  const ledger = await LedgerAccountModel.findOne({ customerId }).lean<LedgerDoc>();
  if (ledger && await accountHasPostings(ledger.id)) {
    throw new Error("This customer has accounting entries and cannot be deleted");
  }
}

/** Remove the (empty) ledger of a customer that has just been deleted. */
export async function removeCustomerLedger(customerId: number, userId: number) {
  await connectDb();
  const ledger = await LedgerAccountModel.findOne({ customerId }).lean<LedgerDoc>();
  if (!ledger) return;
  if (await accountHasPostings(ledger.id)) return; // never drop a ledger with history
  await LedgerAccountModel.deleteOne({ id: ledger.id });
  await createAuditLog({ action: "ledger.deleted", entityType: "ledger_account", entityId: ledger.id, details: { customerId, code: ledger.code }, createdBy: userId });
}

export async function deactivateVendorLedger(vendorId: number, userId: number) {
  await connectDb();
  await LedgerAccountModel.updateOne({ vendorId }, { $set: { isActive: false } });
  await createAuditLog({ action: "vendor.deactivated", entityType: "vendor", entityId: vendorId, createdBy: userId });
}

// ============ USERS & ACCESS ============

export async function listUsers() {
  return listAllUsers();
}

export async function updateUserRole(userId: number, role: FinanceRole, changedBy: number) {
  const target = await getPublicUserById(userId);
  if (!target) throw new Error("User not found");
  const updated = await setUserFields(userId, { role });
  await createAuditLog({ action: "user.role_updated", entityType: "user", entityId: userId, details: { previousRole: target.role, role }, createdBy: changedBy });
  return updated!;
}

// ============ CHART OF ACCOUNTS ============

async function generateLedgerCode(parentId: number | null | undefined, accountClass: AccountClass) {
  let prefix: string = ({ asset: "AS", liability: "LI", equity: "EQ", income: "IN", expense: "EX" } as const)[accountClass];
  if (parentId) {
    const parent = await getAccountById(parentId);
    if (!parent) throw new Error("Parent account not found");
    prefix = parent.code.slice(0, 2).toUpperCase();
  }
  const accounts = await LedgerAccountModel.find({ code: { $regex: `^${prefix}\\d{6}$` } }, { code: 1 }).lean();
  const highest = accounts.reduce((max, account) => Math.max(max, Number(String(account.code).slice(2))), 0);
  return `${prefix}${String(highest + 1).padStart(6, "0")}`;
}

export async function createLedgerAccount(data: LedgerAccountInput, userId: number) {
  await connectDb();
  if (data.ledgerType === "detail" && !data.parentId) throw new Error("Detail ledgers require a parent control account");
  if (data.parentId) {
    const parent = await getAccountById(data.parentId);
    if (!parent || parent.ledgerType !== "control") throw new Error("Parent account must be a control ledger");
  }
  const requestedCode = data.code?.trim().toUpperCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = requestedCode || await generateLedgerCode(data.parentId, data.accountClass);
    try {
      const created = await LedgerAccountModel.create({
        id: await getNextSequence("ledger_accounts"),
        code,
        title: data.title,
        description: data.description ?? null,
        accountClass: data.accountClass,
        ledgerType: data.ledgerType,
        parentId: data.parentId ?? null,
        openingBalance: moneyToCents(data.openingBalance ?? "0") / 100,
        openingBalanceSide: data.openingBalanceSide ?? "debit",
        isInventory: data.isInventory ?? false,
        isSystem: false,
        isActive: data.isActive ?? true,
        createdBy: userId,
      });
      const account = ledgerRow(created.toObject() as unknown as LedgerDoc);
      await createAuditLog({ action: "ledger.created", entityType: "ledger_account", entityId: account.id, details: { code, title: data.title }, createdBy: userId });
      return account;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        if (requestedCode) throw new Error(`Account code ${requestedCode} is already in use`);
        continue; // another request took the generated code; generate the next one
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a unique account code, please retry");
}

export async function updateLedgerAccount(id: number, data: Partial<LedgerAccountInput>, userId: number) {
  await connectDb();
  const existing = await getAccountById(id);
  if (!existing) throw new Error("Ledger account not found");
  if (data.parentId) {
    if (data.parentId === id) throw new Error("An account cannot be its own parent");
    const parent = await getAccountById(data.parentId);
    if (!parent || parent.ledgerType !== "control") throw new Error("Parent account must be a control ledger");
  }
  if (!existing.isSystem && await accountHasPostings(id)) {
    const locked = (["ledgerType", "accountClass", "parentId", "openingBalance", "openingBalanceSide"] as const).filter(key => {
      const next = data[key];
      if (next === undefined) return false;
      if (key === "openingBalance") return moneyToCents(next as string) !== moneyToCents(existing.openingBalance);
      return (next ?? null) !== (existing[key] ?? null);
    });
    if (locked.length) {
      throw new Error(`This ledger already has postings; ${locked.join(", ")} can no longer be changed`);
    }
  }
  if (data.ledgerType === "control" && existing.ledgerType === "detail" && await accountHasPostings(id)) {
    throw new Error("A ledger with postings cannot become a control account");
  }
  const candidate: Record<string, unknown> = existing.isSystem
    ? { title: data.title, description: data.description, isActive: data.isActive }
    : {
        ...data,
        ...(data.openingBalance !== undefined ? { openingBalance: moneyToCents(data.openingBalance) / 100 } : {}),
      };
  delete candidate.code;
  const safeData = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
  await LedgerAccountModel.updateOne({ id }, { $set: safeData });
  await createAuditLog({ action: "ledger.updated", entityType: "ledger_account", entityId: id, details: safeData, createdBy: userId });
  const updated = await getAccountById(id);
  return ledgerRow(updated!);
}

/** Net movement (debit - credit, in cents) per account across every journal entry. */
async function getMovementByAccount() {
  // Reversed entries stay in the books: their reversal entry carries the
  // opposite lines, so including both nets the original out correctly.
  // Summed in integer cents in the application for exact, portable results.
  const entries = await JournalEntryModel.find({}, { "lines.accountId": 1, "lines.debitCents": 1, "lines.creditCents": 1 }).lean<Pick<JournalEntryDoc, "lines">[]>();
  const movement = new Map<number, number>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      movement.set(line.accountId, (movement.get(line.accountId) || 0) + line.debitCents - line.creditCents);
    }
  }
  return movement;
}

export async function getLedgerAccounts(filters?: { search?: string; ledgerType?: "control" | "detail"; activeOnly?: boolean }) {
  await connectDb();
  const [accounts, movement] = await Promise.all([
    LedgerAccountModel.find({}).sort({ code: 1 }).lean<LedgerDoc[]>(),
    getMovementByAccount(),
  ]);
  const byId = new Map(accounts.map(account => [account.id, account]));
  const ownBalance = (account: LedgerDoc) =>
    moneyToCents(account.openingBalance) * (account.openingBalanceSide === "debit" ? 1 : -1) + (movement.get(account.id) || 0);
  const children = new Map<number, LedgerDoc[]>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    children.set(account.parentId, [...(children.get(account.parentId) ?? []), account]);
  }
  // Control accounts show the total of everything beneath them.
  const rolledUp = new Map<number, number>();
  const balanceOf = (account: LedgerDoc, seen = new Set<number>()): number => {
    if (rolledUp.has(account.id)) return rolledUp.get(account.id)!;
    if (seen.has(account.id)) return 0; // defensive: ignore cycles
    seen.add(account.id);
    const total = ownBalance(account) + (children.get(account.id) ?? []).reduce((sum, child) => sum + balanceOf(child, seen), 0);
    rolledUp.set(account.id, total);
    return total;
  };
  const search = filters?.search?.toLowerCase();
  return accounts
    .filter(account => !search || `${account.code} ${account.title}`.toLowerCase().includes(search))
    .filter(account => !filters?.ledgerType || account.ledgerType === filters.ledgerType)
    .filter(account => !filters?.activeOnly || account.isActive !== false)
    .map(account => {
      const balanceCents = account.ledgerType === "control" ? balanceOf(account) : ownBalance(account);
      return {
        ...ledgerRow(account),
        parentTitle: account.parentId ? byId.get(account.parentId)?.title || null : null,
        balance: centsToMoney(Math.abs(balanceCents)),
        balanceSide: balanceCents >= 0 ? ("debit" as const) : ("credit" as const),
      };
    });
}

// ============ JOURNALS ============

const ENTRY_PREFIX: Record<JournalEntryType, string> = {
  general_journal: "JV",
  cash_receipt: "CR",
  cash_payment: "CP",
  sales_invoice: "SI",
  reversal: "RV",
  customer_advance: "AD",
  opening_balance: "OB",
};

export async function createJournalEntry(data: {
  entryType: JournalEntryType;
  entryDate: Date;
  narration?: string;
  referenceType?: string;
  referenceId?: number;
  sourceKey?: string;
  lines: JournalLineInput[];
  createdBy: number;
  reversalOfId?: number;
}) {
  await connectDb();
  if (data.lines.length < 2) throw new Error("A journal entry requires at least two lines");
  if (Number.isNaN(data.entryDate.getTime())) throw new Error("Invalid entry date");

  const normalized = data.lines.map(line => {
    const debit = moneyToCents(line.debit);
    const credit = moneyToCents(line.credit);
    if (debit < 0 || credit < 0) throw new Error("Debit and credit cannot be negative");
    if ((debit === 0 && credit === 0) || (debit > 0 && credit > 0)) {
      throw new Error("Each line must contain either a debit or a credit amount");
    }
    return { ...line, debit, credit };
  });
  const totalDebit = normalized.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = normalized.reduce((sum, line) => sum + line.credit, 0);
  if (totalDebit <= 0 || totalDebit !== totalCredit) throw new Error("Total debit and credit must be equal");

  const accountIds = Array.from(new Set(normalized.map(line => line.accountId)));
  const accounts = await LedgerAccountModel.find({ id: { $in: accountIds } }, { id: 1, ledgerType: 1, code: 1, isActive: 1 }).lean<LedgerDoc[]>();
  if (accounts.length !== accountIds.length) throw new Error("One or more ledger accounts do not exist");
  const controlAccount = accounts.find(account => account.ledgerType === "control");
  if (controlAccount) throw new Error(`Post to detail ledgers only (${controlAccount.code} is a control account)`);
  if (data.entryType !== "reversal") {
    const inactive = accounts.find(account => account.isActive === false);
    if (inactive) throw new Error(`Ledger ${inactive.code} is inactive. Reactivate it before posting.`);
  }

  const id = await getNextSequence("journal_entries");
  const entryNumber = `${ENTRY_PREFIX[data.entryType]}-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
  const lines: JournalLineDoc[] = [];
  for (const line of normalized) {
    lines.push({
      id: await getNextSequence("journal_lines"),
      accountId: line.accountId,
      description: line.description,
      debitCents: line.debit,
      creditCents: line.credit,
    });
  }

  await JournalEntryModel.create({
    id,
    entryNumber,
    entryType: data.entryType,
    entryDate: data.entryDate,
    narration: data.narration,
    referenceType: data.referenceType,
    referenceId: data.referenceId,
    sourceKey: data.sourceKey,
    reversalOfId: data.reversalOfId,
    totalDebitCents: totalDebit,
    totalCreditCents: totalCredit,
    lines,
    createdBy: data.createdBy,
  });
  await createAuditLog({
    action: "journal.posted",
    entityType: "journal_entry",
    entityId: id,
    details: { entryNumber, entryType: data.entryType, total: centsToMoney(totalDebit) },
    createdBy: data.createdBy,
  });
  return { id, entryNumber, totalDebit: centsToMoney(totalDebit), totalCredit: centsToMoney(totalCredit) };
}

/**
 * Post an automatic entry for a source document exactly once. A unique
 * sourceKey index guarantees idempotency even for concurrent requests.
 */
async function postOnce(sourceKey: string, post: () => Promise<{ id: number; entryNumber: string; totalDebit: string; totalCredit: string }>) {
  const existing = await JournalEntryModel.findOne({ sourceKey }).lean<JournalEntryDoc>();
  if (existing) return entrySummary(existing);
  try {
    return await post();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const concurrent = await JournalEntryModel.findOne({ sourceKey }).lean<JournalEntryDoc>();
      if (concurrent) return entrySummary(concurrent);
    }
    throw error;
  }
}

function entrySummary(entry: JournalEntryDoc) {
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    totalDebit: centsToMoney(entry.totalDebitCents),
    totalCredit: centsToMoney(entry.totalCreditCents),
  };
}

export async function createCashVoucher(data: {
  voucherType: "cash_receipt" | "cash_payment";
  entryDate: Date;
  cashAccountId: number;
  narration?: string;
  counterpartLines: Array<{ accountId: number; amount: string; description?: string }>;
  createdBy: number;
}) {
  if (!data.counterpartLines.length) throw new Error("Add at least one voucher line");
  const cashAccount = await getAccountById(data.cashAccountId);
  if (!cashAccount || !cashAccount.code.startsWith("CA")) throw new Error("Select a cash or bank account");
  if (data.counterpartLines.some(line => line.accountId === data.cashAccountId)) {
    throw new Error("The cash account cannot also be a voucher line");
  }
  const totalCents = data.counterpartLines.reduce((sum, line) => sum + moneyToCents(line.amount), 0);
  if (totalCents <= 0) throw new Error("Voucher total must be greater than zero");
  const counterpart = data.counterpartLines.map(line => ({
    accountId: line.accountId,
    description: line.description,
    debit: data.voucherType === "cash_payment" ? line.amount : "0",
    credit: data.voucherType === "cash_receipt" ? line.amount : "0",
  }));
  return createJournalEntry({
    entryType: data.voucherType,
    entryDate: data.entryDate,
    narration: data.narration,
    createdBy: data.createdBy,
    lines: [
      {
        accountId: data.cashAccountId,
        description: data.narration,
        debit: data.voucherType === "cash_receipt" ? centsToMoney(totalCents) : "0",
        credit: data.voucherType === "cash_payment" ? centsToMoney(totalCents) : "0",
      },
      ...counterpart,
    ],
  });
}

async function creatorNames(ids: Array<number | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((id): id is number => typeof id === "number")));
  if (!unique.length) return new Map<number, string | null>();
  const users = await UserModel.find({ id: { $in: unique } }, { id: 1, name: 1 }).lean();
  return new Map(users.map(user => [user.id as number, (user.name as string | null | undefined) ?? null]));
}

export async function getJournalEntries(limit = 100) {
  await connectDb();
  const entries = await JournalEntryModel.find({}).sort({ entryDate: -1, id: -1 }).limit(limit).lean<JournalEntryDoc[]>();
  const names = await creatorNames(entries.map(entry => entry.createdBy));
  return entries.map(entry => ({
    entry: entryRow(entry),
    creatorName: entry.createdBy ? names.get(entry.createdBy) ?? null : null,
  }));
}

export async function getJournalEntryById(id: number) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ id }).lean<JournalEntryDoc>();
  if (!entry) return null;
  const accounts = await LedgerAccountModel.find({ id: { $in: entry.lines.map(line => line.accountId) } }).lean<LedgerDoc[]>();
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  return {
    entry: entryRow(entry),
    lines: entry.lines
      .filter(line => accountMap.has(line.accountId))
      .map(line => ({ line: lineRow(entry.id, line), account: ledgerRow(accountMap.get(line.accountId)!) })),
  };
}

export async function reverseJournalEntry(id: number, reason: string, userId: number) {
  await connectDb();
  const source = await JournalEntryModel.findOne({ id }).lean<JournalEntryDoc>();
  if (!source) throw new Error("Journal entry not found");
  if (source.entryType === "reversal") throw new Error("A reversal entry cannot itself be reversed");
  if (source.status === "reversed") throw new Error("Journal entry is already reversed");

  const reversal = await postOnce(`reversal_of:${id}`, () => createJournalEntry({
    entryType: "reversal",
    entryDate: new Date(),
    narration: `Reversal of ${source.entryNumber}: ${reason}`,
    referenceType: "journal_entry",
    referenceId: id,
    sourceKey: `reversal_of:${id}`,
    reversalOfId: id,
    createdBy: userId,
    lines: source.lines.map(line => ({
      accountId: line.accountId,
      description: `Reversal: ${line.description || source.narration || source.entryNumber}`,
      debit: centsToMoney(line.creditCents),
      credit: centsToMoney(line.debitCents),
    })),
  }));
  // Release the source key so a corrected document (invoice, advance) can post again.
  await JournalEntryModel.updateOne(
    { id },
    {
      $set: {
        status: "reversed",
        reversedById: reversal.id,
        reversalReason: reason,
        ...(source.sourceKey ? { sourceKey: `reversed:${id}:${source.sourceKey}` } : {}),
      },
    }
  );
  await createAuditLog({ action: "journal.reversed", entityType: "journal_entry", entityId: id, details: { reversalId: reversal.id, reason }, createdBy: userId });
  return reversal;
}

// ============ REPORTS ============

export async function getAccountStatement(accountId: number) {
  await connectDb();
  const account = await getAccountById(accountId);
  if (!account) return null;
  const entries = await JournalEntryModel.find({ "lines.accountId": accountId })
    .sort({ entryDate: 1, id: 1 })
    .lean<JournalEntryDoc[]>();
  let runningCents = moneyToCents(account.openingBalance) * (account.openingBalanceSide === "debit" ? 1 : -1);
  const transactions = [];
  for (const entry of entries) {
    for (const line of entry.lines.filter(line => line.accountId === accountId)) {
      runningCents += line.debitCents - line.creditCents;
      transactions.push({
        line: lineRow(entry.id, line),
        entry: entryRow(entry),
        runningBalance: centsToMoney(Math.abs(runningCents)),
        runningBalanceSide: runningCents >= 0 ? ("debit" as const) : ("credit" as const),
      });
    }
  }
  return { account: ledgerRow(account), transactions };
}

export async function getTrialBalance() {
  // Every detail ledger with a balance is included (inactive ones too) so the
  // trial balance always reconciles.
  const accounts = (await getLedgerAccounts({ ledgerType: "detail" }))
    .filter(account => account.isActive || account.balance !== "0.00");
  const rows = accounts.map(account => ({
    id: account.id,
    code: account.code,
    title: account.title,
    debit: account.balanceSide === "debit" ? account.balance : "0.00",
    credit: account.balanceSide === "credit" ? account.balance : "0.00",
  }));
  // Opening balances are entered per ledger without an offsetting entry, so the
  // net of all openings is shown as "Opening Balance Equity" to keep the TB balanced.
  const allAccounts = await LedgerAccountModel.find({ ledgerType: "detail", openingBalance: { $nin: [0, null] } }, { openingBalance: 1, openingBalanceSide: 1 }).lean<LedgerDoc[]>();
  const openingNet = allAccounts.reduce(
    (sum, account) => sum + moneyToCents(account.openingBalance) * (account.openingBalanceSide === "debit" ? 1 : -1),
    0
  );
  if (openingNet !== 0) {
    rows.push({
      id: 0,
      code: "OBE",
      title: "Opening Balance Equity (auto)",
      debit: openingNet < 0 ? centsToMoney(-openingNet) : "0.00",
      credit: openingNet > 0 ? centsToMoney(openingNet) : "0.00",
    });
  }
  const totalDebit = rows.reduce((sum, row) => sum + moneyToCents(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + moneyToCents(row.credit), 0);
  return { rows, totalDebit: centsToMoney(totalDebit), totalCredit: centsToMoney(totalCredit) };
}

export async function getFinanceSummary() {
  const accounts = await getLedgerAccounts({ ledgerType: "detail" });
  const signed = (account: (typeof accounts)[number]) => moneyToCents(account.balance) * (account.balanceSide === "debit" ? 1 : -1);
  const sum = (prefix: string, pick: (value: number) => number) =>
    accounts.filter(account => account.code.startsWith(prefix)).reduce((total, account) => total + pick(signed(account)), 0);
  return {
    cash: centsToMoney(sum("CA", value => value)),
    receivables: centsToMoney(sum("CS", value => Math.max(0, value))),
    customerCredits: centsToMoney(sum("CS", value => Math.max(0, -value))),
    vendorPayables: centsToMoney(sum("VN", value => Math.max(0, -value))),
    revenue: centsToMoney(sum("SA", value => Math.max(0, -value))),
    expenses: centsToMoney(sum("EX", value => Math.max(0, value))),
  };
}

// ============ AUTOMATIC POSTINGS ============

export async function getSourceEntry(referenceType: string, referenceId: number) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ sourceKey: `${referenceType}:${referenceId}` }).lean<JournalEntryDoc>();
  return entry ? entryRow(entry) : null;
}

/**
 * Validate (and create if missing) everything an automatic posting needs,
 * so callers can check before writing business records.
 */
export async function ensurePostingReady(customerId: number, userId: number, accountCodes: string[]) {
  await ensureSetupOnce(userId);
  await ensureCustomerLedger(customerId, userId);
  for (const code of accountCodes) {
    const account = await getAccountByCode(code);
    if (!account) throw new Error(`Ledger ${code} is unavailable`);
    if (account.isActive === false) throw new Error(`Ledger ${code} (${account.title}) is inactive. Reactivate it in Finance first.`);
  }
}

export async function postInvoiceToLedger(invoiceId: number, userId: number) {
  await connectDb();
  const invoice = await OrderInvoiceModel.findOne({ id: invoiceId }).lean();
  if (!invoice) throw new Error("Invoice not found");
  if (!invoice.customerId) throw new Error("Invoice customer is required for ledger posting");
  const totalCents = moneyToCents(invoice.totalAmount as number);
  if (totalCents <= 0) throw new Error("Invoice total must be greater than zero before posting");
  await ensureSetupOnce(userId);
  const customerAccount = await ensureCustomerLedger(invoice.customerId as number, userId);
  const salesAccount = await getAccountByCode("SA000001");
  if (!salesAccount) throw new Error("Sales account is unavailable");
  const sourceKey = `order_invoice:${invoice.id}`;
  const journal = await postOnce(sourceKey, () => createJournalEntry({
    entryType: "sales_invoice",
    entryDate: (invoice.invoiceDate as Date | undefined) || new Date(),
    narration: `Sales invoice ${invoice.invoiceNumber || invoice.id}`,
    referenceType: "order_invoice",
    referenceId: invoice.id as number,
    sourceKey,
    createdBy: userId,
    lines: [
      { accountId: customerAccount.id, debit: centsToMoney(totalCents), credit: "0", description: (invoice.remarks as string | undefined) || undefined },
      { accountId: salesAccount.id, debit: "0", credit: centsToMoney(totalCents), description: (invoice.remarks as string | undefined) || undefined },
    ],
  }));
  if (invoice.status === "draft") {
    await OrderInvoiceModel.updateOne({ id: invoiceId }, { $set: { status: "sent" } });
  }
  return journal;
}

export async function postOrderCashAdvance(data: { orderId: number; customerId: number; amount: string; entryDate: Date; userId: number }) {
  const amountCents = moneyToCents(data.amount);
  if (amountCents <= 0) return null;
  await ensureSetupOnce(data.userId);
  const customerAccount = await ensureCustomerLedger(data.customerId, data.userId);
  const cashAccount = await getAccountByCode("CA000001");
  if (!cashAccount) throw new Error("Cash In Hand account is unavailable");
  const order = await OrderModel.findOne({ id: data.orderId }, { orderNumber: 1 }).lean();
  const sourceKey = `order_cash_advance:${data.orderId}`;
  return postOnce(sourceKey, () => createJournalEntry({
    entryType: "customer_advance",
    entryDate: data.entryDate,
    narration: `Customer cash advance for order ${order?.orderNumber || `#${data.orderId}`}`,
    referenceType: "order_cash_advance",
    referenceId: data.orderId,
    sourceKey,
    createdBy: data.userId,
    lines: [
      { accountId: cashAccount.id, debit: centsToMoney(amountCents), credit: "0" },
      { accountId: customerAccount.id, debit: "0", credit: centsToMoney(amountCents) },
    ],
  }));
}

export async function postOrderMetalAdvance(data: { advanceId: number; customerId: number; value: string; entryDate: Date; description?: string; userId: number }) {
  const amountCents = moneyToCents(data.value);
  if (amountCents <= 0) return null;
  await ensureSetupOnce(data.userId);
  const customerAccount = await ensureCustomerLedger(data.customerId, data.userId);
  const inventoryAccount = await getAccountByCode("ST000001");
  if (!inventoryAccount) throw new Error("Gold inventory account is unavailable");
  const sourceKey = `order_metal_advance:${data.advanceId}`;
  return postOnce(sourceKey, () => createJournalEntry({
    entryType: "customer_advance",
    entryDate: data.entryDate,
    narration: data.description || `Customer metal advance #${data.advanceId}`,
    referenceType: "order_metal_advance",
    referenceId: data.advanceId,
    sourceKey,
    createdBy: data.userId,
    lines: [
      { accountId: inventoryAccount.id, debit: centsToMoney(amountCents), credit: "0" },
      { accountId: customerAccount.id, debit: "0", credit: centsToMoney(amountCents) },
    ],
  }));
}

/** True when a source document (invoice, advance) has a live (non-reversed) posting. */
export async function hasActivePosting(referenceType: string, referenceId: number) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ sourceKey: `${referenceType}:${referenceId}` }, { status: 1 }).lean<JournalEntryDoc>();
  return Boolean(entry && entry.status === "posted");
}

export async function getOrderForPosting(orderId: number) {
  await connectDb();
  return OrderModel.findOne({ id: orderId }).lean();
}

export async function getMetalAdvanceForPosting(advanceId: number) {
  await connectDb();
  return OrderAdvanceMetalModel.findOne({ id: advanceId }).lean();
}

/** Ensure every index declared on the models exists (used by the migration script). */
export async function syncFinanceIndexes() {
  await connectDb();
  await Promise.all([LedgerAccountModel.createIndexes(), JournalEntryModel.createIndexes(), AuditLogModel.createIndexes()]);
}

