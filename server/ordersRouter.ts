import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { operationsFinanceProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import * as financeDb from "./financeDb";

const STATUSES = ["saved", "pending", "production", "completed", "delivered", "cancelled"] as const;

const optionalDate = z.string().optional().refine(
  value => !value || !Number.isNaN(new Date(value).getTime()),
  "Invalid date"
);

/** Images are either uploaded through upload.image (/api/files/...) or absolute https URLs. */
const imageUrl = z.string().max(600).refine(
  value => value.startsWith("/api/files/") || value.startsWith("https://"),
  "Invalid image URL"
);

const itemSchema = z.object({
  id: z.number().int().positive().optional(),
  productId: z.number().optional(),
  vendorId: z.number().optional(),
  itemName: z.string().min(1),
  quantity: z.number(),
  unitPrice: z.string().optional(),
  totalPrice: z.string().optional(),
  estimatedMetalType: z.string().optional(),
  estimatedMetalWeight: z.string().optional(),
  estimatedMetalWastage: z.string().optional(),
  estimatedMetalRate: z.string().optional(),
  estimatedMetalValue: z.string().optional(),
  estimatedGemType: z.string().optional(),
  estimatedGemQty: z.number().optional(),
  estimatedGemWeight: z.string().optional(),
  estimatedGemRate: z.string().optional(),
  estimatedGemCalcBy: z.string().optional(),
  estimatedGemValue: z.string().optional(),
  estimatedLabourCharges: z.string().optional(),
  bodyMakingRateType: z.string().optional(),
  stoneSettingRateType: z.string().optional(),
  comments: z.string().optional(),
  images: z.array(imageUrl).max(10).optional(),
});

const metalSchema = z.object({
  id: z.number().int().positive().optional(),
  itemName: z.string().optional(),
  receivedDate: optionalDate,
  weight: z.string().optional(),
  alloy: z.string().optional(),
  wastage: z.string().optional(),
  wastageType: z.enum(["percent", "ratti"]).optional(),
  netWeightRate: z.string().optional(),
  value: z.string().optional(),
  comments: z.string().optional(),
});

const gemSchema = z.object({
  id: z.number().int().positive().optional(),
  itemName: z.string().optional(),
  qty: z.number().optional(),
  weight: z.string().optional(),
  comments: z.string().optional(),
});

type ItemInput = z.infer<typeof itemSchema>;
type MetalInput = z.infer<typeof metalSchema>;
type GemInput = z.infer<typeof gemSchema>;
type User = NonNullable<TrpcContext["user"]>;

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/** Fill net weight from weight + wastage, and value from net weight × rate when not given. */
function normalizeMetal(metal: MetalInput) {
  const { id: _id, receivedDate, ...rest } = metal;
  const weight = Number(metal.weight || 0);
  const wastageType = metal.wastageType ?? "percent";
  const netWeight = weight > 0 ? db.computeNetWeight(weight, Number(metal.wastage || 0), wastageType) : undefined;
  let value = metal.value;
  if ((value === undefined || value === "") && netWeight && Number(metal.netWeightRate || 0) > 0) {
    value = (netWeight * Number(metal.netWeightRate)).toFixed(2);
  }
  return {
    ...rest,
    wastageType,
    netWeight: netWeight !== undefined ? String(netWeight) : undefined,
    value,
    receivedDate: receivedDate ? new Date(receivedDate) : null,
  };
}

function itemData(item: ItemInput) {
  const { id: _id, ...rest } = item;
  return rest;
}

async function assertVendorsExist(items: ItemInput[]) {
  for (const vendorId of Array.from(new Set(items.map(item => item.vendorId).filter(Boolean)))) {
    if (!(await db.getVendorById(vendorId!))) throw bad(`Vendor #${vendorId} does not exist`);
  }
}

async function liveInvoices(orderId: number) {
  return (await db.getOrderInvoices(orderId)).filter(invoice => invoice.status !== "cancelled");
}

/**
 * Bring the order's automatic ledger postings (cash advance, valued metal
 * advances) in line with the order as it is now. A posting whose amount or
 * customer no longer matches is reversed and posted again; a cancelled order
 * keeps no live advance postings. Every change is a reversal, never a delete.
 */
async function syncOrderPostings(orderId: number, user: User, note: string) {
  const existing = await db.getOrderById(orderId);
  if (!existing) return;
  const order = existing.order;
  const active = order.status !== "cancelled" && !!order.customerId;
  const entryDate = order.orderDate ?? new Date();

  const cashCents = active ? financeDb.moneyToCents(order.advanceCash) : 0;
  const cashPosting = await financeDb.getLivePosting("order_cash_advance", orderId);
  let cashLive = !!cashPosting;
  if (cashPosting && (cashPosting.amountCents !== cashCents || cashPosting.customerId !== order.customerId)) {
    await financeDb.reverseJournalEntry(cashPosting.entryId, `${note} (cash advance ${order.orderNumber})`, user.id);
    cashLive = false;
  }
  if (!cashLive && cashCents > 0) {
    await financeDb.postOrderCashAdvance({
      orderId,
      customerId: order.customerId!,
      amount: financeDb.centsToMoney(cashCents),
      entryDate,
      userId: user.id,
    });
  }

  for (const metal of await db.getOrderAdvanceMetals(orderId)) {
    const valueCents = active ? financeDb.moneyToCents(metal.value) : 0;
    const posting = await financeDb.getLivePosting("order_metal_advance", metal.id);
    let live = !!posting;
    if (posting && (posting.amountCents !== valueCents || posting.customerId !== order.customerId)) {
      await financeDb.reverseJournalEntry(posting.entryId, `${note} (metal advance ${order.orderNumber})`, user.id);
      live = false;
    }
    if (!live && valueCents > 0) {
      await financeDb.postOrderMetalAdvance({
        advanceId: metal.id,
        customerId: order.customerId!,
        value: financeDb.centsToMoney(valueCents),
        entryDate: metal.receivedDate ?? entryDate,
        description: `${metal.itemName || "Metal"} advance for ${order.orderNumber}`,
        userId: user.id,
      });
    }
  }
}

async function reverseMetalAdvance(metalId: number, user: User, note: string) {
  const posting = await financeDb.getLivePosting("order_metal_advance", metalId);
  if (posting) await financeDb.reverseJournalEntry(posting.entryId, note, user.id);
}

/** Cancel the order: posted invoices are cancelled (reversed) and advance postings reversed. */
async function cancelOrder(orderId: number, user: User) {
  const invoices = await liveInvoices(orderId);
  const postedInvoices = [];
  for (const invoice of invoices) {
    const posting = await financeDb.getLivePosting("order_invoice", invoice.id);
    if (posting) postedInvoices.push({ invoice, posting });
  }
  if (postedInvoices.length && user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This order has a posted invoice. Only a Super Admin can cancel it, because the invoice will be reversed.",
    });
  }
  for (const invoice of invoices) {
    await db.updateInvoice(invoice.id, { status: "cancelled" });
  }
  for (const { invoice, posting } of postedInvoices) {
    await financeDb.reverseJournalEntry(posting.entryId, `Order cancelled: invoice ${invoice.invoiceNumber || invoice.id}`, user.id);
  }
}

