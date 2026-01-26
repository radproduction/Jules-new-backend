import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, date } from "drizzle-orm/mysql-core";

// Core user table backing auth flow
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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

// Orders
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),
  catalogId: int("catalogId").references(() => catalogs.id),
  customerId: int("customerId").references(() => customers.id),
  
  // Order details
  totalItems: int("totalItems").default(0),
  totalWeight: decimal("totalWeight", { precision: 10, scale: 3 }), // total gold weight
  totalPrice: decimal("totalPrice", { precision: 14, scale: 2 }),
  
  // Status
  status: mysqlEnum("status", ["pending", "production", "completed", "delivered", "cancelled"]).default("pending"),
  
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

// Order Items
export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  quantity: int("quantity").default(1),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;
