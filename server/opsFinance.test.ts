import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { UserRole } from "./_core/types";
import { orderItems, orders } from "../drizzle/schema";
import { toRow } from "./rows";

// Auto-mock the data layers; the router's business rules are what we test here.
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" && !key.endsWith("Model") && key !== "ensureModel" ? vi.fn() : value,
    ])
  );
});
vi.mock("./financeDb", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const keep = new Set(["moneyToCents", "centsToMoney"]);
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" && !key.endsWith("Model") && !keep.has(key) ? vi.fn() : value,
    ])
  );
});

import * as db from "./db";
import * as financeDb from "./financeDb";

function caller(role: UserRole | null, id = 1) {
  const ctx: TrpcContext = {
    user: role ? { id, email: `${role}@example.com`, name: `${role} user`, role } : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

const existingOrder = (overrides: Record<string, unknown> = {}) => ({
  order: { id: 10, orderNumber: "JO26090001", customerId: 5, advanceCash: "0.00", orderDate: new Date("2026-09-01"), ...overrides },
  customer: { id: 5, firstName: "Ayesha" },
  catalog: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getAllOrders).mockResolvedValue([]);
  vi.mocked(financeDb.getFinanceSummary).mockResolvedValue({
    cash: "0.00", receivables: "0.00", customerCredits: "0.00", vendorPayables: "0.00", revenue: "0.00", expenses: "0.00",
  });
  vi.mocked(financeDb.hasActivePosting).mockResolvedValue(false);
  vi.mocked(financeDb.getSourceEntry).mockResolvedValue(null);
  vi.mocked(db.getOrderAdvanceMetals).mockResolvedValue([]);
  vi.mocked(db.getOrderInvoices).mockResolvedValue([]);
});

describe("role-based access", () => {
  it("blocks accounts awaiting approval from business data", async () => {
    await expect(caller("user").finance.summary()).rejects.toThrow(/awaiting access approval/i);
    await expect(caller("user").orders.list()).rejects.toThrow(/awaiting access approval/i);
  });

  it("requires sign-in", async () => {
    await expect(caller(null).orders.list()).rejects.toThrow(/login/i);
  });

  it("gives Operations & Finance customers, orders, invoices and finance", async () => {
    const ops = caller("operations_finance");
    await expect(ops.orders.list()).resolves.toEqual([]);
    await expect(ops.finance.summary()).resolves.toHaveProperty("cash");
    vi.mocked(db.getAllInvoices).mockResolvedValue([]);
    await expect(ops.invoices.list()).resolves.toEqual([]);
  });

  it("keeps catalog, product and access management for the Super Admin", async () => {
    const ops = caller("operations_finance");
    await expect(ops.products.list()).rejects.toThrow(/permission/i);
    await expect(ops.catalogs.list()).rejects.toThrow(/permission/i);
    await expect(ops.access.users()).rejects.toThrow(/permission/i);
    await expect(ops.finance.journals.reverse({ id: 1, reason: "test" })).rejects.toThrow(/permission/i);

    vi.mocked(financeDb.listUsers).mockResolvedValue([]);
    await expect(caller("admin").access.users()).resolves.toEqual([]);
  });
});

describe("users & access", () => {
  it("lets the Super Admin create a staff login and audits it", async () => {
    vi.mocked(db.createUserAccount).mockResolvedValue({ id: 7, email: "ops@jules.pk", role: "operations_finance" } as any);
    const created = await caller("admin").access.createUser({
      name: "Ops", email: "ops@jules.pk", password: "longpassword", role: "operations_finance",
    });
    expect(created.id).toBe(7);
    expect(financeDb.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "user.created", entityId: 7 }));
  });

  it("rejects short passwords", async () => {
    await expect(caller("admin").access.createUser({ name: "Ops", email: "ops@jules.pk", password: "short", role: "operations_finance" }))
      .rejects.toThrow(/8 characters/);
  });

  it("prevents a Super Admin from removing their own access", async () => {
    await expect(caller("admin", 1).access.updateRole({ userId: 1, role: "operations_finance" })).rejects.toThrow(/own Super Admin/);
    await expect(caller("admin", 1).access.setActive({ userId: 1, isActive: false })).rejects.toThrow(/own account/);
  });
});