export const ordersRouter = router({
  list: operationsFinanceProcedure
    .input(z.object({
      status: z.string().optional(),
      customerId: z.number().optional(),
      month: z.number().optional(),
      year: z.number().optional(),
    }).optional())
    .query(async ({ input }) => db.getAllOrders(input)),

  getById: operationsFinanceProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const order = await db.getOrderById(input.id);
      if (!order) return null;
      const items = await db.getOrderItems(input.id);
      return { ...order, items };
    }),

  create: operationsFinanceProcedure
    .input(z.object({
      catalogId: z.number().optional(),
      customerId: z.number().optional(),
      totalItems: z.number().optional(),
      totalWeight: z.string().optional(),
      totalPrice: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      description: z.string().optional(),
      comments: z.string().optional(),
      advanceCash: z.string().optional(),
      orderDate: optionalDate,
      expectedDelivery: optionalDate,
      notes: z.string().optional(),
      items: z.array(itemSchema).optional(),
      advanceMetals: z.array(metalSchema).optional(),
      advanceGems: z.array(gemSchema).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { items, expectedDelivery, orderDate, advanceMetals, advanceGems, ...orderData } = input;
      const orderDateValue = orderDate ? new Date(orderDate) : new Date();
      const metals = (advanceMetals ?? []).map(normalizeMetal);
      const hasPostableAdvance =
        Number(orderData.advanceCash || 0) > 0 || metals.some(metal => Number(metal.value || 0) > 0);

      // Validate everything before writing so a bad request never leaves a half-created order.
      if (orderData.customerId) {
        if (!(await db.getCustomerById(orderData.customerId))) throw bad("Selected customer does not exist");
      } else if (hasPostableAdvance) {
        throw bad("Select a customer before recording cash or valued metal advances");
      }
      await assertVendorsExist(items ?? []);
      if (orderData.customerId && hasPostableAdvance) {
        const codes = [
          ...(Number(orderData.advanceCash || 0) > 0 ? ["CA000001"] : []),
          ...(metals.some(metal => Number(metal.value || 0) > 0) ? ["ST000001"] : []),
        ];
        try {
          await financeDb.ensurePostingReady(orderData.customerId, ctx.user.id, codes);
        } catch (error) {
          throw bad((error as Error).message);
        }
      }

      const orderNumber = await db.generateOrderNumber();
      const order = await db.createOrder({
        ...orderData,
        orderNumber,
        orderDate: orderDateValue,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
        createdBy: ctx.user.id,
      });

      if (items?.length) {
        const createdItems = await db.addOrderItems(order.id, items.map(itemData));
        for (const item of createdItems) {
          if (item.vendorId) {
            await db.createOrderProcess({
              orderId: order.id,
              orderItemId: item.id,
              itemName: item.itemName,
              processType: "Body Making",
              vendorId: item.vendorId,
              startDate: orderDateValue,
              expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
              status: "pending",
              comments: "Vendor assigned from Sales Order",
            });
          }
        }
      }
      for (const metal of metals) await db.addOrderAdvanceMetal({ ...metal, orderId: order.id });
      for (const gem of advanceGems ?? []) {
        const { id: _id, ...rest } = gem;
        await db.addOrderAdvanceGem({ ...rest, orderId: order.id });
      }

      await syncOrderPostings(order.id, ctx.user, "Order created");
      return order;
    }),

  /** Quick changes from Order Detail (status, dates, notes, cash advance). */
  update: operationsFinanceProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(STATUSES).optional(),
      expectedDelivery: optionalDate,
      notes: z.string().optional(),
      description: z.string().optional(),
      comments: z.string().optional(),
      advanceCash: z.string().optional(),
      totalItems: z.number().optional(),
      totalWeight: z.string().optional(),
      totalPrice: z.string().optional(),
      customerId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, expectedDelivery, ...data } = input;
      const existing = await db.getOrderById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      const current = existing.order;

      if (data.customerId !== undefined && data.customerId !== current.customerId) {
        if (!(await db.getCustomerById(data.customerId))) throw bad("Selected customer does not exist");
        if ((await liveInvoices(id)).length) throw bad("Customer cannot be changed while the order has an invoice. Cancel the invoice first.");
      }

      const cancelling = data.status === "cancelled" && current.status !== "cancelled";
      if (cancelling) await cancelOrder(id, ctx.user);

      const updateData: Record<string, unknown> = { ...data };
      if (expectedDelivery) updateData.expectedDelivery = new Date(expectedDelivery);
      if (data.status === "completed") updateData.completedDate = new Date();

      const updated = await db.updateOrder(id, updateData);
      await syncOrderPostings(id, ctx.user, cancelling ? "Order cancelled" : "Order updated");
      return updated;
    }),

  /** Full edit from the Sales Order Card. */
  edit: operationsFinanceProcedure
    .input(z.object({
      id: z.number(),
      customerId: z.number(),
      orderDate: optionalDate,
      expectedDelivery: optionalDate,
      description: z.string().optional(),
      notes: z.string().optional(),
      comments: z.string().optional(),
      advanceCash: z.string().optional(),
      status: z.enum(["saved", "pending"]).optional(),
      totalItems: z.number().optional(),
      totalWeight: z.string().optional(),
      totalPrice: z.string().optional(),
      items: z.array(itemSchema).optional(),
      advanceMetals: z.array(metalSchema).optional(),
      advanceGems: z.array(gemSchema).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, items, advanceMetals, advanceGems, orderDate, expectedDelivery, status, ...header } = input;
      const existing = await db.getOrderById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      const current = existing.order;
      if (current.status === "cancelled") throw bad("This order is cancelled and can no longer be edited.");
      if (!(await db.getCustomerById(header.customerId))) throw bad("Selected customer does not exist");

      const invoiced = (await liveInvoices(id)).length > 0;
      if (invoiced) {
        const amountsChanged =
          header.customerId !== current.customerId ||
          financeDb.moneyToCents(header.advanceCash) !== financeDb.moneyToCents(current.advanceCash) ||
          items !== undefined || advanceMetals !== undefined || advanceGems !== undefined;
        if (amountsChanged) {
          throw bad("This order has an invoice. Cancel the invoice first to change the customer, items, advances or amounts.");
        }
      }

      // ---- validate items before writing
      const currentItems = await db.getOrderItemsRaw(id);
      const currentItemIds = new Set(currentItems.map(item => item.id));
      if (items) {
        await assertVendorsExist(items);
        for (const item of items) {
          if (item.id && !currentItemIds.has(item.id)) throw bad(`Item #${item.id} does not belong to this order`);
        }
        const keep = new Set(items.map(item => item.id).filter(Boolean));
        for (const removed of currentItems.filter(item => !keep.has(item.id))) {
          const processes = await db.getProcessesForItem(removed.id);
          if (processes.some(process => process.status !== "pending")) {
            throw bad(`"${removed.itemName}" is already in production and cannot be removed`);
          }
        }
      }
      const currentMetals = await db.getOrderAdvanceMetals(id);
      if (advanceMetals) {
        for (const metal of advanceMetals) {
          if (metal.id && !currentMetals.some(m => m.id === metal.id)) throw bad(`Metal advance #${metal.id} does not belong to this order`);
        }
      }
      const currentGems = await db.getOrderAdvanceGems(id);
      if (advanceGems) {
        for (const gem of advanceGems) {
          if (gem.id && !currentGems.some(g => g.id === gem.id)) throw bad(`Gem advance #${gem.id} does not belong to this order`);
        }
      }

      // ---- header
      await db.updateOrder(id, {
        ...header,
        ...(status && (current.status === "saved" || current.status === "pending") ? { status } : {}),
        ...(orderDate ? { orderDate: new Date(orderDate) } : {}),
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
      });
      const orderDateValue = orderDate ? new Date(orderDate) : current.orderDate ?? new Date();

      // ---- items
      if (items) {
        const keep = new Set(items.map(item => item.id).filter(Boolean));
        for (const removed of currentItems.filter(item => !keep.has(item.id))) await db.deleteOrderItemById(removed.id);
        for (const item of items) {
          if (item.id) {
            const before = currentItems.find(existingItem => existingItem.id === item.id)!;
            await db.updateOrderItem(item.id, { ...itemData(item), images: item.images ?? [] });
            const newVendor = item.vendorId && item.vendorId > 0 ? item.vendorId : null;
            if (newVendor !== (before.vendorId ?? null)) {
              const processes = await db.getProcessesForItem(item.id);
              const bodyMaking = processes.find(process => process.processType === "Body Making" && process.status === "pending");
              if (bodyMaking && newVendor) {
                await db.updateOrderProcess(bodyMaking.id, { vendorId: newVendor });
              } else if (!processes.length && newVendor) {
                await db.createOrderProcess({
                  orderId: id, orderItemId: item.id, itemName: item.itemName, processType: "Body Making",
                  vendorId: newVendor, startDate: orderDateValue, status: "pending", comments: "Vendor assigned from Sales Order",
                });
              }
            }
          } else {
            const [created] = await db.addOrderItems(id, [itemData(item)]);
            if (created?.vendorId) {
              await db.createOrderProcess({
                orderId: id, orderItemId: created.id, itemName: created.itemName, processType: "Body Making",
                vendorId: created.vendorId, startDate: orderDateValue,
                expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
                status: "pending", comments: "Vendor assigned from Sales Order",
              });
            }
          }
        }
      }

      // ---- advance metals (removed ones are reversed before deletion)
      if (advanceMetals) {
        const keep = new Set(advanceMetals.map(metal => metal.id).filter(Boolean));
        for (const removed of currentMetals.filter(metal => !keep.has(metal.id))) {
          await reverseMetalAdvance(removed.id, ctx.user, `Order edited: metal advance removed (${current.orderNumber})`);
          await db.deleteOrderAdvanceMetal(removed.id);
        }
        for (const metal of advanceMetals) {
          const data = normalizeMetal(metal);
          if (metal.id) await db.updateOrderAdvanceMetal(metal.id, data);
          else await db.addOrderAdvanceMetal({ ...data, orderId: id });
        }
      }

      // ---- advance gems
      if (advanceGems) {
        const keep = new Set(advanceGems.map(gem => gem.id).filter(Boolean));
        for (const removed of currentGems.filter(gem => !keep.has(gem.id))) await db.deleteOrderAdvanceGem(removed.id);
        for (const gem of advanceGems) {
          const { id: gemId, ...rest } = gem;
          if (gemId) await db.updateOrderAdvanceGem(gemId, rest);
          else await db.addOrderAdvanceGem({ ...rest, orderId: id });
        }
      }

      await syncOrderPostings(id, ctx.user, "Order edited");
      await financeDb.createAuditLog({ action: "order.edited", entityType: "order", entityId: id, details: { orderNumber: current.orderNumber }, createdBy: ctx.user.id });
      return (await db.getOrderById(id))!.order;
    }),

  delete: operationsFinanceProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const metals = await db.getOrderAdvanceMetals(input.id);
      const postings = await Promise.all([
        financeDb.hasActivePosting("order_cash_advance", input.id),
        ...metals.map(metal => financeDb.hasActivePosting("order_metal_advance", metal.id)),
      ]);
      if (postings.some(Boolean)) {
        throw bad("This order has posted advances. Cancel the order instead (its ledger entries are reversed automatically).");
      }
      try {
        await db.deleteOrder(input.id);
      } catch (error) {
        throw bad((error as Error).message);
      }
      return { success: true };
    }),
});

export const orderAdvancesHelpers = { normalizeMetal, reverseMetalAdvance, syncOrderPostings };
