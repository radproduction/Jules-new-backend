/**
 * JULES data contract.
 *
 * The runtime database is MongoDB (see server/db.ts and server/financeDb.ts).
 * These Drizzle table definitions are kept as the single source of truth for
 * the *row shapes* the API returns (decimals as fixed-scale strings, dates as
 * Date objects, nullable columns as null). server/rows.ts uses them to
 * serialize Mongo documents so the frontend receives exactly these shapes.
 * The .sql files in this folder are legacy MySQL artifacts and are not used.
 */
import { AnyMySqlColumn, int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, date } from "drizzle-orm/mysql-core";

// Core user table backing auth flow (email + password login, bcrypt hash kept server-side only)
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  role: mysqlEnum("role", ["user", "operations_finance", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Gold prices - daily gold price tracking for 22k and 24k
export const goldPrices = mysqlTable("gold_prices", {
  id: int("id").autoincrement().primaryKey(),
  priceDate: date("priceDate").notNull(),
  price22k: decimal("price22k", { precision: 12, scale: 2 }).notNull(), // PKR per tola
  price24k: decimal("price24k", { precision: 12, scale: 2 }).notNull(), // PKR per tola
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type GoldPrice = typeof goldPrices.$inferSelect;
export type InsertGoldPrice = typeof goldPrices.$inferInsert;

// Product categories
export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

// Products - jewelry items with all relevant fields
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  sku: varchar("sku", { length: 50 }),
  categoryId: int("categoryId").references(() => categories.id),
  
  // Gold details
  goldKarat: mysqlEnum("goldKarat", ["22k", "24k"]),
  goldWeight: decimal("goldWeight", { precision: 10, scale: 3 }), // in tola (including wastage)
  goldWastage: decimal("goldWastage", { precision: 5, scale: 2 }), // wastage percentage
  goldRateAtOrder: decimal("goldRateAtOrder", { precision: 12, scale: 2 }), // gold rate when product was created/ordered
  
  // Making charges
  makingCharges: decimal("makingCharges", { precision: 12, scale: 2 }), // PKR
  makingChargesType: mysqlEnum("makingChargesType", ["fixed", "per_gram"]).default("fixed"),
  
  // Diamond details
  diamondWeight: decimal("diamondWeight", { precision: 10, scale: 3 }), // in carats
  diamondRate: decimal("diamondRate", { precision: 12, scale: 2 }), // PKR per carat
  diamondPrice: decimal("diamondPrice", { precision: 12, scale: 2 }), // total diamond price
  
  // Stone details (emerald, sapphire, ruby, etc.)
  stoneType: varchar("stoneType", { length: 100 }),
  stoneWeight: decimal("stoneWeight", { precision: 10, scale: 3 }), // in carats
  stoneRate: decimal("stoneRate", { precision: 12, scale: 2 }), // PKR per carat
  stonePrice: decimal("stonePrice", { precision: 12, scale: 2 }), // total stone price
  
  // Images (JSON array of URLs)
  images: text("images"), // JSON array
  primaryImage: text("primaryImage"),
  
  // Pricing
  basePrice: decimal("basePrice", { precision: 12, scale: 2 }), // calculated gold price
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }), // final price
  
  // Status
  isActive: boolean("isActive").default(true),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// Customers
export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Pakistan"),
  paymentStatus: mysqlEnum("paymentStatus", ["paid", "unpaid"]).default("unpaid"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// Catalogs
export const catalogs = mysqlTable("catalogs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coverImage: text("coverImage"),
  productType: varchar("productType", { length: 100 }), // tag for product type
  customFields: text("customFields"), // JSON for additional custom fields
  
  // Customer assignment
  customerId: int("customerId").references(() => customers.id),
  
  // Public preview
  publicToken: varchar("publicToken", { length: 64 }).unique(), // for public preview link
  isPublic: boolean("isPublic").default(true),
  
  // Status
  status: mysqlEnum("status", ["draft", "published", "archived"]).default("draft"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Catalog = typeof catalogs.$inferSelect;
export type InsertCatalog = typeof catalogs.$inferInsert;

// Catalog Products - junction table
export const catalogProducts = mysqlTable("catalog_products", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatalogProduct = typeof catalogProducts.$inferSelect;
export type InsertCatalogProduct = typeof catalogProducts.$inferInsert;

// Catalog Likes - for public preview
export const catalogLikes = mysqlTable("catalog_likes", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  visitorId: varchar("visitorId", { length: 64 }), // anonymous visitor identifier
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatalogLike = typeof catalogLikes.$inferSelect;
export type InsertCatalogLike = typeof catalogLikes.$inferInsert;

// Catalog Comments - for public preview feedback
export const catalogComments = mysqlTable("catalog_comments", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id),
  visitorName: varchar("visitorName", { length: 100 }),
  comment: text("comment").notNull(),
  isRead: boolean("isRead").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatalogComment = typeof catalogComments.$inferSelect;
export type InsertCatalogComment = typeof catalogComments.$inferInsert;

// Vendors - craftsmen/workshops who make jewelry
export const vendors = mysqlTable("vendors", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).unique(), // VN 000001 format
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  specialization: varchar("specialization", { length: 255 }), // Body Making, Stone Setting, etc.
  isActive: boolean("isActive").default(true),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = typeof vendors.$inferInsert;

// Orders
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),
  catalogId: int("catalogId").references(() => catalogs.id),
  customerId: int("customerId").references(() => customers.id),
  
  // Order details
  description: text("description"),
  comments: text("comments"),
  totalItems: int("totalItems").default(0),
  totalWeight: decimal("totalWeight", { precision: 10, scale: 3 }), // total gold weight
  totalPrice: decimal("totalPrice", { precision: 14, scale: 2 }),
  advanceCash: decimal("advanceCash", { precision: 14, scale: 2 }).default("0"),
  
  // Status: saved = draft, pending = confirmed awaiting production, production, completed, delivered, cancelled
  status: mysqlEnum("status", ["saved", "pending", "production", "completed", "delivered", "cancelled"]).default("saved"),
  
  // Dates
  orderDate: timestamp("orderDate").defaultNow().notNull(),
  expectedDelivery: date("expectedDelivery"),
  completedDate: timestamp("completedDate"),
  
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// Collections (like Apple Photos albums)
export const collections = mysqlTable("collections", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coverImage: text("coverImage"),
  productCount: int("productCount").default(0),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type Collection = typeof collections.$inferSelect;
export type InsertCollection = typeof collections.$inferInsert;

// Collection Products - junction table
export const collectionProducts = mysqlTable("collection_products", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").references(() => collections.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CollectionProduct = typeof collectionProducts.$inferSelect;
export type InsertCollectionProduct = typeof collectionProducts.$inferInsert;

// Order Items - each jewelry piece in the order (Necklace, Earrings, Baalis, etc.)
export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  productId: int("productId").references(() => products.id),
  vendorId: int("vendorId").references(() => vendors.id),
  itemName: varchar("itemName", { length: 255 }).notNull(), // e.g. "Necklace", "Earrings", "Baalis"
  quantity: int("quantity").default(1),
  
  // Estimated Metal
  estimatedMetalType: varchar("estimatedMetalType", { length: 50 }), // Gold 22k, Gold 24k
  estimatedMetalWeight: decimal("estimatedMetalWeight", { precision: 10, scale: 3 }),
  estimatedMetalWastage: decimal("estimatedMetalWastage", { precision: 5, scale: 2 }),
  estimatedMetalRate: decimal("estimatedMetalRate", { precision: 12, scale: 2 }),
  estimatedMetalValue: decimal("estimatedMetalValue", { precision: 14, scale: 2 }),
  
  // Estimated Gems
  estimatedGemType: varchar("estimatedGemType", { length: 100 }),
  estimatedGemQty: int("estimatedGemQty"),
  estimatedGemWeight: decimal("estimatedGemWeight", { precision: 10, scale: 3 }),
  estimatedGemRate: decimal("estimatedGemRate", { precision: 12, scale: 2 }),
  estimatedGemCalcBy: varchar("estimatedGemCalcBy", { length: 20 }), // 'weight' or 'quantity'
  estimatedGemValue: decimal("estimatedGemValue", { precision: 14, scale: 2 }),
  
  // Labour
  estimatedLabourCharges: decimal("estimatedLabourCharges", { precision: 12, scale: 2 }).default("0"),
  bodyMakingRateType: varchar("bodyMakingRateType", { length: 20 }).default("simple"), // simple or detailed
  stoneSettingRateType: varchar("stoneSettingRateType", { length: 20 }).default("simple"),
  
  // Pricing
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  comments: text("comments"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// Order Processes - tracks each manufacturing process per order item
export const orderProcesses = mysqlTable("order_processes", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  orderItemId: int("orderItemId").references(() => orderItems.id),
  itemName: varchar("itemName", { length: 255 }), // e.g. "Necklace"
  processType: varchar("processType", { length: 100 }).notNull(), // Body Making, Stone Setting, Polishing, Rhodium, etc.
  vendorId: int("vendorId").references(() => vendors.id),
  
  // Dates
  startDate: date("startDate"),
  expectedDeliveryDate: date("expectedDeliveryDate"),
  actualDeliveryDate: date("actualDeliveryDate"),
  
  // Status
  status: mysqlEnum("processStatus", ["pending", "in_progress", "complete"]).default("pending"),
  
  // Body Issue (metal given to vendor)
  issueBodyWeight: decimal("issueBodyWeight", { precision: 10, scale: 3 }),
  issueBodyUnit: varchar("issueBodyUnit", { length: 10 }).default("gm"),
  
  // Body Return (metal returned by vendor)
  returnBodyMetal: varchar("returnBodyMetal", { length: 50 }), // Gold 22k, Gold 24k
  returnBodyWeight: decimal("returnBodyWeight", { precision: 10, scale: 3 }),
  returnBodyUnit: varchar("returnBodyUnit", { length: 10 }).default("gm"),
  returnBodyPieces: int("returnBodyPieces").default(1),
  
  // Gems Issue to Vendor
  gemsIssueType: varchar("gemsIssueType", { length: 100 }),
  gemsIssueSource: varchar("gemsIssueSource", { length: 50 }), // Our Stock, Customer Stock
  gemsIssueDate: date("gemsIssueDate"),
  gemsIssueWeight: decimal("gemsIssueWeight", { precision: 10, scale: 3 }),
  gemsIssueWeightUnit: varchar("gemsIssueWeightUnit", { length: 10 }).default("carats"),
  gemsIssueQty: int("gemsIssueQty"),
  
  // Gems Return from Vendor
  gemsReturnWeight: decimal("gemsReturnWeight", { precision: 10, scale: 3 }),
  gemsReturnQty: int("gemsReturnQty"),
  gemsReturnDate: date("gemsReturnDate"),
  
  // Labour
  lumpSumLabour: decimal("lumpSumLabour", { precision: 12, scale: 2 }).default("0"),
  
  comments: text("comments"),
  isClosed: boolean("isClosed").default(false),
  closedDate: date("closedDate"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OrderProcess = typeof orderProcesses.$inferSelect;
export type InsertOrderProcess = typeof orderProcesses.$inferInsert;

// Order Invoices - generated from completed orders
export const orderInvoices = mysqlTable("order_invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).unique(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  customerId: int("customerId").references(() => customers.id),
  
  remarks: text("remarks"),
  invoiceDate: date("invoiceDate"),
  
  // Totals
  metalValue: decimal("metalValue", { precision: 14, scale: 2 }).default("0"),
  stoneValue: decimal("stoneValue", { precision: 14, scale: 2 }).default("0"),
  makingCharges: decimal("makingCharges", { precision: 14, scale: 2 }).default("0"),
  otherCharges: decimal("otherCharges", { precision: 14, scale: 2 }).default("0"),
  discount: decimal("discount", { precision: 14, scale: 2 }).default("0"),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0"),
  
  status: mysqlEnum("invoiceStatus", ["draft", "sent", "paid", "cancelled"]).default("draft"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),
});

export type OrderInvoice = typeof orderInvoices.$inferSelect;
export type InsertOrderInvoice = typeof orderInvoices.$inferInsert;

// Order Invoice Items - line items on the invoice
export const orderInvoiceItems = mysqlTable("order_invoice_items", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").references(() => orderInvoices.id).notNull(),
  itemName: varchar("itemName", { length: 255 }).notNull(), // e.g. "Necklace"
  particular: varchar("particular", { length: 255 }), // e.g. "Our - Gold 22k", "Our - Emeralds - 01"
  qty: int("qty"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  weightUnit: varchar("weightUnit", { length: 10 }).default("gm"),
  wastage: decimal("wastage", { precision: 5, scale: 2 }),
  netWeight: decimal("netWeight", { precision: 10, scale: 3 }),
  rate: decimal("rate", { precision: 12, scale: 2 }),
  calculateBy: varchar("calculateBy", { length: 20 }).default("weight"), // weight or percentage
  amount: decimal("amount", { precision: 14, scale: 2 }),
  sortOrder: int("sortOrder").default(0),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderInvoiceItem = typeof orderInvoiceItems.$inferSelect;
export type InsertOrderInvoiceItem = typeof orderInvoiceItems.$inferInsert;

// Advance Metals - metals given in advance by customer for an order
export const orderAdvanceMetals = mysqlTable("order_advance_metals", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  itemName: varchar("itemName", { length: 255 }),
  receivedDate: date("receivedDate"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  alloy: varchar("alloy", { length: 50 }),
  netWeightRate: decimal("netWeightRate", { precision: 12, scale: 2 }),
  value: decimal("value", { precision: 14, scale: 2 }),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderAdvanceMetal = typeof orderAdvanceMetals.$inferSelect;
export type InsertOrderAdvanceMetal = typeof orderAdvanceMetals.$inferInsert;

// Advance Gems - gems given in advance by customer for an order
export const orderAdvanceGems = mysqlTable("order_advance_gems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  itemName: varchar("itemName", { length: 255 }),
  qty: int("qty"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderAdvanceGem = typeof orderAdvanceGems.$inferSelect;
export type InsertOrderAdvanceGem = typeof orderAdvanceGems.$inferInsert;

// Ledger Accounts - control/detail chart of accounts with entity-linked subledgers
export const ledgerAccounts = mysqlTable("ledger_accounts", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  accountClass: mysqlEnum("accountClass", ["asset", "liability", "equity", "income", "expense"]).notNull(),
  ledgerType: mysqlEnum("ledgerType", ["control", "detail"]).default("detail").notNull(),
  parentId: int("parentId").references((): AnyMySqlColumn => ledgerAccounts.id),
  customerId: int("customerId").references(() => customers.id).unique(),
  vendorId: int("vendorId").references(() => vendors.id).unique(),
  openingBalance: decimal("openingBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  openingBalanceSide: mysqlEnum("openingBalanceSide", ["debit", "credit"]).default("debit").notNull(),
  isInventory: boolean("isInventory").default(false).notNull(),
  isSystem: boolean("isSystem").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type InsertLedgerAccount = typeof ledgerAccounts.$inferInsert;

// Journal Entries - immutable headers for posted accounting transactions
export const journalEntries = mysqlTable("journal_entries", {
  id: int("id").autoincrement().primaryKey(),
  entryNumber: varchar("entryNumber", { length: 50 }).notNull().unique(),
  entryType: mysqlEnum("entryType", [
    "cash_receipt",
    "cash_payment",
    "general_journal",
    "sales_invoice",
    "customer_advance",
    "reversal",
    "opening_balance",
  ]).notNull(),
  entryDate: date("entryDate").notNull(),
  narration: text("narration"),
  referenceType: varchar("referenceType", { length: 50 }),
  referenceId: int("referenceId"),
  status: mysqlEnum("status", ["posted", "reversed"]).default("posted").notNull(),
  reversalOfId: int("reversalOfId").references((): AnyMySqlColumn => journalEntries.id),
  reversedById: int("reversedById").references((): AnyMySqlColumn => journalEntries.id),
  reversalReason: text("reversalReason"),
  totalDebit: decimal("totalDebit", { precision: 18, scale: 2 }).notNull(),
  totalCredit: decimal("totalCredit", { precision: 18, scale: 2 }).notNull(),
  createdBy: int("createdBy").references(() => users.id),
  postedAt: timestamp("postedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = typeof journalEntries.$inferInsert;

// Journal Lines - balanced debit and credit lines belonging to a journal entry
export const journalLines = mysqlTable("journal_lines", {
  id: int("id").autoincrement().primaryKey(),
  journalEntryId: int("journalEntryId").references(() => journalEntries.id).notNull(),
  accountId: int("accountId").references(() => ledgerAccounts.id).notNull(),
  description: text("description"),
  debit: decimal("debit", { precision: 18, scale: 2 }).default("0").notNull(),
  credit: decimal("credit", { precision: 18, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JournalLine = typeof journalLines.$inferSelect;
export type InsertJournalLine = typeof journalLines.$inferInsert;

// Audit Log - security and accounting activity history
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 100 }).notNull(),
  entityId: varchar("entityId", { length: 100 }),
  details: text("details"),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
