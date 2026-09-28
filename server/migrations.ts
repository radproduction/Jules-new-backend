import { Schema } from "mongoose";
import {
  connectDb,
  CustomerModel,
  ensureModel,
  OrderAdvanceGemModel,
  OrderAdvanceMetalModel,
  OrderInvoiceItemModel,
  OrderInvoiceModel,
  OrderItemModel,
  OrderModel,
  OrderProcessModel,
  ProductModel,
  UserModel,
  VendorModel,
} from "./db";
import { AuditLogModel, ensureFinanceSetup, JournalEntryModel, LedgerAccountModel } from "./financeDb";

/**
 * Versioned, idempotent MongoDB migrations.
 *
 * MongoDB creates collections on first write, so "adding tables" means:
 * creating the indexes/constraints (createIndexes never drops existing ones) for the new collections and back-filling
 * fields that existing documents do not have yet. Each migration is recorded
 * in the `schema_migrations` collection and runs only once; every step is
 * also safe to re-run.
 */

const MigrationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    appliedAt: { type: Date, default: Date.now },
    details: { type: String },
  },
  { collection: "schema_migrations" }
);
const MigrationModel = ensureModel("SchemaMigration", MigrationSchema);

type Migration = {
  name: string;
  run: () => Promise<Record<string, unknown>>;
};

const MIGRATIONS: Migration[] = [
  {
    // Orders -> Production -> Invoice -> Finance release + role-based access.
    name: "2026-09-28-order-production-invoice-finance-roles",
    run: async () => {
      // 1. Indexes / unique constraints for new and extended collections.
      //    Each model is handled separately so one conflict cannot block the rest;
      //    any failure is reported and the migration is retried on next start.
      const models = {
        users: UserModel,
        customers: CustomerModel,
        orders: OrderModel,
        order_items: OrderItemModel,
        vendors: VendorModel,
        order_processes: OrderProcessModel,
        order_advance_metals: OrderAdvanceMetalModel,
        order_advance_gems: OrderAdvanceGemModel,
        order_invoices: OrderInvoiceModel,
        order_invoice_items: OrderInvoiceItemModel,
        ledger_accounts: LedgerAccountModel,
        journal_entries: JournalEntryModel,
        audit_logs: AuditLogModel,
      };
      const indexErrors: string[] = [];
      for (const [name, model] of Object.entries(models)) {
        try {
          await model.createIndexes();
        } catch (error) {
          indexErrors.push(`${name}: ${(error as Error).message}`);
        }
      }
      if (indexErrors.length) {
        throw new Error(`Index creation failed (existing data conflicts?): ${indexErrors.join(" | ")}`);
      }

      // 2. Users: every existing account stays active; roles are unchanged
      //    (the seeded owner remains "admin" = Super Admin).
      const users = await UserModel.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });

      // 3. Orders: new money field defaults.
      const orders = await OrderModel.updateMany({ advanceCash: { $exists: false } }, { $set: { advanceCash: 0 } });

      // 4. Order items: item name is now required on every line.
      const unnamed = await OrderItemModel.find({ $or: [{ itemName: { $exists: false } }, { itemName: null }, { itemName: "" }] }).lean();
      let namedItems = 0;
      if (unnamed.length) {
        const products = await ProductModel
          .find({ id: { $in: unnamed.map(item => item.productId).filter(Boolean) } }, { id: 1, name: 1 })
          .lean<Array<{ id: number; name?: string }>>();
        const names = new Map(products.map(product => [product.id, product.name]));
        for (const item of unnamed) {
          await OrderItemModel.updateOne(
            { id: item.id },
            { $set: { itemName: (item.productId ? names.get(item.productId) : undefined) || "Item" } }
          );
          namedItems++;
        }
      }

      // 5. Chart of accounts + a detail ledger for every existing customer/vendor.
      await ensureFinanceSetup();

      return {
        usersActivated: users.modifiedCount,
        ordersDefaulted: orders.modifiedCount,
        orderItemsNamed: namedItems,
      };
    },
  },
];

export async function runMigrations(log: (message: string) => void = console.log) {
  await connectDb();
  await MigrationModel.createIndexes();
  for (const migration of MIGRATIONS) {
    const applied = await MigrationModel.findOne({ name: migration.name }).lean();
    if (applied) continue;
    log(`[migrations] applying ${migration.name}`);
    try {
      const details = await migration.run();
      await MigrationModel.updateOne(
        { name: migration.name },
        { $setOnInsert: { name: migration.name, appliedAt: new Date(), details: JSON.stringify(details) } },
        { upsert: true }
      );
      log(`[migrations] applied ${migration.name} ${JSON.stringify(details)}`);
    } catch (error) {
      // Every step is idempotent, so a failed migration is simply retried on the
      // next start. The API keeps serving; finance setup also self-heals lazily.
      console.error(`[migrations] ${migration.name} failed and will be retried on next start:`, error);
      if (process.env.MIGRATIONS_STRICT === "true") throw error;
    }
  }
}