describe("sales orders", () => {
  const baseItem = { itemName: "Necklace", quantity: 1, estimatedMetalValue: "100000", estimatedLabourCharges: "5000" };

  beforeEach(() => {
    vi.mocked(db.getCustomerById).mockResolvedValue({ id: 5, firstName: "Ayesha" } as any);
    vi.mocked(db.getVendorById).mockResolvedValue({ id: 3, name: "Karigar" } as any);
    vi.mocked(db.generateOrderNumber).mockResolvedValue("JO26090001");
    vi.mocked(db.createOrder).mockImplementation(async (data: any) => ({ id: 10, ...data, advanceCash: data.advanceCash ?? "0.00" }));
    vi.mocked(db.addOrderItems).mockImplementation(async (_orderId: number, items: any[]) =>
      items.map((item, index) => ({ id: 100 + index, ...item })));
    vi.mocked(db.addOrderAdvanceMetal).mockImplementation(async (data: any) => ({ id: 55, ...data }));
  });

  it("creates the vendor production process and posts advances", async () => {
    await caller("operations_finance").orders.create({
      customerId: 5,
      orderDate: "2026-09-28",
      advanceCash: "25000",
      items: [{ ...baseItem, vendorId: 3 }],
      advanceMetals: [{ itemName: "Old gold", value: "40000" }],
      advanceGems: [{ itemName: "Ruby", qty: 2 }],
    });
    expect(db.createOrderProcess).toHaveBeenCalledWith(expect.objectContaining({ orderItemId: 100, vendorId: 3, processType: "Body Making" }));
    expect(financeDb.postOrderCashAdvance).toHaveBeenCalledWith(expect.objectContaining({ orderId: 10, customerId: 5, amount: "25000" }));
    expect(financeDb.postOrderMetalAdvance).toHaveBeenCalledWith(expect.objectContaining({ advanceId: 55, value: "40000" }));
    expect(db.addOrderAdvanceGem).toHaveBeenCalledWith(expect.objectContaining({ orderId: 10, itemName: "Ruby" }));
  });

  it("persists the selected order date", async () => {
    await caller("operations_finance").orders.create({ customerId: 5, orderDate: "2026-04-27", items: [baseItem] });
    const payload = vi.mocked(db.createOrder).mock.calls[0][0] as any;
    expect(payload.orderDate.toISOString().slice(0, 10)).toBe("2026-04-27");
  });

  it("refuses advances without a customer, before writing anything", async () => {
    await expect(caller("operations_finance").orders.create({ advanceCash: "1000", items: [baseItem] }))
      .rejects.toThrow(/Select a customer/);
    expect(db.createOrder).not.toHaveBeenCalled();
  });

  it("refuses unknown vendors, before writing anything", async () => {
    vi.mocked(db.getVendorById).mockResolvedValue(null);
    await expect(caller("operations_finance").orders.create({ customerId: 5, items: [{ ...baseItem, vendorId: 99 }] }))
      .rejects.toThrow(/Vendor #99/);
    expect(db.createOrder).not.toHaveBeenCalled();
  });

  it("does not let a posted cash advance be silently changed", async () => {
    vi.mocked(db.getOrderById).mockResolvedValue(existingOrder({ advanceCash: "25000.00" }) as any);
    vi.mocked(financeDb.hasActivePosting).mockResolvedValue(true);
    vi.mocked(financeDb.getSourceEntry).mockResolvedValue({ id: 1, totalDebit: "25000.00", status: "posted" } as any);
    await expect(caller("operations_finance").orders.update({ id: 10, advanceCash: "30000" })).rejects.toThrow(/already posted/);
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("blocks deleting an order with posted advances", async () => {
    vi.mocked(financeDb.hasActivePosting).mockResolvedValue(true);
    await expect(caller("operations_finance").orders.delete({ id: 10 })).rejects.toThrow(/posted advances/);
    expect(db.deleteOrder).not.toHaveBeenCalled();
  });
});

describe("invoices", () => {
  beforeEach(() => {
    vi.mocked(db.getOrderById).mockResolvedValue(existingOrder() as any);
    vi.mocked(db.getOrderItemsRaw).mockResolvedValue([
      { estimatedMetalValue: "100000.00", estimatedGemValue: "20000.00", estimatedLabourCharges: "5000.00" },
      { estimatedMetalValue: "50000.50", estimatedGemValue: null, estimatedLabourCharges: "0.00" },
    ] as any);
    vi.mocked(db.generateInvoiceNumber).mockResolvedValue("INV26090001");
    vi.mocked(db.createInvoice).mockImplementation(async (data: any) => ({ id: 77, ...data }));
    vi.mocked(db.getInvoiceById).mockResolvedValue(null);
  });

  it("derives the total from its components and posts Customer Dr / Sales Cr", async () => {
    await caller("operations_finance").invoices.create({ orderId: 10, otherCharges: "1000", discount: "500" });
    const payload = vi.mocked(db.createInvoice).mock.calls[0][0] as any;
    expect(payload).toMatchObject({
      customerId: 5,
      metalValue: "150000.50",
      stoneValue: "20000.00",
      makingCharges: "5000.00",
      otherCharges: "1000.00",
      discount: "500.00",
      totalAmount: "175500.50",
      status: "sent",
    });
    expect(financeDb.postInvoiceToLedger).toHaveBeenCalledWith(77, 1);
  });

  it("rejects a discount larger than the invoice", async () => {
    await expect(caller("operations_finance").invoices.create({ orderId: 10, discount: "9999999" })).rejects.toThrow(/Discount/);
  });

  it("requires a customer to invoice", async () => {
    vi.mocked(db.getOrderById).mockResolvedValue(existingOrder({ customerId: null }) as any);
    await expect(caller("operations_finance").invoices.create({ orderId: 10 })).rejects.toThrow(/Assign a customer/);
  });

  it("only lets the Super Admin cancel a posted invoice", async () => {
    vi.mocked(db.getInvoiceById).mockResolvedValue({ id: 77, status: "sent", metalValue: "100.00", stoneValue: "0.00", makingCharges: "0.00", otherCharges: "0.00", discount: "0.00", totalAmount: "100.00" } as any);
    vi.mocked(financeDb.getSourceEntry).mockResolvedValue({ id: 900, status: "posted" } as any);
    await expect(caller("operations_finance").invoices.update({ id: 77, status: "cancelled" })).rejects.toThrow(/Super Admin/);
    await expect(caller("operations_finance").invoices.update({ id: 77, status: "draft" })).rejects.toThrow(/back to draft/);
    expect(financeDb.reverseJournalEntry).not.toHaveBeenCalled();
  });

  it("posts before marking an unposted invoice as sent", async () => {
    vi.mocked(db.getInvoiceById).mockResolvedValue({ id: 78, status: "draft", metalValue: "100.00", stoneValue: "0.00", makingCharges: "0.00", otherCharges: "0.00", discount: "0.00", totalAmount: "100.00" } as any);
    vi.mocked(financeDb.postInvoiceToLedger).mockRejectedValue(new Error("Sales account is unavailable"));
    await expect(caller("operations_finance").invoices.update({ id: 78, status: "sent" })).rejects.toThrow(/Sales account/);
    expect(db.updateInvoice).not.toHaveBeenCalledWith(78, { status: "sent" });
  });

  it("locks amounts on posted invoices and reverses the posting on cancel", async () => {
    vi.mocked(db.getInvoiceById).mockResolvedValue({ id: 77, invoiceNumber: "INV26090001", status: "sent", metalValue: "100.00", stoneValue: "0.00", makingCharges: "0.00", otherCharges: "0.00", discount: "0.00", totalAmount: "100.00" } as any);
    vi.mocked(financeDb.getSourceEntry).mockResolvedValue({ id: 900, status: "posted" } as any);

    await expect(caller("operations_finance").invoices.update({ id: 77, metalValue: "200" })).rejects.toThrow(/posted to the ledger/);

    await caller("admin").invoices.update({ id: 77, status: "cancelled" });
    expect(financeDb.reverseJournalEntry).toHaveBeenCalledWith(900, expect.stringContaining("cancelled"), 1);
  });
});

describe("customers", () => {
  it("creates the customer ledger automatically", async () => {
    vi.mocked(db.createCustomer).mockResolvedValue({ id: 12, firstName: "Sara" } as any);
    await caller("operations_finance").customers.create({ firstName: "Sara" });
    expect(financeDb.ensureCustomerLedger).toHaveBeenCalledWith(12, 1);
  });

  it("does not wipe the email on a partial update", async () => {
    vi.mocked(db.updateCustomer).mockResolvedValue({ id: 12 } as any);
    await caller("operations_finance").customers.update({ id: 12, phone: "0300" });
    expect(db.updateCustomer).toHaveBeenCalledWith(12, { phone: "0300" });
  });

  it("surfaces accounting protection when deleting", async () => {
    vi.mocked(financeDb.assertCustomerLedgerDeletable).mockRejectedValue(new Error("This customer has accounting entries and cannot be deleted"));
    await expect(caller("operations_finance").customers.delete({ id: 12 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.deleteCustomer).not.toHaveBeenCalled();
  });
});

describe("row serialization", () => {
  it("returns decimals as fixed-scale strings and applies literal defaults", () => {
    const row = toRow(orders, { id: 1, orderNumber: "JO1", totalPrice: 1250.5, totalWeight: 12.3456, _id: "x", orderDate: "2026-09-28" });
    expect(row.totalPrice).toBe("1250.50");
    expect(row.totalWeight).toBe("12.346");
    expect(row.advanceCash).toBe("0.00");
    expect(row.status).toBe("saved");
    expect(row.orderDate).toBeInstanceOf(Date);
    expect(row.customerId).toBeNull();
    expect((row as any)._id).toBeUndefined();
  });

  it("keeps nullable decimals null", () => {
    const row = toRow(orderItems, { id: 2, orderId: 1, itemName: "Ring" });
    expect(row.estimatedMetalValue).toBeNull();
    expect(row.estimatedLabourCharges).toBe("0.00");
    expect(row.bodyMakingRateType).toBe("simple");
  });
});

describe("money helpers", () => {
  it("converts without floating point drift", () => {
    expect(financeDb.moneyToCents("0.1") + financeDb.moneyToCents("0.2")).toBe(30);
    expect(financeDb.centsToMoney(17550050)).toBe("175500.50");
    expect(financeDb.moneyToCents("")).toBe(0);
    expect(() => financeDb.moneyToCents("abc")).toThrow(/Invalid/);
    expect(financeDb.moneyToCents("1.005")).toBe(101);
    expect(financeDb.moneyToCents(1.005)).toBe(101);
    expect(financeDb.moneyToCents("1,250,000.5")).toBe(125000050);
    expect(financeDb.moneyToCents("-12.345")).toBe(-1235);
    expect(financeDb.moneyToCents(".5")).toBe(50);
  });
});
