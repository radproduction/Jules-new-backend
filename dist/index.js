// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const isSecure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure
  };
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";

// server/_core/env.ts
var ENV = {
  jwtSecret: process.env.JWT_SECRET ?? "",
  mongoUri: process.env.MONGODB_URI ?? "",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminName: process.env.ADMIN_NAME ?? "Admin",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // JulesBot: any OpenAI-compatible chat API (OpenAI, Gemini, Groq, OpenRouter...).
  llmApiUrl: process.env.LLM_API_URL ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? ""
};

// server/_core/notification.ts
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var requireBusinessAccess = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.role !== "admin" && ctx.user.role !== "operations_finance") {
    throw new TRPCError2({
      code: "FORBIDDEN",
      message: "Your account is awaiting access approval from a Super Admin."
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var businessProcedure = t.procedure.use(requireBusinessAccess);
var operationsFinanceProcedure = businessProcedure;
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/financeRouter.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z2 } from "zod";

// server/_core/auth.ts
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// server/_core/types.ts
var USER_ROLES = ["user", "operations_finance", "admin"];

// server/_core/auth.ts
var getJwtSecret = () => {
  if (!ENV.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(ENV.jwtSecret);
};
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}
async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
async function signSession(payload) {
  const secretKey = getJwtSecret();
  const nowSeconds = Math.floor(Date.now() / 1e3);
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role
  }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt(nowSeconds).setExpirationTime(nowSeconds + 60 * 60 * 24 * 365).sign(secretKey);
}
async function verifySession(token) {
  try {
    const secretKey = getJwtSecret();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"]
    });
    const userId = payload.userId;
    const email = payload.email;
    const role = payload.role;
    if (typeof userId !== "number" || typeof email !== "string" || typeof role !== "string" || !USER_ROLES.includes(role)) {
      return null;
    }
    return {
      userId,
      email,
      role
    };
  } catch {
    return null;
  }
}

// server/db.ts
import mongoose, { Schema } from "mongoose";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, date } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  role: mysqlEnum("role", ["user", "operations_finance", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var goldPrices = mysqlTable("gold_prices", {
  id: int("id").autoincrement().primaryKey(),
  priceDate: date("priceDate").notNull(),
  price22k: decimal("price22k", { precision: 12, scale: 2 }).notNull(),
  // PKR per tola
  price24k: decimal("price24k", { precision: 12, scale: 2 }).notNull(),
  // PKR per tola
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id)
});
var categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  sku: varchar("sku", { length: 50 }),
  categoryId: int("categoryId").references(() => categories.id),
  // Gold details
  goldKarat: mysqlEnum("goldKarat", ["22k", "24k"]),
  goldWeight: decimal("goldWeight", { precision: 10, scale: 3 }),
  // in tola (including wastage)
  goldWastage: decimal("goldWastage", { precision: 5, scale: 2 }),
  // wastage percentage
  goldRateAtOrder: decimal("goldRateAtOrder", { precision: 12, scale: 2 }),
  // gold rate when product was created/ordered
  // Making charges
  makingCharges: decimal("makingCharges", { precision: 12, scale: 2 }),
  // PKR
  makingChargesType: mysqlEnum("makingChargesType", ["fixed", "per_gram"]).default("fixed"),
  // Diamond details
  diamondWeight: decimal("diamondWeight", { precision: 10, scale: 3 }),
  // in carats
  diamondRate: decimal("diamondRate", { precision: 12, scale: 2 }),
  // PKR per carat
  diamondPrice: decimal("diamondPrice", { precision: 12, scale: 2 }),
  // total diamond price
  // Stone details (emerald, sapphire, ruby, etc.)
  stoneType: varchar("stoneType", { length: 100 }),
  stoneWeight: decimal("stoneWeight", { precision: 10, scale: 3 }),
  // in carats
  stoneRate: decimal("stoneRate", { precision: 12, scale: 2 }),
  // PKR per carat
  stonePrice: decimal("stonePrice", { precision: 12, scale: 2 }),
  // total stone price
  // Images (JSON array of URLs)
  images: text("images"),
  // JSON array
  primaryImage: text("primaryImage"),
  // Pricing
  basePrice: decimal("basePrice", { precision: 12, scale: 2 }),
  // calculated gold price
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  // final price
  // Status
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id)
});
var customers = mysqlTable("customers", {
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
  createdBy: int("createdBy").references(() => users.id)
});
var catalogs = mysqlTable("catalogs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coverImage: text("coverImage"),
  productType: varchar("productType", { length: 100 }),
  // tag for product type
  customFields: text("customFields"),
  // JSON for additional custom fields
  // Customer assignment
  customerId: int("customerId").references(() => customers.id),
  // Public preview
  publicToken: varchar("publicToken", { length: 64 }).unique(),
  // for public preview link
  isPublic: boolean("isPublic").default(true),
  // Status
  status: mysqlEnum("status", ["draft", "published", "archived"]).default("draft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id)
});
var catalogProducts = mysqlTable("catalog_products", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var catalogLikes = mysqlTable("catalog_likes", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  visitorId: varchar("visitorId", { length: 64 }),
  // anonymous visitor identifier
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var catalogComments = mysqlTable("catalog_comments", {
  id: int("id").autoincrement().primaryKey(),
  catalogId: int("catalogId").references(() => catalogs.id).notNull(),
  productId: int("productId").references(() => products.id),
  visitorName: varchar("visitorName", { length: 100 }),
  comment: text("comment").notNull(),
  isRead: boolean("isRead").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var vendors = mysqlTable("vendors", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).unique(),
  // VN 000001 format
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  specialization: varchar("specialization", { length: 255 }),
  // Body Making, Stone Setting, etc.
  isActive: boolean("isActive").default(true),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id)
});
var orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),
  catalogId: int("catalogId").references(() => catalogs.id),
  customerId: int("customerId").references(() => customers.id),
  // Order details
  description: text("description"),
  comments: text("comments"),
  totalItems: int("totalItems").default(0),
  totalWeight: decimal("totalWeight", { precision: 10, scale: 3 }),
  // total gold weight
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
  createdBy: int("createdBy").references(() => users.id)
});
var collections = mysqlTable("collections", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coverImage: text("coverImage"),
  productCount: int("productCount").default(0),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").references(() => users.id)
});
var collectionProducts = mysqlTable("collection_products", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").references(() => collections.id).notNull(),
  productId: int("productId").references(() => products.id).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  productId: int("productId").references(() => products.id),
  vendorId: int("vendorId").references(() => vendors.id),
  itemName: varchar("itemName", { length: 255 }).notNull(),
  // e.g. "Necklace", "Earrings", "Baalis"
  quantity: int("quantity").default(1),
  // Estimated Metal
  estimatedMetalType: varchar("estimatedMetalType", { length: 50 }),
  // Gold 22k, Gold 24k
  estimatedMetalWeight: decimal("estimatedMetalWeight", { precision: 10, scale: 3 }),
  estimatedMetalWastage: decimal("estimatedMetalWastage", { precision: 5, scale: 2 }),
  estimatedMetalRate: decimal("estimatedMetalRate", { precision: 12, scale: 2 }),
  estimatedMetalValue: decimal("estimatedMetalValue", { precision: 14, scale: 2 }),
  // Estimated Gems
  estimatedGemType: varchar("estimatedGemType", { length: 100 }),
  estimatedGemQty: int("estimatedGemQty"),
  estimatedGemWeight: decimal("estimatedGemWeight", { precision: 10, scale: 3 }),
  estimatedGemRate: decimal("estimatedGemRate", { precision: 12, scale: 2 }),
  estimatedGemCalcBy: varchar("estimatedGemCalcBy", { length: 20 }),
  // 'weight' or 'quantity'
  estimatedGemValue: decimal("estimatedGemValue", { precision: 14, scale: 2 }),
  // Labour
  estimatedLabourCharges: decimal("estimatedLabourCharges", { precision: 12, scale: 2 }).default("0"),
  bodyMakingRateType: varchar("bodyMakingRateType", { length: 20 }).default("simple"),
  // simple or detailed
  stoneSettingRateType: varchar("stoneSettingRateType", { length: 20 }).default("simple"),
  // Pricing
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var orderProcesses = mysqlTable("order_processes", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  orderItemId: int("orderItemId").references(() => orderItems.id),
  itemName: varchar("itemName", { length: 255 }),
  // e.g. "Necklace"
  processType: varchar("processType", { length: 100 }).notNull(),
  // Body Making, Stone Setting, Polishing, Rhodium, etc.
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
  returnBodyMetal: varchar("returnBodyMetal", { length: 50 }),
  // Gold 22k, Gold 24k
  returnBodyWeight: decimal("returnBodyWeight", { precision: 10, scale: 3 }),
  returnBodyUnit: varchar("returnBodyUnit", { length: 10 }).default("gm"),
  returnBodyPieces: int("returnBodyPieces").default(1),
  // Gems Issue to Vendor
  gemsIssueType: varchar("gemsIssueType", { length: 100 }),
  gemsIssueSource: varchar("gemsIssueSource", { length: 50 }),
  // Our Stock, Customer Stock
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var orderInvoices = mysqlTable("order_invoices", {
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
  createdBy: int("createdBy").references(() => users.id)
});
var orderInvoiceItems = mysqlTable("order_invoice_items", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").references(() => orderInvoices.id).notNull(),
  itemName: varchar("itemName", { length: 255 }).notNull(),
  // e.g. "Necklace"
  particular: varchar("particular", { length: 255 }),
  // e.g. "Our - Gold 22k", "Our - Emeralds - 01"
  qty: int("qty"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  weightUnit: varchar("weightUnit", { length: 10 }).default("gm"),
  wastage: decimal("wastage", { precision: 5, scale: 2 }),
  netWeight: decimal("netWeight", { precision: 10, scale: 3 }),
  rate: decimal("rate", { precision: 12, scale: 2 }),
  calculateBy: varchar("calculateBy", { length: 20 }).default("weight"),
  // weight or percentage
  amount: decimal("amount", { precision: 14, scale: 2 }),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var orderAdvanceMetals = mysqlTable("order_advance_metals", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  itemName: varchar("itemName", { length: 255 }),
  receivedDate: date("receivedDate"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  alloy: varchar("alloy", { length: 50 }),
  netWeightRate: decimal("netWeightRate", { precision: 12, scale: 2 }),
  value: decimal("value", { precision: 14, scale: 2 }),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var orderAdvanceGems = mysqlTable("order_advance_gems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").references(() => orders.id).notNull(),
  itemName: varchar("itemName", { length: 255 }),
  qty: int("qty"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var ledgerAccounts = mysqlTable("ledger_accounts", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  accountClass: mysqlEnum("accountClass", ["asset", "liability", "equity", "income", "expense"]).notNull(),
  ledgerType: mysqlEnum("ledgerType", ["control", "detail"]).default("detail").notNull(),
  parentId: int("parentId").references(() => ledgerAccounts.id),
  customerId: int("customerId").references(() => customers.id).unique(),
  vendorId: int("vendorId").references(() => vendors.id).unique(),
  openingBalance: decimal("openingBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  openingBalanceSide: mysqlEnum("openingBalanceSide", ["debit", "credit"]).default("debit").notNull(),
  isInventory: boolean("isInventory").default(false).notNull(),
  isSystem: boolean("isSystem").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var journalEntries = mysqlTable("journal_entries", {
  id: int("id").autoincrement().primaryKey(),
  entryNumber: varchar("entryNumber", { length: 50 }).notNull().unique(),
  entryType: mysqlEnum("entryType", [
    "cash_receipt",
    "cash_payment",
    "general_journal",
    "sales_invoice",
    "customer_advance",
    "reversal",
    "opening_balance"
  ]).notNull(),
  entryDate: date("entryDate").notNull(),
  narration: text("narration"),
  referenceType: varchar("referenceType", { length: 50 }),
  referenceId: int("referenceId"),
  status: mysqlEnum("status", ["posted", "reversed"]).default("posted").notNull(),
  reversalOfId: int("reversalOfId").references(() => journalEntries.id),
  reversedById: int("reversedById").references(() => journalEntries.id),
  reversalReason: text("reversalReason"),
  totalDebit: decimal("totalDebit", { precision: 18, scale: 2 }).notNull(),
  totalCredit: decimal("totalCredit", { precision: 18, scale: 2 }).notNull(),
  createdBy: int("createdBy").references(() => users.id),
  postedAt: timestamp("postedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var journalLines = mysqlTable("journal_lines", {
  id: int("id").autoincrement().primaryKey(),
  journalEntryId: int("journalEntryId").references(() => journalEntries.id).notNull(),
  accountId: int("accountId").references(() => ledgerAccounts.id).notNull(),
  description: text("description"),
  debit: decimal("debit", { precision: 18, scale: 2 }).default("0").notNull(),
  credit: decimal("credit", { precision: 18, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 100 }).notNull(),
  entityId: varchar("entityId", { length: 100 }),
  details: text("details"),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/rows.ts
import { getTableColumns } from "drizzle-orm";
function toRow(table, doc) {
  const source = doc ?? {};
  const row = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const meta = column;
    let value = source[key];
    if (value === void 0 || value === null) {
      const literalDefault = meta.hasDefault && meta.default !== void 0 && (typeof meta.default !== "object" || meta.default === null) ? meta.default : void 0;
      value = literalDefault ?? null;
    }
    if (value === null) {
      row[key] = null;
      continue;
    }
    switch (meta.columnType) {
      case "MySqlDecimal": {
        const numeric = Number(value);
        row[key] = Number.isFinite(numeric) ? numeric.toFixed(meta.scale ?? 2) : null;
        break;
      }
      case "MySqlDate":
      case "MySqlTimestamp":
      case "MySqlDateTime": {
        const date2 = value instanceof Date ? value : new Date(value);
        row[key] = Number.isNaN(date2.getTime()) ? null : date2;
        break;
      }
      case "MySqlInt": {
        const numeric = Number(value);
        row[key] = Number.isFinite(numeric) ? numeric : null;
        break;
      }
      case "MySqlBoolean":
        row[key] = Boolean(value);
        break;
      default:
        row[key] = value;
    }
  }
  return row;
}
function toRows(table, docs) {
  return docs.map((doc) => toRow(table, doc));
}
function toRowOrNull(table, doc) {
  return doc ? toRow(table, doc) : null;
}
function num(value) {
  if (value === void 0 || value === null || value === "") return void 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// server/db.ts
var connected = false;
async function connectDb() {
  if (connected) return;
  if (!ENV.mongoUri) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }
  await mongoose.connect(ENV.mongoUri);
  connected = true;
}
function ensureModel(name, schema) {
  const create = () => mongoose.model(name, schema);
  return mongoose.models[name] ?? create();
}
var CounterSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 }
  },
  { collection: "counters" }
);
var Counter = ensureModel("Counter", CounterSchema);
async function getNextSequence(name) {
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { name },
        { $inc: { value: 1 } },
        { new: true, upsert: true }
      ).lean();
      return counter?.value ?? 1;
    } catch (error) {
      if (error?.code !== 11e3 || attempt >= 3) throw error;
    }
  }
}
var withTimestamps = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
};
var UserSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["user", "operations_finance", "admin"], default: "user" },
    isActive: { type: Boolean, default: true },
    lastSignedIn: { type: Date, default: Date.now }
  },
  { ...withTimestamps, collection: "users" }
);
var GoldPriceSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    priceDate: { type: Date, required: true },
    price22k: { type: Number, required: true },
    price24k: { type: Number, required: true },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "gold_prices" }
);
var CategorySchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true },
    description: { type: String }
  },
  { ...withTimestamps, collection: "categories" }
);
var ProductSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    sku: { type: String },
    categoryId: { type: Number },
    goldKarat: { type: String, enum: ["22k", "24k"] },
    goldWeight: { type: Number },
    goldWastage: { type: Number },
    goldRateAtOrder: { type: Number },
    makingCharges: { type: Number },
    makingChargesType: { type: String, enum: ["fixed", "per_gram"], default: "fixed" },
    diamondWeight: { type: Number },
    diamondRate: { type: Number },
    diamondPrice: { type: Number },
    stoneType: { type: String },
    stoneWeight: { type: Number },
    stoneRate: { type: Number },
    stonePrice: { type: Number },
    images: { type: String },
    primaryImage: { type: String },
    basePrice: { type: Number },
    totalPrice: { type: Number },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "products" }
);
var CustomerSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String, default: "Pakistan" },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    notes: { type: String },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "customers" }
);
var CatalogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    coverImage: { type: String },
    productType: { type: String },
    customFields: { type: String },
    customerId: { type: Number },
    publicToken: { type: String, unique: true, sparse: true },
    isPublic: { type: Boolean, default: true },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "catalogs" }
);
var CatalogProductSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 }
  },
  { ...withTimestamps, collection: "catalog_products" }
);
var CatalogLikeSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    visitorId: { type: String }
  },
  { ...withTimestamps, collection: "catalog_likes" }
);
var CatalogCommentSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number },
    visitorName: { type: String },
    comment: { type: String, required: true },
    isRead: { type: Boolean, default: false }
  },
  { ...withTimestamps, collection: "catalog_comments" }
);
var OrderSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderNumber: { type: String, required: true, unique: true },
    catalogId: { type: Number },
    customerId: { type: Number, index: true },
    description: { type: String },
    comments: { type: String },
    totalItems: { type: Number, default: 0 },
    totalWeight: { type: Number },
    totalPrice: { type: Number },
    advanceCash: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["saved", "pending", "production", "completed", "delivered", "cancelled"],
      default: "saved"
    },
    orderDate: { type: Date, default: Date.now },
    expectedDelivery: { type: Date },
    completedDate: { type: Date },
    notes: { type: String },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "orders" }
);
var OrderItemSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    productId: { type: Number },
    vendorId: { type: Number, index: true },
    itemName: { type: String },
    quantity: { type: Number, default: 1 },
    estimatedMetalType: { type: String },
    estimatedMetalWeight: { type: Number },
    estimatedMetalWastage: { type: Number },
    estimatedMetalRate: { type: Number },
    estimatedMetalValue: { type: Number },
    estimatedGemType: { type: String },
    estimatedGemQty: { type: Number },
    estimatedGemWeight: { type: Number },
    estimatedGemRate: { type: Number },
    estimatedGemCalcBy: { type: String },
    estimatedGemValue: { type: Number },
    estimatedLabourCharges: { type: Number, default: 0 },
    bodyMakingRateType: { type: String, default: "simple" },
    stoneSettingRateType: { type: String, default: "simple" },
    unitPrice: { type: Number },
    totalPrice: { type: Number },
    comments: { type: String }
  },
  { ...withTimestamps, collection: "order_items" }
);
var CollectionSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    coverImage: { type: String },
    productCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "collections" }
);
var CollectionProductSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    collectionId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 }
  },
  { ...withTimestamps, collection: "collection_products" }
);
var VendorSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    code: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    city: { type: String },
    specialization: { type: String },
    isActive: { type: Boolean, default: true },
    notes: { type: String },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "vendors" }
);
var OrderProcessSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    orderItemId: { type: Number },
    itemName: { type: String },
    processType: { type: String, required: true },
    vendorId: { type: Number, index: true },
    startDate: { type: Date },
    expectedDeliveryDate: { type: Date },
    actualDeliveryDate: { type: Date },
    status: { type: String, enum: ["pending", "in_progress", "complete"], default: "pending" },
    issueBodyWeight: { type: Number },
    issueBodyUnit: { type: String, default: "gm" },
    returnBodyMetal: { type: String },
    returnBodyWeight: { type: Number },
    returnBodyUnit: { type: String, default: "gm" },
    returnBodyPieces: { type: Number, default: 1 },
    gemsIssueType: { type: String },
    gemsIssueSource: { type: String },
    gemsIssueDate: { type: Date },
    gemsIssueWeight: { type: Number },
    gemsIssueWeightUnit: { type: String, default: "carats" },
    gemsIssueQty: { type: Number },
    gemsReturnWeight: { type: Number },
    gemsReturnQty: { type: Number },
    gemsReturnDate: { type: Date },
    lumpSumLabour: { type: Number, default: 0 },
    comments: { type: String },
    isClosed: { type: Boolean, default: false },
    closedDate: { type: Date }
  },
  { ...withTimestamps, collection: "order_processes" }
);
var OrderAdvanceMetalSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    itemName: { type: String },
    receivedDate: { type: Date },
    weight: { type: Number },
    alloy: { type: String },
    netWeightRate: { type: Number },
    value: { type: Number },
    comments: { type: String }
  },
  { ...withTimestamps, collection: "order_advance_metals" }
);
var OrderAdvanceGemSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    itemName: { type: String },
    qty: { type: Number },
    weight: { type: Number },
    comments: { type: String }
  },
  { ...withTimestamps, collection: "order_advance_gems" }
);
var OrderInvoiceSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    invoiceNumber: { type: String, unique: true, sparse: true },
    orderId: { type: Number, required: true, index: true },
    customerId: { type: Number, index: true },
    remarks: { type: String },
    invoiceDate: { type: Date },
    metalValue: { type: Number, default: 0 },
    stoneValue: { type: Number, default: 0 },
    makingCharges: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "sent", "paid", "cancelled"], default: "draft" },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "order_invoices" }
);
var OrderInvoiceItemSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    invoiceId: { type: Number, required: true, index: true },
    itemName: { type: String, required: true },
    particular: { type: String },
    qty: { type: Number },
    weight: { type: Number },
    weightUnit: { type: String, default: "gm" },
    wastage: { type: Number },
    netWeight: { type: Number },
    rate: { type: Number },
    calculateBy: { type: String, default: "weight" },
    amount: { type: Number },
    sortOrder: { type: Number, default: 0 }
  },
  { ...withTimestamps, collection: "order_invoice_items" }
);
var UserModel = ensureModel("User", UserSchema);
var GoldPriceModel = ensureModel("GoldPrice", GoldPriceSchema);
var CategoryModel = ensureModel("Category", CategorySchema);
var ProductModel = ensureModel("Product", ProductSchema);
var CustomerModel = ensureModel("Customer", CustomerSchema);
var CatalogModel = ensureModel("Catalog", CatalogSchema);
var CatalogProductModel = ensureModel("CatalogProduct", CatalogProductSchema);
var CatalogLikeModel = ensureModel("CatalogLike", CatalogLikeSchema);
var CatalogCommentModel = ensureModel("CatalogComment", CatalogCommentSchema);
var OrderModel = ensureModel("Order", OrderSchema);
var OrderItemModel = ensureModel("OrderItem", OrderItemSchema);
var CollectionModel = ensureModel("Collection", CollectionSchema);
var CollectionProductModel = ensureModel("CollectionProduct", CollectionProductSchema);
var VendorModel = ensureModel("Vendor", VendorSchema);
var OrderProcessModel = ensureModel("OrderProcess", OrderProcessSchema);
var OrderAdvanceMetalModel = ensureModel("OrderAdvanceMetal", OrderAdvanceMetalSchema);
var OrderAdvanceGemModel = ensureModel("OrderAdvanceGem", OrderAdvanceGemSchema);
var OrderInvoiceModel = ensureModel("OrderInvoice", OrderInvoiceSchema);
var OrderInvoiceItemModel = ensureModel("OrderInvoiceItem", OrderInvoiceItemSchema);
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    isActive: user.isActive !== false,
    lastSignedIn: user.lastSignedIn ?? null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null
  };
}
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
async function ensureAdminUser() {
  await connectDb();
  if (!ENV.adminEmail || !ENV.adminPassword) {
    console.warn("[Auth] ADMIN_EMAIL or ADMIN_PASSWORD not configured; skipping admin seed");
    return;
  }
  const email = normalizeEmail(ENV.adminEmail);
  const existing = await UserModel.findOne({
    email: { $in: Array.from(/* @__PURE__ */ new Set([ENV.adminEmail, email])) }
  }).lean();
  if (existing) {
    if (existing.role !== "admin" || existing.isActive === false) {
      await UserModel.updateOne({ id: existing.id }, { $set: { role: "admin", isActive: true } });
    }
    return;
  }
  const id = await getNextSequence("users");
  const passwordHash = await hashPassword(ENV.adminPassword);
  await UserModel.create({
    id,
    email,
    passwordHash,
    name: ENV.adminName || "Admin",
    role: "admin",
    isActive: true,
    lastSignedIn: /* @__PURE__ */ new Date()
  });
}
async function getUserById(id) {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean();
  if (!user || user.isActive === false) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role
  };
}
async function getUserByEmail(email) {
  await connectDb();
  const normalized = normalizeEmail(email);
  return UserModel.findOne({
    email: { $in: Array.from(/* @__PURE__ */ new Set([email.trim(), normalized])) }
  }).lean();
}
async function updateUserLastSignedIn(id) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: { lastSignedIn: /* @__PURE__ */ new Date() } });
}
async function listUsers() {
  await connectDb();
  const users2 = await UserModel.find({}).sort({ lastSignedIn: -1 }).lean();
  return users2.map(toPublicUser);
}
async function getPublicUserById(id) {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean();
  return user ? toPublicUser(user) : null;
}
async function createUserAccount(data) {
  await connectDb();
  const email = normalizeEmail(data.email);
  const existing = await getUserByEmail(email);
  if (existing) throw new Error("A user with this email already exists");
  const id = await getNextSequence("users");
  const passwordHash = await hashPassword(data.password);
  const created = await UserModel.create({
    id,
    email,
    passwordHash,
    name: data.name?.trim() || null,
    role: data.role,
    isActive: true,
    lastSignedIn: null
  });
  return toPublicUser(created.toObject());
}
async function setUserFields(id, data) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: data });
  return getPublicUserById(id);
}
async function getTodayGoldPrice() {
  await connectDb();
  const start = /* @__PURE__ */ new Date();
  start.setHours(0, 0, 0, 0);
  const end = /* @__PURE__ */ new Date();
  end.setHours(23, 59, 59, 999);
  const price = await GoldPriceModel.findOne({ priceDate: { $gte: start, $lte: end } }).sort({ priceDate: -1 }).lean();
  return toRowOrNull(goldPrices, price);
}
async function getLatestGoldPrice() {
  await connectDb();
  return toRowOrNull(goldPrices, await GoldPriceModel.findOne({}).sort({ priceDate: -1 }).lean());
}
async function setGoldPrice(data) {
  await connectDb();
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const existing = await getTodayGoldPrice();
  const payload = {
    price22k: Number(data.price22k),
    price24k: Number(data.price24k)
  };
  if (existing) {
    await GoldPriceModel.updateOne({ id: existing.id }, { $set: payload });
    return toRow(goldPrices, { ...existing, ...payload });
  }
  const id = await getNextSequence("gold_prices");
  const created = await GoldPriceModel.create({
    id,
    priceDate: today,
    ...payload,
    createdBy: data.userId
  });
  return toRow(goldPrices, created.toObject());
}
async function getAllCategories() {
  await connectDb();
  return CategoryModel.find({}).sort({ name: 1 }).lean();
}
async function getAllProducts(filters) {
  await connectDb();
  const query = {};
  if (filters?.categoryId) query.categoryId = filters.categoryId;
  if (filters?.isActive !== void 0) query.isActive = filters.isActive;
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  const products2 = await ProductModel.find(query).sort({ createdAt: -1 }).lean();
  const categoryIds = Array.from(new Set(products2.map((p) => p.categoryId).filter(Boolean)));
  const categories2 = await CategoryModel.find({ id: { $in: categoryIds } }).lean();
  const categoryMap = new Map(categories2.map((cat) => [cat.id, cat]));
  return products2.map((product) => ({
    product,
    category: product.categoryId ? categoryMap.get(product.categoryId) ?? null : null
  }));
}
async function getProductById(id) {
  await connectDb();
  const product = await ProductModel.findOne({ id }).lean();
  if (!product) return null;
  const category = product.categoryId ? await CategoryModel.findOne({ id: product.categoryId }).lean() : null;
  return { product, category };
}
async function createProduct(data) {
  await connectDb();
  const id = await getNextSequence("products");
  const created = await ProductModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}
async function updateProduct(id, data) {
  await connectDb();
  await ProductModel.updateOne({ id }, { $set: data });
  return await getProductById(id);
}
async function deleteProduct(id) {
  await connectDb();
  await ProductModel.deleteOne({ id });
}
async function getAllCustomers(filters) {
  await connectDb();
  const query = {};
  if (filters?.paymentStatus) {
    query.paymentStatus = filters.paymentStatus;
  }
  if (filters?.search) {
    const regex = new RegExp(escapeRegex(filters.search), "i");
    query.$or = [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { phone: regex }
    ];
  }
  return CustomerModel.find(query).sort({ createdAt: -1 }).lean();
}
async function getCustomerById(id) {
  await connectDb();
  return CustomerModel.findOne({ id }).lean();
}
async function createCustomer(data) {
  await connectDb();
  const id = await getNextSequence("customers");
  const created = await CustomerModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}
async function updateCustomer(id, data) {
  await connectDb();
  await CustomerModel.updateOne({ id }, { $set: data });
  return await getCustomerById(id);
}
async function deleteCustomer(id) {
  await connectDb();
  const [orderCount, invoiceCount] = await Promise.all([
    OrderModel.countDocuments({ customerId: id }),
    OrderInvoiceModel.countDocuments({ customerId: id })
  ]);
  if (orderCount > 0 || invoiceCount > 0) {
    throw new Error("This customer has orders or invoices and cannot be deleted");
  }
  await CustomerModel.deleteOne({ id });
}
async function getAllCatalogs(filters) {
  await connectDb();
  const query = {};
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  if (filters?.status) query.status = filters.status;
  if (filters?.customerId) query.customerId = filters.customerId;
  const catalogs2 = await CatalogModel.find(query).sort({ createdAt: -1 }).lean();
  const customerIds = Array.from(new Set(catalogs2.map((c) => c.customerId).filter(Boolean)));
  const customers2 = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const customerMap = new Map(customers2.map((customer) => [customer.id, customer]));
  return catalogs2.map((catalog) => ({
    catalog,
    customer: catalog.customerId ? customerMap.get(catalog.customerId) ?? null : null
  }));
}
async function getCatalogById(id) {
  await connectDb();
  const catalog = await CatalogModel.findOne({ id }).lean();
  if (!catalog) return null;
  const customer = catalog.customerId ? await CustomerModel.findOne({ id: catalog.customerId }).lean() : null;
  return { catalog, customer };
}
async function getCatalogByToken(token) {
  await connectDb();
  const catalog = await CatalogModel.findOne({ publicToken: token }).lean();
  if (!catalog) return null;
  const customer = catalog.customerId ? await CustomerModel.findOne({ id: catalog.customerId }).lean() : null;
  return { catalog, customer };
}
async function createCatalog(data) {
  await connectDb();
  const id = await getNextSequence("catalogs");
  const created = await CatalogModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}
async function updateCatalog(id, data) {
  await connectDb();
  await CatalogModel.updateOne({ id }, { $set: data });
  return await getCatalogById(id);
}
async function deleteCatalog(id) {
  await connectDb();
  await CatalogProductModel.deleteMany({ catalogId: id });
  await CatalogLikeModel.deleteMany({ catalogId: id });
  await CatalogCommentModel.deleteMany({ catalogId: id });
  await CatalogModel.deleteOne({ id });
}
async function getCatalogProducts(catalogId) {
  await connectDb();
  const catalogProducts2 = await CatalogProductModel.find({ catalogId }).sort({ sortOrder: 1 }).lean();
  const productIds = catalogProducts2.map((cp) => cp.productId);
  const products2 = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories2 = await CategoryModel.find({ id: { $in: products2.map((p) => p.categoryId).filter(Boolean) } }).lean();
  const productMap = new Map(products2.map((product) => [product.id, product]));
  const categoryMap = new Map(categories2.map((category) => [category.id, category]));
  return catalogProducts2.map((catalogProduct) => {
    const product = productMap.get(catalogProduct.productId);
    const category = product?.categoryId ? categoryMap.get(product.categoryId) ?? null : null;
    return { catalogProduct, product, category };
  });
}
async function addProductsToCatalog(catalogId, productIds) {
  await connectDb();
  if (!productIds.length) return;
  const values = [];
  for (let i = 0; i < productIds.length; i++) {
    values.push({
      id: await getNextSequence("catalog_products"),
      catalogId,
      productId: productIds[i],
      sortOrder: i
    });
  }
  await CatalogProductModel.insertMany(values);
}
async function updateCatalogProducts(catalogId, productIds) {
  await connectDb();
  await CatalogProductModel.deleteMany({ catalogId });
  await addProductsToCatalog(catalogId, productIds);
}
async function getCatalogLikes(catalogId) {
  await connectDb();
  return CatalogLikeModel.find({ catalogId }).lean();
}
async function addCatalogLike(data) {
  await connectDb();
  const visitorId = data.visitorId || "";
  const existing = await CatalogLikeModel.findOne({
    catalogId: data.catalogId,
    productId: data.productId,
    visitorId
  }).lean();
  if (existing) {
    await CatalogLikeModel.deleteOne({ id: existing.id });
    return { liked: false };
  }
  await CatalogLikeModel.create({
    id: await getNextSequence("catalog_likes"),
    catalogId: data.catalogId,
    productId: data.productId,
    visitorId
  });
  return { liked: true };
}
async function getCatalogComments(catalogId) {
  await connectDb();
  return CatalogCommentModel.find({ catalogId }).sort({ createdAt: -1 }).lean();
}
async function addCatalogComment(data) {
  await connectDb();
  const created = await CatalogCommentModel.create({
    id: await getNextSequence("catalog_comments"),
    catalogId: data.catalogId,
    productId: data.productId,
    visitorName: data.visitorName,
    comment: data.comment,
    isRead: false
  });
  return { id: created.id, ...data };
}
async function markCommentAsRead(id) {
  await connectDb();
  await CatalogCommentModel.updateOne({ id }, { $set: { isRead: true } });
}
function orderRow(order) {
  return toRow(orders, order);
}
async function getAllOrders(filters) {
  await connectDb();
  const query = {};
  if (filters?.status) query.status = filters.status;
  if (filters?.customerId) query.customerId = filters.customerId;
  if (filters?.month && filters?.year) {
    const startDate = new Date(filters.year, filters.month - 1, 1);
    const endDate = new Date(filters.year, filters.month, 0, 23, 59, 59, 999);
    query.orderDate = { $gte: startDate, $lte: endDate };
  }
  const orders2 = await OrderModel.find(query).sort({ orderDate: -1, id: -1 }).lean();
  const customerIds = Array.from(new Set(orders2.map((order) => order.customerId).filter(Boolean)));
  const catalogIds = Array.from(new Set(orders2.map((order) => order.catalogId).filter(Boolean)));
  const customers2 = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const catalogs2 = await CatalogModel.find({ id: { $in: catalogIds } }).lean();
  const customerMap = new Map(customers2.map((customer) => [customer.id, customer]));
  const catalogMap = new Map(catalogs2.map((catalog) => [catalog.id, catalog]));
  return orders2.map((order) => ({
    order: orderRow(order),
    customer: order.customerId ? toRowOrNull(customers, customerMap.get(order.customerId)) : null,
    catalog: order.catalogId ? toRowOrNull(catalogs, catalogMap.get(order.catalogId)) : null
  }));
}
async function getOrderById(id) {
  await connectDb();
  const order = await OrderModel.findOne({ id }).lean();
  if (!order) return null;
  const customer = order.customerId ? await CustomerModel.findOne({ id: order.customerId }).lean() : null;
  const catalog = order.catalogId ? await CatalogModel.findOne({ id: order.catalogId }).lean() : null;
  return {
    order: orderRow(order),
    customer: toRowOrNull(customers, customer),
    catalog: toRowOrNull(catalogs, catalog)
  };
}
var ORDER_DECIMALS = ["totalWeight", "totalPrice", "advanceCash"];
function cleanDecimals(data, fields) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === void 0) continue;
    result[key] = fields.includes(key) ? num(value) ?? null : value;
  }
  return result;
}
async function createOrder(data) {
  await connectDb();
  const id = await getNextSequence("orders");
  const created = await OrderModel.create({ id, ...cleanDecimals(data, ORDER_DECIMALS) });
  return orderRow(created.toObject());
}
async function updateOrder(id, data) {
  await connectDb();
  await OrderModel.updateOne({ id }, { $set: cleanDecimals(data, ORDER_DECIMALS) });
  return await getOrderById(id);
}
async function deleteOrder(id) {
  await connectDb();
  const invoiceCount = await OrderInvoiceModel.countDocuments({ orderId: id });
  if (invoiceCount > 0) {
    throw new Error("This order has invoices and cannot be deleted. Cancel it instead.");
  }
  const itemIds = (await OrderItemModel.find({ orderId: id }, { id: 1 }).lean()).map((item) => item.id);
  await OrderProcessModel.deleteMany({ $or: [{ orderId: id }, { orderItemId: { $in: itemIds } }] });
  await OrderAdvanceMetalModel.deleteMany({ orderId: id });
  await OrderAdvanceGemModel.deleteMany({ orderId: id });
  await OrderItemModel.deleteMany({ orderId: id });
  await OrderModel.deleteOne({ id });
}
var ORDER_ITEM_DECIMALS = [
  "estimatedMetalWeight",
  "estimatedMetalWastage",
  "estimatedMetalRate",
  "estimatedMetalValue",
  "estimatedGemWeight",
  "estimatedGemRate",
  "estimatedGemValue",
  "estimatedLabourCharges",
  "unitPrice",
  "totalPrice"
];
async function productNameMap(productIds) {
  const ids = Array.from(new Set(productIds.filter((id) => typeof id === "number" && id > 0)));
  if (!ids.length) return /* @__PURE__ */ new Map();
  const products2 = await ProductModel.find({ id: { $in: ids } }).lean();
  return new Map(products2.map((product) => [product.id, product]));
}
function orderItemRow(item, productMap) {
  const withName = {
    ...item,
    itemName: item.itemName || (item.productId ? productMap?.get(item.productId)?.name : void 0) || "Item"
  };
  return toRow(orderItems, withName);
}
async function getOrderItems(orderId) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).sort({ id: 1 }).lean();
  const productMap = await productNameMap(items.map((item) => item.productId));
  return items.map((item) => ({
    orderItem: orderItemRow(item, productMap),
    product: item.productId ? toRowOrNull(products, productMap.get(item.productId)) : null
  }));
}
async function getOrderItemsRaw(orderId) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).sort({ id: 1 }).lean();
  const productMap = await productNameMap(items.map((item) => item.productId));
  return items.map((item) => orderItemRow(item, productMap));
}
async function addOrderItems(orderId, items) {
  await connectDb();
  const created = [];
  for (const item of items) {
    const { productId, vendorId, ...rest } = item;
    const doc = {
      id: await getNextSequence("order_items"),
      orderId,
      ...cleanDecimals(rest, ORDER_ITEM_DECIMALS),
      // Only keep references that point at real records (0 means "manual item").
      ...productId && productId > 0 ? { productId } : {},
      ...vendorId && vendorId > 0 ? { vendorId } : {}
    };
    const saved = await OrderItemModel.create(doc);
    created.push(orderItemRow(saved.toObject()));
  }
  return created;
}
async function getDashboardStats() {
  await connectDb();
  const now = /* @__PURE__ */ new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [catalogCount, productCount, customerCount, currentMonthOrders, productionOrders] = await Promise.all([
    CatalogModel.countDocuments(),
    ProductModel.countDocuments({ isActive: true }),
    CustomerModel.countDocuments(),
    OrderModel.countDocuments({ orderDate: { $gte: startOfMonth } }),
    OrderModel.countDocuments({ status: "production" })
  ]);
  return {
    catalogs: catalogCount,
    products: productCount,
    customers: customerCount,
    currentMonthOrders,
    productionOrders
  };
}
async function nextPrefixedNumber(model, field, prefix) {
  const counterName = `${field}_${prefix}`;
  const existingCounter = await Counter.findOne({ name: counterName }).lean();
  if (!existingCounter) {
    const last = await model.findOne({ [field]: { $regex: `^${prefix}\\d{4}$` } }).sort({ [field]: -1 }).lean();
    const lastSequence = last?.[field] ? parseInt(last[field].slice(-4), 10) : 0;
    await Counter.updateOne(
      { name: counterName },
      { $max: { value: Number.isNaN(lastSequence) ? 0 : lastSequence } },
      { upsert: true }
    );
  }
  const sequence = await getNextSequence(counterName);
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
}
async function generateOrderNumber() {
  await connectDb();
  const now = /* @__PURE__ */ new Date();
  const prefix = `JO${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  return nextPrefixedNumber(OrderModel, "orderNumber", prefix);
}
async function getAllCollections(filters) {
  await connectDb();
  const query = {};
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  if (filters?.isActive !== void 0) query.isActive = filters.isActive;
  return CollectionModel.find(query).sort({ name: 1 }).lean();
}
async function getCollectionById(id) {
  await connectDb();
  return CollectionModel.findOne({ id }).lean();
}
async function createCollection(data) {
  await connectDb();
  const id = await getNextSequence("collections");
  const created = await CollectionModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}
async function updateCollection(id, data) {
  await connectDb();
  await CollectionModel.updateOne({ id }, { $set: data });
  return await getCollectionById(id);
}
async function deleteCollection(id) {
  await connectDb();
  await CollectionProductModel.deleteMany({ collectionId: id });
  await CollectionModel.deleteOne({ id });
}
async function getCollectionProducts(collectionId) {
  await connectDb();
  const collectionProducts2 = await CollectionProductModel.find({ collectionId }).sort({ sortOrder: 1 }).lean();
  const productIds = collectionProducts2.map((cp) => cp.productId);
  const products2 = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories2 = await CategoryModel.find({ id: { $in: products2.map((p) => p.categoryId).filter(Boolean) } }).lean();
  const productMap = new Map(products2.map((product) => [product.id, product]));
  const categoryMap = new Map(categories2.map((category) => [category.id, category]));
  return collectionProducts2.map((collectionProduct) => {
    const product = productMap.get(collectionProduct.productId);
    const category = product?.categoryId ? categoryMap.get(product.categoryId) ?? null : null;
    return { collectionProduct, product, category };
  });
}
async function addProductsToCollection(collectionId, productIds) {
  await connectDb();
  if (!productIds.length) return;
  const values = [];
  for (let i = 0; i < productIds.length; i++) {
    values.push({
      id: await getNextSequence("collection_products"),
      collectionId,
      productId: productIds[i],
      sortOrder: i
    });
  }
  await CollectionProductModel.insertMany(values);
  await CollectionModel.updateOne(
    { id: collectionId },
    { $set: { productCount: await CollectionProductModel.countDocuments({ collectionId }) } }
  );
}
async function removeProductFromCollection(collectionId, productId) {
  await connectDb();
  await CollectionProductModel.deleteOne({ collectionId, productId });
  await CollectionModel.updateOne(
    { id: collectionId },
    { $set: { productCount: await CollectionProductModel.countDocuments({ collectionId }) } }
  );
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function getAllVendors(filters) {
  await connectDb();
  const query = {};
  if (filters?.search) query.name = { $regex: escapeRegex(filters.search), $options: "i" };
  if (filters?.isActive !== void 0) query.isActive = filters.isActive;
  const vendors2 = await VendorModel.find(query).sort({ createdAt: -1, id: -1 }).lean();
  return toRows(vendors, vendors2);
}
async function getVendorById(id) {
  await connectDb();
  return toRowOrNull(vendors, await VendorModel.findOne({ id }).lean());
}
async function createVendor(data) {
  await connectDb();
  const id = await getNextSequence("vendors");
  const code = data.code || `VN${String(id).padStart(6, "0")}`;
  const created = await VendorModel.create({ ...cleanDecimals(data, []), id, code });
  return toRow(vendors, created.toObject());
}
async function updateVendor(id, data) {
  await connectDb();
  await VendorModel.updateOne({ id }, { $set: cleanDecimals(data, []) });
  return await getVendorById(id);
}
async function deleteVendor(id) {
  await connectDb();
  await VendorModel.updateOne({ id }, { $set: { isActive: false } });
}
var PROCESS_DECIMALS = [
  "issueBodyWeight",
  "returnBodyWeight",
  "gemsIssueWeight",
  "gemsReturnWeight",
  "lumpSumLabour"
];
async function withVendors(processes) {
  const vendorIds = Array.from(new Set(processes.map((p) => p.vendorId).filter(Boolean)));
  const vendors2 = vendorIds.length ? await VendorModel.find({ id: { $in: vendorIds } }).lean() : [];
  const vendorMap = new Map(vendors2.map((vendor) => [vendor.id, vendor]));
  return processes.map((process2) => ({
    process: toRow(orderProcesses, process2),
    vendor: process2.vendorId ? toRowOrNull(vendors, vendorMap.get(process2.vendorId)) : null
  }));
}
async function getOrderProcesses(orderId) {
  await connectDb();
  const processes = await OrderProcessModel.find({ orderId }).sort({ createdAt: 1, id: 1 }).lean();
  return withVendors(processes);
}
async function getProcessById(id) {
  await connectDb();
  const process2 = await OrderProcessModel.findOne({ id }).lean();
  if (!process2) return null;
  const [row] = await withVendors([process2]);
  return row;
}
async function createOrderProcess(data) {
  await connectDb();
  const id = await getNextSequence("order_processes");
  const created = await OrderProcessModel.create({ id, ...cleanDecimals(data, PROCESS_DECIMALS) });
  return toRow(orderProcesses, created.toObject());
}
async function updateOrderProcess(id, data) {
  await connectDb();
  await OrderProcessModel.updateOne({ id }, { $set: cleanDecimals(data, PROCESS_DECIMALS) });
  return await getProcessById(id);
}
async function deleteOrderProcess(id) {
  await connectDb();
  await OrderProcessModel.deleteOne({ id });
}
async function getOrderAdvanceMetals(orderId) {
  await connectDb();
  const rows = await OrderAdvanceMetalModel.find({ orderId }).sort({ id: 1 }).lean();
  return toRows(orderAdvanceMetals, rows);
}
async function addOrderAdvanceMetal(data) {
  await connectDb();
  const id = await getNextSequence("order_advance_metals");
  const created = await OrderAdvanceMetalModel.create({
    id,
    ...cleanDecimals(data, ["weight", "netWeightRate", "value"])
  });
  return toRow(orderAdvanceMetals, created.toObject());
}
async function deleteOrderAdvanceMetal(id) {
  await connectDb();
  await OrderAdvanceMetalModel.deleteOne({ id });
}
async function getOrderAdvanceGems(orderId) {
  await connectDb();
  const rows = await OrderAdvanceGemModel.find({ orderId }).sort({ id: 1 }).lean();
  return toRows(orderAdvanceGems, rows);
}
async function addOrderAdvanceGem(data) {
  await connectDb();
  const id = await getNextSequence("order_advance_gems");
  const created = await OrderAdvanceGemModel.create({ id, ...cleanDecimals(data, ["weight"]) });
  return toRow(orderAdvanceGems, created.toObject());
}
async function deleteOrderAdvanceGem(id) {
  await connectDb();
  await OrderAdvanceGemModel.deleteOne({ id });
}
var INVOICE_DECIMALS = ["metalValue", "stoneValue", "makingCharges", "otherCharges", "discount", "totalAmount"];
var INVOICE_ITEM_DECIMALS = ["weight", "wastage", "netWeight", "rate", "amount"];
async function getAllInvoices() {
  await connectDb();
  const invoices = await OrderInvoiceModel.find({}).sort({ invoiceDate: -1, id: -1 }).lean();
  const orderIds = Array.from(new Set(invoices.map((invoice) => invoice.orderId)));
  const customerIds = Array.from(new Set(invoices.map((invoice) => invoice.customerId).filter(Boolean)));
  const [orders2, customers2] = await Promise.all([
    OrderModel.find({ id: { $in: orderIds } }, { id: 1, orderNumber: 1 }).lean(),
    CustomerModel.find({ id: { $in: customerIds } }, { id: 1, firstName: 1, lastName: 1 }).lean()
  ]);
  const orderMap = new Map(orders2.map((order) => [order.id, order]));
  const customerMap = new Map(customers2.map((customer) => [customer.id, customer]));
  return invoices.map((invoice) => {
    const customer = invoice.customerId ? customerMap.get(invoice.customerId) : void 0;
    return {
      invoice: toRow(orderInvoices, invoice),
      orderNumber: orderMap.get(invoice.orderId)?.orderNumber ?? null,
      customerFirstName: customer?.firstName ?? null,
      customerLastName: customer?.lastName ?? null
    };
  });
}
async function getOrderInvoices(orderId) {
  await connectDb();
  const invoices = await OrderInvoiceModel.find({ orderId }).sort({ createdAt: -1, id: -1 }).lean();
  return toRows(orderInvoices, invoices);
}
async function getInvoiceById(id) {
  await connectDb();
  return toRowOrNull(orderInvoices, await OrderInvoiceModel.findOne({ id }).lean());
}
async function createInvoice(data) {
  await connectDb();
  const id = await getNextSequence("order_invoices");
  const created = await OrderInvoiceModel.create({ id, ...cleanDecimals(data, INVOICE_DECIMALS) });
  return toRow(orderInvoices, created.toObject());
}
async function updateInvoice(id, data) {
  await connectDb();
  await OrderInvoiceModel.updateOne({ id }, { $set: cleanDecimals(data, INVOICE_DECIMALS) });
  return await getInvoiceById(id);
}
async function getInvoiceItems(invoiceId) {
  await connectDb();
  const items = await OrderInvoiceItemModel.find({ invoiceId }).sort({ sortOrder: 1, id: 1 }).lean();
  return toRows(orderInvoiceItems, items);
}
async function addInvoiceItems(invoiceId, items) {
  await connectDb();
  const docs = [];
  for (const item of items) {
    docs.push({
      id: await getNextSequence("order_invoice_items"),
      invoiceId,
      ...cleanDecimals(item, INVOICE_ITEM_DECIMALS)
    });
  }
  if (docs.length) await OrderInvoiceItemModel.insertMany(docs);
}
async function deleteInvoiceItems(invoiceId) {
  await connectDb();
  await OrderInvoiceItemModel.deleteMany({ invoiceId });
}
async function generateInvoiceNumber() {
  await connectDb();
  const now = /* @__PURE__ */ new Date();
  const prefix = `INV${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  return nextPrefixedNumber(OrderInvoiceModel, "invoiceNumber", prefix);
}
async function getOrderWithDetails(orderId) {
  await connectDb();
  const order = await OrderModel.findOne({ id: orderId }).lean();
  if (!order) return null;
  const customer = order.customerId ? await CustomerModel.findOne({ id: order.customerId }).lean() : null;
  const [items, processes, advanceMetals, advanceGems, invoices] = await Promise.all([
    getOrderItemsRaw(orderId),
    getOrderProcesses(orderId),
    getOrderAdvanceMetals(orderId),
    getOrderAdvanceGems(orderId),
    getOrderInvoices(orderId)
  ]);
  return {
    order: orderRow(order),
    customer: toRowOrNull(customers, customer),
    items,
    processes,
    advanceMetals,
    advanceGems,
    invoices
  };
}

// server/financeDb.ts
import { Schema as Schema2 } from "mongoose";
import { nanoid } from "nanoid";
var withTimestamps2 = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
};
var LedgerAccountSchema = new Schema2(
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
    createdBy: { type: Number }
  },
  { ...withTimestamps2, collection: "ledger_accounts" }
);
var JournalLineSchema = new Schema2(
  {
    id: { type: Number, required: true },
    accountId: { type: Number, required: true },
    description: { type: String },
    debitCents: { type: Number, required: true, default: 0 },
    creditCents: { type: Number, required: true, default: 0 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);
var JournalEntrySchema = new Schema2(
  {
    id: { type: Number, required: true, unique: true, index: true },
    entryNumber: { type: String, required: true, unique: true },
    entryType: {
      type: String,
      enum: ["cash_receipt", "cash_payment", "general_journal", "sales_invoice", "customer_advance", "reversal", "opening_balance"],
      required: true
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
    postedAt: { type: Date, default: Date.now }
  },
  { ...withTimestamps2, collection: "journal_entries" }
);
JournalEntrySchema.index({ "lines.accountId": 1 });
JournalEntrySchema.index({ referenceType: 1, referenceId: 1 });
JournalEntrySchema.index({ entryDate: -1, id: -1 });
var AuditLogSchema = new Schema2(
  {
    id: { type: Number, required: true, unique: true, index: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    details: { type: String },
    createdBy: { type: Number }
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, collection: "audit_logs" }
);
AuditLogSchema.index({ createdAt: -1 });
var LedgerAccountModel = ensureModel("LedgerAccount", LedgerAccountSchema);
var JournalEntryModel = ensureModel("JournalEntry", JournalEntrySchema);
var AuditLogModel = ensureModel("AuditLog", AuditLogSchema);
var SYSTEM_ACCOUNTS = [
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
  { code: "SA000001", title: "Jewelry Sales", description: "Jewelry sales income", accountClass: "income", ledgerType: "detail", openingBalanceSide: "credit", isSystem: true, isActive: true, parentCode: "SA000000" }
];
function moneyToCents(value) {
  if (value === "" || value === null || value === void 0) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid monetary amount");
    return moneyToCents(value.toFixed(3));
  }
  const match = value.trim().replace(/,/g, "").match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!match || !match[2] && !match[3]) throw new Error("Invalid monetary amount");
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2] || "0");
  const fraction = (match[3] || "").padEnd(3, "0");
  const cents = whole * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid monetary amount");
  return sign * cents;
}
function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}
function formatEntityCode(prefix, id) {
  return `${prefix}${String(id).padStart(6, "0")}`;
}
function isDuplicateKeyError(error) {
  return error?.code === 11e3;
}
function ledgerRow(doc) {
  return toRow(ledgerAccounts, doc);
}
function entryRow(doc) {
  return toRow(journalEntries, {
    ...doc,
    totalDebit: doc.totalDebitCents / 100,
    totalCredit: doc.totalCreditCents / 100
  });
}
function lineRow(entryId, line) {
  return toRow(journalLines, {
    ...line,
    journalEntryId: entryId,
    debit: line.debitCents / 100,
    credit: line.creditCents / 100
  });
}
async function getAccountByCode(code) {
  await connectDb();
  return LedgerAccountModel.findOne({ code }).lean();
}
async function getAccountById(id) {
  await connectDb();
  return LedgerAccountModel.findOne({ id }).lean();
}
async function insertLedger(values, uniqueFilter, options = {}) {
  let code = values.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const id = await getNextSequence("ledger_accounts");
      const created = await LedgerAccountModel.create({ ...values, code, id });
      return created.toObject();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrent = await LedgerAccountModel.findOne(uniqueFilter).lean();
      if (concurrent) return concurrent;
      if (!options.allowCodeSuffix) throw error;
      code = `${values.code}-${nanoid(4).toUpperCase()}`;
    }
  }
  throw new Error("Could not allocate a unique ledger code, please retry");
}
async function createAuditLog(data) {
  await connectDb();
  await AuditLogModel.create({
    id: await getNextSequence("audit_logs"),
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId == null ? null : String(data.entityId),
    details: data.details == null ? null : JSON.stringify(data.details),
    createdBy: data.createdBy
  });
}
async function getAuditLogs(limit = 100) {
  await connectDb();
  const logs = await AuditLogModel.find({}).sort({ createdAt: -1, id: -1 }).limit(limit).lean();
  const userIds = Array.from(new Set(logs.map((log) => log.createdBy).filter(Boolean)));
  const users2 = userIds.length ? await UserModel.find({ id: { $in: userIds } }, { id: 1, name: 1 }).lean() : [];
  const userMap = new Map(users2.map((user) => [user.id, user]));
  return logs.map((log) => ({
    log: toRow(auditLogs, log),
    actorName: (log.createdBy ? userMap.get(log.createdBy)?.name : null) ?? null
  }));
}
var setupComplete = false;
async function ensureSystemAccounts(userId) {
  const existing = await LedgerAccountModel.find({ code: { $in: SYSTEM_ACCOUNTS.map((a) => a.code) } }).lean();
  const byCode = new Map(existing.map((account) => [account.code, account]));
  const ordered = [
    ...SYSTEM_ACCOUNTS.filter((account) => !account.parentCode),
    ...SYSTEM_ACCOUNTS.filter((account) => account.parentCode)
  ];
  for (const definition of ordered) {
    if (byCode.has(definition.code)) continue;
    const { parentCode, ...values } = definition;
    const parentId = parentCode ? byCode.get(parentCode)?.id : void 0;
    if (parentCode && !parentId) throw new Error(`Missing parent account ${parentCode}`);
    const created = await insertLedger(
      { ...values, parentId: parentId ?? null, openingBalance: 0, createdBy: userId },
      { code: definition.code }
    );
    byCode.set(definition.code, created);
  }
}
async function ensureFinanceSetup(userId) {
  await connectDb();
  await ensureSystemAccounts(userId);
  const [customerLedgerIds, vendorLedgerIds] = await Promise.all([
    LedgerAccountModel.distinct("customerId", { customerId: { $ne: null } }),
    LedgerAccountModel.distinct("vendorId", { vendorId: { $ne: null } })
  ]);
  const [missingCustomers, missingVendors] = await Promise.all([
    CustomerModel.find({ id: { $nin: customerLedgerIds } }, { id: 1 }).lean(),
    VendorModel.find({ id: { $nin: vendorLedgerIds } }, { id: 1 }).lean()
  ]);
  for (const customer of missingCustomers) await ensureCustomerLedger(customer.id, userId);
  for (const vendor of missingVendors) await ensureVendorLedger(vendor.id, userId);
  setupComplete = true;
  return { success: true };
}
async function ensureSetupOnce(userId) {
  if (!setupComplete) await ensureFinanceSetup(userId);
}
async function requireControlAccount(code, userId) {
  let parent = await getAccountByCode(code);
  if (!parent) {
    await ensureSystemAccounts(userId);
    parent = await getAccountByCode(code);
  }
  if (!parent) throw new Error(`${code === "CS000000" ? "Customer" : "Vendor"} control account is unavailable`);
  return parent;
}
async function uniqueEntityCode(preferred) {
  const owner = await getAccountByCode(preferred);
  return owner ? `${preferred}-${nanoid(4).toUpperCase()}` : preferred;
}
async function ensureCustomerLedger(customerId, userId) {
  await connectDb();
  const existing = await LedgerAccountModel.findOne({ customerId }).lean();
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
      createdBy: userId
    },
    { customerId },
    { allowCodeSuffix: true }
  );
  return ledgerRow(created);
}
async function ensureVendorLedger(vendorId, userId) {
  await connectDb();
  const existing = await LedgerAccountModel.findOne({ vendorId }).lean();
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
      createdBy: userId
    },
    { vendorId },
    { allowCodeSuffix: true }
  );
  return ledgerRow(created);
}
async function syncCustomerLedgerTitle(customerId) {
  await connectDb();
  const customer = await CustomerModel.findOne({ id: customerId }).lean();
  if (!customer) return;
  const name = `${customer.firstName} ${customer.lastName || ""}`.trim();
  await LedgerAccountModel.updateOne(
    { customerId },
    { $set: { title: name, description: `Customer account for ${name}` } }
  );
}
async function syncVendorLedger(vendorId) {
  await connectDb();
  const vendor = await VendorModel.findOne({ id: vendorId }).lean();
  if (!vendor) return;
  await LedgerAccountModel.updateOne(
    { vendorId },
    { $set: { title: vendor.name, description: `Vendor account for ${vendor.name}`, isActive: vendor.isActive !== false } }
  );
}
async function accountHasPostings(accountId) {
  return await JournalEntryModel.countDocuments({ "lines.accountId": accountId }) > 0;
}
async function assertCustomerLedgerDeletable(customerId) {
  await connectDb();
  const ledger = await LedgerAccountModel.findOne({ customerId }).lean();
  if (ledger && await accountHasPostings(ledger.id)) {
    throw new Error("This customer has accounting entries and cannot be deleted");
  }
}
async function removeCustomerLedger(customerId, userId) {
  await connectDb();
  const ledger = await LedgerAccountModel.findOne({ customerId }).lean();
  if (!ledger) return;
  if (await accountHasPostings(ledger.id)) return;
  await LedgerAccountModel.deleteOne({ id: ledger.id });
  await createAuditLog({ action: "ledger.deleted", entityType: "ledger_account", entityId: ledger.id, details: { customerId, code: ledger.code }, createdBy: userId });
}
async function deactivateVendorLedger(vendorId, userId) {
  await connectDb();
  await LedgerAccountModel.updateOne({ vendorId }, { $set: { isActive: false } });
  await createAuditLog({ action: "vendor.deactivated", entityType: "vendor", entityId: vendorId, createdBy: userId });
}
async function listUsers2() {
  return listUsers();
}
async function updateUserRole(userId, role, changedBy) {
  const target = await getPublicUserById(userId);
  if (!target) throw new Error("User not found");
  const updated = await setUserFields(userId, { role });
  await createAuditLog({ action: "user.role_updated", entityType: "user", entityId: userId, details: { previousRole: target.role, role }, createdBy: changedBy });
  return updated;
}
async function generateLedgerCode(parentId, accountClass) {
  let prefix = { asset: "AS", liability: "LI", equity: "EQ", income: "IN", expense: "EX" }[accountClass];
  if (parentId) {
    const parent = await getAccountById(parentId);
    if (!parent) throw new Error("Parent account not found");
    prefix = parent.code.slice(0, 2).toUpperCase();
  }
  const accounts = await LedgerAccountModel.find({ code: { $regex: `^${prefix}\\d{6}$` } }, { code: 1 }).lean();
  const highest = accounts.reduce((max, account) => Math.max(max, Number(String(account.code).slice(2))), 0);
  return `${prefix}${String(highest + 1).padStart(6, "0")}`;
}
async function createLedgerAccount(data, userId) {
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
        createdBy: userId
      });
      const account = ledgerRow(created.toObject());
      await createAuditLog({ action: "ledger.created", entityType: "ledger_account", entityId: account.id, details: { code, title: data.title }, createdBy: userId });
      return account;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        if (requestedCode) throw new Error(`Account code ${requestedCode} is already in use`);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a unique account code, please retry");
}
async function updateLedgerAccount(id, data, userId) {
  await connectDb();
  const existing = await getAccountById(id);
  if (!existing) throw new Error("Ledger account not found");
  if (data.parentId) {
    if (data.parentId === id) throw new Error("An account cannot be its own parent");
    const parent = await getAccountById(data.parentId);
    if (!parent || parent.ledgerType !== "control") throw new Error("Parent account must be a control ledger");
  }
  if (!existing.isSystem && await accountHasPostings(id)) {
    const locked = ["ledgerType", "accountClass", "parentId", "openingBalance", "openingBalanceSide"].filter((key) => {
      const next = data[key];
      if (next === void 0) return false;
      if (key === "openingBalance") return moneyToCents(next) !== moneyToCents(existing.openingBalance);
      return (next ?? null) !== (existing[key] ?? null);
    });
    if (locked.length) {
      throw new Error(`This ledger already has postings; ${locked.join(", ")} can no longer be changed`);
    }
  }
  if (data.ledgerType === "control" && existing.ledgerType === "detail" && await accountHasPostings(id)) {
    throw new Error("A ledger with postings cannot become a control account");
  }
  const candidate = existing.isSystem ? { title: data.title, description: data.description, isActive: data.isActive } : {
    ...data,
    ...data.openingBalance !== void 0 ? { openingBalance: moneyToCents(data.openingBalance) / 100 } : {}
  };
  delete candidate.code;
  const safeData = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== void 0));
  await LedgerAccountModel.updateOne({ id }, { $set: safeData });
  await createAuditLog({ action: "ledger.updated", entityType: "ledger_account", entityId: id, details: safeData, createdBy: userId });
  const updated = await getAccountById(id);
  return ledgerRow(updated);
}
async function getMovementByAccount() {
  const entries = await JournalEntryModel.find({}, { "lines.accountId": 1, "lines.debitCents": 1, "lines.creditCents": 1 }).lean();
  const movement = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    for (const line of entry.lines) {
      movement.set(line.accountId, (movement.get(line.accountId) || 0) + line.debitCents - line.creditCents);
    }
  }
  return movement;
}
async function getLedgerAccounts(filters) {
  await connectDb();
  const [accounts, movement] = await Promise.all([
    LedgerAccountModel.find({}).sort({ code: 1 }).lean(),
    getMovementByAccount()
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ownBalance = (account) => moneyToCents(account.openingBalance) * (account.openingBalanceSide === "debit" ? 1 : -1) + (movement.get(account.id) || 0);
  const children = /* @__PURE__ */ new Map();
  for (const account of accounts) {
    if (!account.parentId) continue;
    children.set(account.parentId, [...children.get(account.parentId) ?? [], account]);
  }
  const rolledUp = /* @__PURE__ */ new Map();
  const balanceOf = (account, seen = /* @__PURE__ */ new Set()) => {
    if (rolledUp.has(account.id)) return rolledUp.get(account.id);
    if (seen.has(account.id)) return 0;
    seen.add(account.id);
    const total = ownBalance(account) + (children.get(account.id) ?? []).reduce((sum, child) => sum + balanceOf(child, seen), 0);
    rolledUp.set(account.id, total);
    return total;
  };
  const search = filters?.search?.toLowerCase();
  return accounts.filter((account) => !search || `${account.code} ${account.title}`.toLowerCase().includes(search)).filter((account) => !filters?.ledgerType || account.ledgerType === filters.ledgerType).filter((account) => !filters?.activeOnly || account.isActive !== false).map((account) => {
    const balanceCents = account.ledgerType === "control" ? balanceOf(account) : ownBalance(account);
    return {
      ...ledgerRow(account),
      parentTitle: account.parentId ? byId.get(account.parentId)?.title || null : null,
      balance: centsToMoney(Math.abs(balanceCents)),
      balanceSide: balanceCents >= 0 ? "debit" : "credit"
    };
  });
}
var ENTRY_PREFIX = {
  general_journal: "JV",
  cash_receipt: "CR",
  cash_payment: "CP",
  sales_invoice: "SI",
  reversal: "RV",
  customer_advance: "AD",
  opening_balance: "OB"
};
async function createJournalEntry(data) {
  await connectDb();
  if (data.lines.length < 2) throw new Error("A journal entry requires at least two lines");
  if (Number.isNaN(data.entryDate.getTime())) throw new Error("Invalid entry date");
  const normalized = data.lines.map((line) => {
    const debit = moneyToCents(line.debit);
    const credit = moneyToCents(line.credit);
    if (debit < 0 || credit < 0) throw new Error("Debit and credit cannot be negative");
    if (debit === 0 && credit === 0 || debit > 0 && credit > 0) {
      throw new Error("Each line must contain either a debit or a credit amount");
    }
    return { ...line, debit, credit };
  });
  const totalDebit = normalized.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = normalized.reduce((sum, line) => sum + line.credit, 0);
  if (totalDebit <= 0 || totalDebit !== totalCredit) throw new Error("Total debit and credit must be equal");
  const accountIds = Array.from(new Set(normalized.map((line) => line.accountId)));
  const accounts = await LedgerAccountModel.find({ id: { $in: accountIds } }, { id: 1, ledgerType: 1, code: 1, isActive: 1 }).lean();
  if (accounts.length !== accountIds.length) throw new Error("One or more ledger accounts do not exist");
  const controlAccount = accounts.find((account) => account.ledgerType === "control");
  if (controlAccount) throw new Error(`Post to detail ledgers only (${controlAccount.code} is a control account)`);
  if (data.entryType !== "reversal") {
    const inactive = accounts.find((account) => account.isActive === false);
    if (inactive) throw new Error(`Ledger ${inactive.code} is inactive. Reactivate it before posting.`);
  }
  const id = await getNextSequence("journal_entries");
  const entryNumber = `${ENTRY_PREFIX[data.entryType]}-${(/* @__PURE__ */ new Date()).toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
  const lines = [];
  for (const line of normalized) {
    lines.push({
      id: await getNextSequence("journal_lines"),
      accountId: line.accountId,
      description: line.description,
      debitCents: line.debit,
      creditCents: line.credit
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
    createdBy: data.createdBy
  });
  await createAuditLog({
    action: "journal.posted",
    entityType: "journal_entry",
    entityId: id,
    details: { entryNumber, entryType: data.entryType, total: centsToMoney(totalDebit) },
    createdBy: data.createdBy
  });
  return { id, entryNumber, totalDebit: centsToMoney(totalDebit), totalCredit: centsToMoney(totalCredit) };
}
async function postOnce(sourceKey, post) {
  const existing = await JournalEntryModel.findOne({ sourceKey }).lean();
  if (existing) return entrySummary(existing);
  try {
    return await post();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const concurrent = await JournalEntryModel.findOne({ sourceKey }).lean();
      if (concurrent) return entrySummary(concurrent);
    }
    throw error;
  }
}
function entrySummary(entry) {
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    totalDebit: centsToMoney(entry.totalDebitCents),
    totalCredit: centsToMoney(entry.totalCreditCents)
  };
}
async function createCashVoucher(data) {
  if (!data.counterpartLines.length) throw new Error("Add at least one voucher line");
  const cashAccount = await getAccountById(data.cashAccountId);
  if (!cashAccount || !cashAccount.code.startsWith("CA")) throw new Error("Select a cash or bank account");
  if (data.counterpartLines.some((line) => line.accountId === data.cashAccountId)) {
    throw new Error("The cash account cannot also be a voucher line");
  }
  const totalCents = data.counterpartLines.reduce((sum, line) => sum + moneyToCents(line.amount), 0);
  if (totalCents <= 0) throw new Error("Voucher total must be greater than zero");
  const counterpart = data.counterpartLines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debit: data.voucherType === "cash_payment" ? line.amount : "0",
    credit: data.voucherType === "cash_receipt" ? line.amount : "0"
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
        credit: data.voucherType === "cash_payment" ? centsToMoney(totalCents) : "0"
      },
      ...counterpart
    ]
  });
}
async function creatorNames(ids) {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "number")));
  if (!unique.length) return /* @__PURE__ */ new Map();
  const users2 = await UserModel.find({ id: { $in: unique } }, { id: 1, name: 1 }).lean();
  return new Map(users2.map((user) => [user.id, user.name ?? null]));
}
async function getJournalEntries(limit = 100) {
  await connectDb();
  const entries = await JournalEntryModel.find({}).sort({ entryDate: -1, id: -1 }).limit(limit).lean();
  const names = await creatorNames(entries.map((entry) => entry.createdBy));
  return entries.map((entry) => ({
    entry: entryRow(entry),
    creatorName: entry.createdBy ? names.get(entry.createdBy) ?? null : null
  }));
}
async function getJournalEntryById(id) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ id }).lean();
  if (!entry) return null;
  const accounts = await LedgerAccountModel.find({ id: { $in: entry.lines.map((line) => line.accountId) } }).lean();
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  return {
    entry: entryRow(entry),
    lines: entry.lines.filter((line) => accountMap.has(line.accountId)).map((line) => ({ line: lineRow(entry.id, line), account: ledgerRow(accountMap.get(line.accountId)) }))
  };
}
async function reverseJournalEntry(id, reason, userId) {
  await connectDb();
  const source = await JournalEntryModel.findOne({ id }).lean();
  if (!source) throw new Error("Journal entry not found");
  if (source.entryType === "reversal") throw new Error("A reversal entry cannot itself be reversed");
  if (source.status === "reversed") throw new Error("Journal entry is already reversed");
  const reversal = await postOnce(`reversal_of:${id}`, () => createJournalEntry({
    entryType: "reversal",
    entryDate: /* @__PURE__ */ new Date(),
    narration: `Reversal of ${source.entryNumber}: ${reason}`,
    referenceType: "journal_entry",
    referenceId: id,
    sourceKey: `reversal_of:${id}`,
    reversalOfId: id,
    createdBy: userId,
    lines: source.lines.map((line) => ({
      accountId: line.accountId,
      description: `Reversal: ${line.description || source.narration || source.entryNumber}`,
      debit: centsToMoney(line.creditCents),
      credit: centsToMoney(line.debitCents)
    }))
  }));
  await JournalEntryModel.updateOne(
    { id },
    {
      $set: {
        status: "reversed",
        reversedById: reversal.id,
        reversalReason: reason,
        ...source.sourceKey ? { sourceKey: `reversed:${id}:${source.sourceKey}` } : {}
      }
    }
  );
  await createAuditLog({ action: "journal.reversed", entityType: "journal_entry", entityId: id, details: { reversalId: reversal.id, reason }, createdBy: userId });
  return reversal;
}
async function getAccountStatement(accountId) {
  await connectDb();
  const account = await getAccountById(accountId);
  if (!account) return null;
  const entries = await JournalEntryModel.find({ "lines.accountId": accountId }).sort({ entryDate: 1, id: 1 }).lean();
  let runningCents = moneyToCents(account.openingBalance) * (account.openingBalanceSide === "debit" ? 1 : -1);
  const transactions = [];
  for (const entry of entries) {
    for (const line of entry.lines.filter((line2) => line2.accountId === accountId)) {
      runningCents += line.debitCents - line.creditCents;
      transactions.push({
        line: lineRow(entry.id, line),
        entry: entryRow(entry),
        runningBalance: centsToMoney(Math.abs(runningCents)),
        runningBalanceSide: runningCents >= 0 ? "debit" : "credit"
      });
    }
  }
  return { account: ledgerRow(account), transactions };
}
async function getTrialBalance() {
  const accounts = (await getLedgerAccounts({ ledgerType: "detail" })).filter((account) => account.isActive || account.balance !== "0.00");
  const rows = accounts.map((account) => ({
    id: account.id,
    code: account.code,
    title: account.title,
    debit: account.balanceSide === "debit" ? account.balance : "0.00",
    credit: account.balanceSide === "credit" ? account.balance : "0.00"
  }));
  const allAccounts = await LedgerAccountModel.find({ ledgerType: "detail", openingBalance: { $nin: [0, null] } }, { openingBalance: 1, openingBalanceSide: 1 }).lean();
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
      credit: openingNet > 0 ? centsToMoney(openingNet) : "0.00"
    });
  }
  const totalDebit = rows.reduce((sum, row) => sum + moneyToCents(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + moneyToCents(row.credit), 0);
  return { rows, totalDebit: centsToMoney(totalDebit), totalCredit: centsToMoney(totalCredit) };
}
async function getFinanceSummary() {
  const accounts = await getLedgerAccounts({ ledgerType: "detail" });
  const signed = (account) => moneyToCents(account.balance) * (account.balanceSide === "debit" ? 1 : -1);
  const sum = (prefix, pick) => accounts.filter((account) => account.code.startsWith(prefix)).reduce((total, account) => total + pick(signed(account)), 0);
  return {
    cash: centsToMoney(sum("CA", (value) => value)),
    receivables: centsToMoney(sum("CS", (value) => Math.max(0, value))),
    customerCredits: centsToMoney(sum("CS", (value) => Math.max(0, -value))),
    vendorPayables: centsToMoney(sum("VN", (value) => Math.max(0, -value))),
    revenue: centsToMoney(sum("SA", (value) => Math.max(0, -value))),
    expenses: centsToMoney(sum("EX", (value) => Math.max(0, value)))
  };
}
async function getSourceEntry(referenceType, referenceId) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ sourceKey: `${referenceType}:${referenceId}` }).lean();
  return entry ? entryRow(entry) : null;
}
async function ensurePostingReady(customerId, userId, accountCodes) {
  await ensureSetupOnce(userId);
  await ensureCustomerLedger(customerId, userId);
  for (const code of accountCodes) {
    const account = await getAccountByCode(code);
    if (!account) throw new Error(`Ledger ${code} is unavailable`);
    if (account.isActive === false) throw new Error(`Ledger ${code} (${account.title}) is inactive. Reactivate it in Finance first.`);
  }
}
async function postInvoiceToLedger(invoiceId, userId) {
  await connectDb();
  const invoice = await OrderInvoiceModel.findOne({ id: invoiceId }).lean();
  if (!invoice) throw new Error("Invoice not found");
  if (!invoice.customerId) throw new Error("Invoice customer is required for ledger posting");
  const totalCents = moneyToCents(invoice.totalAmount);
  if (totalCents <= 0) throw new Error("Invoice total must be greater than zero before posting");
  await ensureSetupOnce(userId);
  const customerAccount = await ensureCustomerLedger(invoice.customerId, userId);
  const salesAccount = await getAccountByCode("SA000001");
  if (!salesAccount) throw new Error("Sales account is unavailable");
  const sourceKey = `order_invoice:${invoice.id}`;
  const journal = await postOnce(sourceKey, () => createJournalEntry({
    entryType: "sales_invoice",
    entryDate: invoice.invoiceDate || /* @__PURE__ */ new Date(),
    narration: `Sales invoice ${invoice.invoiceNumber || invoice.id}`,
    referenceType: "order_invoice",
    referenceId: invoice.id,
    sourceKey,
    createdBy: userId,
    lines: [
      { accountId: customerAccount.id, debit: centsToMoney(totalCents), credit: "0", description: invoice.remarks || void 0 },
      { accountId: salesAccount.id, debit: "0", credit: centsToMoney(totalCents), description: invoice.remarks || void 0 }
    ]
  }));
  if (invoice.status === "draft") {
    await OrderInvoiceModel.updateOne({ id: invoiceId }, { $set: { status: "sent" } });
  }
  return journal;
}
async function postOrderCashAdvance(data) {
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
      { accountId: customerAccount.id, debit: "0", credit: centsToMoney(amountCents) }
    ]
  }));
}
async function postOrderMetalAdvance(data) {
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
      { accountId: customerAccount.id, debit: "0", credit: centsToMoney(amountCents) }
    ]
  }));
}
async function hasActivePosting(referenceType, referenceId) {
  await connectDb();
  const entry = await JournalEntryModel.findOne({ sourceKey: `${referenceType}:${referenceId}` }, { status: 1 }).lean();
  return Boolean(entry && entry.status === "posted");
}

// server/financeRouter.ts
var roleSchema = z2.enum(["user", "operations_finance", "admin"]);
var passwordSchema = z2.string().min(8, "Password must be at least 8 characters").max(128);
var dateString = z2.string().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date");
var accountClassSchema = z2.enum(["asset", "liability", "equity", "income", "expense"]);
var ledgerTypeSchema = z2.enum(["control", "detail"]);
var journalLineSchema = z2.object({
  accountId: z2.number().int().positive(),
  description: z2.string().optional(),
  debit: z2.string().optional(),
  credit: z2.string().optional()
});
var accessRouter = router({
  users: adminProcedure.query(async () => listUsers2()),
  createUser: adminProcedure.input(z2.object({
    name: z2.string().trim().min(1).max(120),
    email: z2.string().trim().email(),
    password: passwordSchema,
    role: roleSchema.default("operations_finance")
  })).mutation(async ({ input, ctx }) => {
    try {
      const user = await createUserAccount(input);
      await createAuditLog({
        action: "user.created",
        entityType: "user",
        entityId: user.id,
        details: { email: user.email, role: user.role },
        createdBy: ctx.user.id
      });
      return user;
    } catch (error) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: error.message });
    }
  }),
  updateRole: adminProcedure.input(z2.object({ userId: z2.number().int().positive(), role: roleSchema })).mutation(async ({ input, ctx }) => {
    if (input.userId === ctx.user.id && input.role !== "admin") {
      throw new TRPCError3({ code: "BAD_REQUEST", message: "A Super Admin cannot remove their own Super Admin access" });
    }
    return updateUserRole(input.userId, input.role, ctx.user.id);
  }),
  setActive: adminProcedure.input(z2.object({ userId: z2.number().int().positive(), isActive: z2.boolean() })).mutation(async ({ input, ctx }) => {
    if (input.userId === ctx.user.id && !input.isActive) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: "You cannot deactivate your own account" });
    }
    const target = await getPublicUserById(input.userId);
    if (!target) throw new TRPCError3({ code: "NOT_FOUND", message: "User not found" });
    const updated = await setUserFields(input.userId, { isActive: input.isActive });
    await createAuditLog({
      action: input.isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: input.userId,
      createdBy: ctx.user.id
    });
    return updated;
  }),
  resetPassword: adminProcedure.input(z2.object({ userId: z2.number().int().positive(), password: passwordSchema })).mutation(async ({ input, ctx }) => {
    const target = await getPublicUserById(input.userId);
    if (!target) throw new TRPCError3({ code: "NOT_FOUND", message: "User not found" });
    await setUserFields(input.userId, { passwordHash: await hashPassword(input.password) });
    await createAuditLog({
      action: "user.password_reset",
      entityType: "user",
      entityId: input.userId,
      createdBy: ctx.user.id
    });
    return { success: true };
  }),
  auditLog: adminProcedure.input(z2.object({ limit: z2.number().int().min(1).max(500).default(100) }).optional()).query(async ({ input }) => getAuditLogs(input?.limit ?? 100))
});
var financeRouter = router({
  initialize: operationsFinanceProcedure.mutation(async ({ ctx }) => {
    return ensureFinanceSetup(ctx.user.id);
  }),
  summary: operationsFinanceProcedure.query(async ({ ctx }) => {
    await ensureFinanceSetup(ctx.user.id);
    return getFinanceSummary();
  }),
  accounts: router({
    list: operationsFinanceProcedure.input(z2.object({
      search: z2.string().optional(),
      ledgerType: ledgerTypeSchema.optional(),
      activeOnly: z2.boolean().optional()
    }).optional()).query(async ({ input, ctx }) => {
      await ensureFinanceSetup(ctx.user.id);
      return getLedgerAccounts(input);
    }),
    create: operationsFinanceProcedure.input(z2.object({
      code: z2.string().min(2).max(20).optional(),
      title: z2.string().min(1).max(255),
      description: z2.string().optional(),
      accountClass: accountClassSchema,
      ledgerType: ledgerTypeSchema,
      parentId: z2.number().int().positive().optional(),
      openingBalance: z2.string().default("0"),
      openingBalanceSide: z2.enum(["debit", "credit"]).default("debit"),
      isInventory: z2.boolean().default(false),
      isActive: z2.boolean().default(true)
    })).mutation(async ({ input, ctx }) => createLedgerAccount(input, ctx.user.id)),
    update: operationsFinanceProcedure.input(z2.object({
      id: z2.number().int().positive(),
      title: z2.string().min(1).max(255).optional(),
      description: z2.string().optional(),
      accountClass: accountClassSchema.optional(),
      ledgerType: ledgerTypeSchema.optional(),
      parentId: z2.number().int().positive().nullable().optional(),
      openingBalance: z2.string().optional(),
      openingBalanceSide: z2.enum(["debit", "credit"]).optional(),
      isInventory: z2.boolean().optional(),
      isActive: z2.boolean().optional()
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      return updateLedgerAccount(id, data, ctx.user.id);
    })
  }),
  vouchers: router({
    create: operationsFinanceProcedure.input(z2.object({
      voucherType: z2.enum(["cash_receipt", "cash_payment"]),
      entryDate: dateString,
      cashAccountId: z2.number().int().positive(),
      narration: z2.string().optional(),
      counterpartLines: z2.array(z2.object({
        accountId: z2.number().int().positive(),
        amount: z2.string(),
        description: z2.string().optional()
      })).min(1)
    })).mutation(async ({ input, ctx }) => createCashVoucher({
      ...input,
      entryDate: new Date(input.entryDate),
      createdBy: ctx.user.id
    }))
  }),
  journals: router({
    list: operationsFinanceProcedure.input(z2.object({ limit: z2.number().int().min(1).max(500).default(100) }).optional()).query(async ({ input, ctx }) => {
      await ensureFinanceSetup(ctx.user.id);
      return getJournalEntries(input?.limit ?? 100);
    }),
    get: operationsFinanceProcedure.input(z2.object({ id: z2.number().int().positive() })).query(async ({ input }) => getJournalEntryById(input.id)),
    create: operationsFinanceProcedure.input(z2.object({
      entryDate: dateString,
      narration: z2.string().min(1),
      lines: z2.array(journalLineSchema).min(2)
    })).mutation(async ({ input, ctx }) => createJournalEntry({
      entryType: "general_journal",
      entryDate: new Date(input.entryDate),
      narration: input.narration,
      lines: input.lines,
      createdBy: ctx.user.id
    })),
    reverse: adminProcedure.input(z2.object({ id: z2.number().int().positive(), reason: z2.string().min(3) })).mutation(async ({ input, ctx }) => reverseJournalEntry(input.id, input.reason, ctx.user.id))
  }),
  reports: router({
    trialBalance: operationsFinanceProcedure.query(async ({ ctx }) => {
      await ensureFinanceSetup(ctx.user.id);
      return getTrialBalance();
    }),
    accountLedger: operationsFinanceProcedure.input(z2.object({ accountId: z2.number().int().positive() })).query(async ({ input }) => getAccountStatement(input.accountId))
  })
});

// server/routers.ts
import { z as z3 } from "zod";
import { nanoid as nanoid2 } from "nanoid";

// server/_core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var resolveTarget = () => {
  if (ENV.llmApiKey) {
    const base = (ENV.llmApiUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    return {
      url: base.endsWith("/chat/completions") ? base : `${base}/chat/completions`,
      key: ENV.llmApiKey,
      model: ENV.llmModel || "gpt-4o-mini",
      manusForge: false
    };
  }
  if (ENV.forgeApiKey) {
    return {
      url: ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions` : "https://forge.manus.im/v1/chat/completions",
      key: ENV.forgeApiKey,
      model: ENV.llmModel || "gemini-2.5-flash",
      manusForge: true
    };
  }
  throw new Error("JulesBot AI is not configured: set LLM_API_KEY (and optionally LLM_API_URL, LLM_MODEL)");
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
async function invokeLLM(params) {
  const target = resolveTarget();
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format
  } = params;
  const payload = {
    model: target.model,
    messages: messages.map(normalizeMessage)
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  if (target.manusForge) {
    payload.max_tokens = 32768;
    payload.thinking = { budget_tokens: 128 };
  } else {
    payload.max_tokens = 2048;
  }
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.key}`,
      // Anthropic's OpenAI-compatible endpoint also accepts its native header.
      ...target.url.includes("anthropic.com") ? { "x-api-key": target.key, "anthropic-version": "2023-06-01" } : {}
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}

// server/storage.ts
function getStorageConfig() {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
function buildUploadUrl(baseUrl, relKey) {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}
function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function toFormData(data, contentType, fileName) {
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}
function buildAuthHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

// server/routers.ts
import { TRPCError as TRPCError4 } from "@trpc/server";
async function guard(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError4) throw error;
    const message = error?.message || "Request failed";
    throw new TRPCError4({ code: "BAD_REQUEST", message, cause: error });
  }
}
var optionalDate = z3.string().optional().refine(
  (value) => !value || !Number.isNaN(new Date(value).getTime()),
  "Invalid date"
);
var appRouter = router({
  system: systemRouter,
  access: accessRouter,
  finance: financeRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure.input(z3.object({
      email: z3.string().email(),
      password: z3.string().min(1)
    })).mutation(async ({ input, ctx }) => {
      const user = await getUserByEmail(input.email);
      const isValid = user ? await verifyPassword(input.password, user.passwordHash) : false;
      if (!user || !isValid) {
        throw new TRPCError4({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      if (user.isActive === false) {
        throw new TRPCError4({ code: "FORBIDDEN", message: "This account has been deactivated. Contact your Super Admin." });
      }
      await updateUserLastSignedIn(user.id);
      const token = await signSession({
        userId: user.id,
        email: user.email,
        role: user.role
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          role: user.role
        }
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  // Dashboard
  dashboard: router({
    stats: operationsFinanceProcedure.query(async () => {
      return await getDashboardStats();
    })
  }),
  // Gold Prices
  goldPrice: router({
    getToday: operationsFinanceProcedure.query(async () => {
      return await getTodayGoldPrice();
    }),
    getLatest: operationsFinanceProcedure.query(async () => {
      return await getLatestGoldPrice();
    }),
    set: operationsFinanceProcedure.input(z3.object({
      price22k: z3.coerce.string(),
      price24k: z3.coerce.string()
    })).mutation(async ({ input, ctx }) => {
      return await setGoldPrice({
        ...input,
        userId: ctx.user.id
      });
    })
  }),
  // Categories
  categories: router({
    list: adminProcedure.query(async () => {
      return await getAllCategories();
    })
  }),
  // Products
  products: router({
    list: adminProcedure.input(z3.object({
      categoryId: z3.number().optional(),
      search: z3.string().optional(),
      isActive: z3.boolean().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllProducts(input);
    }),
    getById: adminProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      return await getProductById(input.id);
    }),
    create: adminProcedure.input(z3.object({
      name: z3.string().min(1),
      description: z3.string().optional(),
      sku: z3.string().optional(),
      categoryId: z3.number().optional(),
      goldKarat: z3.enum(["22k", "24k"]).optional(),
      goldWeight: z3.string().optional(),
      goldWastage: z3.string().optional(),
      goldRateAtOrder: z3.string().optional(),
      makingCharges: z3.string().optional(),
      makingChargesType: z3.enum(["fixed", "per_gram"]).optional(),
      diamondWeight: z3.string().optional(),
      diamondRate: z3.string().optional(),
      diamondPrice: z3.string().optional(),
      stoneType: z3.string().optional(),
      stoneWeight: z3.string().optional(),
      stoneRate: z3.string().optional(),
      stonePrice: z3.string().optional(),
      images: z3.string().optional(),
      primaryImage: z3.string().optional(),
      basePrice: z3.string().optional(),
      totalPrice: z3.string().optional()
    })).mutation(async ({ input, ctx }) => {
      return await createProduct({
        ...input,
        createdBy: ctx.user.id
      });
    }),
    update: adminProcedure.input(z3.object({
      id: z3.number(),
      name: z3.string().min(1).optional(),
      description: z3.string().optional(),
      sku: z3.string().optional(),
      categoryId: z3.number().nullable().optional(),
      goldKarat: z3.enum(["22k", "24k"]).nullable().optional(),
      goldWeight: z3.string().optional(),
      goldWastage: z3.string().optional(),
      goldRateAtOrder: z3.string().optional(),
      makingCharges: z3.string().optional(),
      makingChargesType: z3.enum(["fixed", "per_gram"]).optional(),
      diamondWeight: z3.string().optional(),
      diamondRate: z3.string().optional(),
      diamondPrice: z3.string().optional(),
      stoneType: z3.string().optional(),
      stoneWeight: z3.string().optional(),
      stoneRate: z3.string().optional(),
      stonePrice: z3.string().optional(),
      images: z3.string().optional(),
      primaryImage: z3.string().optional(),
      basePrice: z3.string().optional(),
      totalPrice: z3.string().optional(),
      isActive: z3.boolean().optional()
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await updateProduct(id, data);
    }),
    delete: adminProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await deleteProduct(input.id);
      return { success: true };
    })
  }),
  // Customers
  customers: router({
    list: operationsFinanceProcedure.input(z3.object({
      search: z3.string().optional(),
      paymentStatus: z3.enum(["paid", "unpaid"]).optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCustomers(input);
    }),
    getById: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      return await getCustomerById(input.id);
    }),
    create: operationsFinanceProcedure.input(z3.object({
      firstName: z3.string().min(1),
      lastName: z3.string().optional(),
      email: z3.string().email().optional().or(z3.literal("")),
      phone: z3.string().optional(),
      address: z3.string().optional(),
      city: z3.string().optional(),
      state: z3.string().optional(),
      country: z3.string().optional(),
      paymentStatus: z3.enum(["paid", "unpaid"]).optional(),
      notes: z3.string().optional()
    })).mutation(async ({ input, ctx }) => {
      const customer = await createCustomer({
        ...input,
        email: input.email || null,
        createdBy: ctx.user.id
      });
      await ensureCustomerLedger(customer.id, ctx.user.id);
      return customer;
    }),
    update: operationsFinanceProcedure.input(z3.object({
      id: z3.number(),
      firstName: z3.string().min(1).optional(),
      lastName: z3.string().optional(),
      email: z3.string().email().optional().or(z3.literal("")),
      phone: z3.string().optional(),
      address: z3.string().optional(),
      city: z3.string().optional(),
      state: z3.string().optional(),
      country: z3.string().optional(),
      paymentStatus: z3.enum(["paid", "unpaid"]).optional(),
      notes: z3.string().optional()
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updated = await updateCustomer(id, {
        ...data,
        ...data.email !== void 0 ? { email: data.email || null } : {}
      });
      if (data.firstName !== void 0 || data.lastName !== void 0) {
        await syncCustomerLedgerTitle(id);
      }
      return updated;
    }),
    delete: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input, ctx }) => {
      await guard(async () => {
        await assertCustomerLedgerDeletable(input.id);
        await deleteCustomer(input.id);
        await removeCustomerLedger(input.id, ctx.user.id);
      });
      return { success: true };
    })
  }),
  // Catalogs
  catalogs: router({
    list: adminProcedure.input(z3.object({
      search: z3.string().optional(),
      status: z3.string().optional(),
      customerId: z3.number().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCatalogs(input);
    }),
    getById: adminProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      const catalog = await getCatalogById(input.id);
      if (!catalog) return null;
      const products2 = await getCatalogProducts(input.id);
      const comments = await getCatalogComments(input.id);
      const likes = await getCatalogLikes(input.id);
      return { ...catalog, products: products2, comments, likes };
    }),
    getByToken: publicProcedure.input(z3.object({ token: z3.string() })).query(async ({ input }) => {
      const catalog = await getCatalogByToken(input.token);
      if (!catalog) return null;
      const products2 = await getCatalogProducts(catalog.catalog.id);
      const likes = await getCatalogLikes(catalog.catalog.id);
      return { ...catalog, products: products2, likes };
    }),
    create: adminProcedure.input(z3.object({
      name: z3.string().min(1),
      description: z3.string().optional(),
      coverImage: z3.string().optional(),
      productType: z3.string().optional(),
      customFields: z3.string().optional(),
      customerId: z3.number().nullable().optional(),
      isPublic: z3.boolean().optional(),
      status: z3.enum(["draft", "published", "archived"]).optional(),
      productIds: z3.array(z3.number()).optional()
    })).mutation(async ({ input, ctx }) => {
      const { productIds, ...catalogData } = input;
      const publicToken = nanoid2(16);
      const catalog = await createCatalog({
        ...catalogData,
        publicToken,
        createdBy: ctx.user.id
      });
      if (productIds && productIds.length > 0) {
        await addProductsToCatalog(catalog.id, productIds);
      }
      return catalog;
    }),
    update: adminProcedure.input(z3.object({
      id: z3.number(),
      name: z3.string().min(1).optional(),
      description: z3.string().optional(),
      coverImage: z3.string().optional(),
      productType: z3.string().optional(),
      customFields: z3.string().optional(),
      customerId: z3.number().nullable().optional(),
      isPublic: z3.boolean().optional(),
      status: z3.enum(["draft", "published", "archived"]).optional(),
      productIds: z3.array(z3.number()).optional()
    })).mutation(async ({ input }) => {
      const { id, productIds, ...data } = input;
      const catalog = await updateCatalog(id, data);
      if (productIds !== void 0) {
        await updateCatalogProducts(id, productIds);
      }
      return catalog;
    }),
    delete: adminProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await deleteCatalog(input.id);
      return { success: true };
    }),
    // Public actions for catalog preview
    like: publicProcedure.input(z3.object({
      catalogId: z3.number(),
      productId: z3.number(),
      visitorId: z3.string()
    })).mutation(async ({ input }) => {
      return await addCatalogLike(input);
    }),
    comment: publicProcedure.input(z3.object({
      catalogId: z3.number(),
      productId: z3.number().optional(),
      visitorName: z3.string().optional(),
      comment: z3.string().min(1)
    })).mutation(async ({ input }) => {
      return await addCatalogComment(input);
    }),
    getComments: adminProcedure.input(z3.object({ catalogId: z3.number() })).query(async ({ input }) => {
      return await getCatalogComments(input.catalogId);
    }),
    markCommentRead: adminProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await markCommentAsRead(input.id);
      return { success: true };
    })
  }),
  // Collections
  collections: router({
    list: adminProcedure.input(z3.object({
      search: z3.string().optional(),
      isActive: z3.boolean().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCollections(input);
    }),
    getById: adminProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      const collection = await getCollectionById(input.id);
      if (!collection) return null;
      const products2 = await getCollectionProducts(input.id);
      return { ...collection, products: products2 };
    }),
    create: adminProcedure.input(z3.object({
      name: z3.string().min(1),
      description: z3.string().optional(),
      coverImage: z3.string().optional(),
      productIds: z3.array(z3.number()).optional()
    })).mutation(async ({ input, ctx }) => {
      const { productIds, ...collectionData } = input;
      const collection = await createCollection({
        ...collectionData,
        createdBy: ctx.user.id
      });
      if (productIds && productIds.length > 0) {
        await addProductsToCollection(collection.id, productIds);
      }
      return collection;
    }),
    update: adminProcedure.input(z3.object({
      id: z3.number(),
      name: z3.string().min(1).optional(),
      description: z3.string().optional(),
      coverImage: z3.string().optional(),
      isActive: z3.boolean().optional(),
      productIds: z3.array(z3.number()).optional()
    })).mutation(async ({ input }) => {
      const { id, productIds, ...data } = input;
      const collection = await updateCollection(id, data);
      if (productIds !== void 0) {
        const existing = await getCollectionProducts(id);
        for (const p of existing) {
          await removeProductFromCollection(id, p.collectionProduct.productId);
        }
        if (productIds.length > 0) {
          await addProductsToCollection(id, productIds);
        }
      }
      return collection;
    }),
    delete: adminProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await deleteCollection(input.id);
      return { success: true };
    }),
    addProducts: adminProcedure.input(z3.object({
      collectionId: z3.number(),
      productIds: z3.array(z3.number())
    })).mutation(async ({ input }) => {
      await addProductsToCollection(input.collectionId, input.productIds);
      return { success: true };
    }),
    removeProduct: adminProcedure.input(z3.object({
      collectionId: z3.number(),
      productId: z3.number()
    })).mutation(async ({ input }) => {
      await removeProductFromCollection(input.collectionId, input.productId);
      return { success: true };
    })
  }),
  // Orders
  orders: router({
    list: operationsFinanceProcedure.input(z3.object({
      status: z3.string().optional(),
      customerId: z3.number().optional(),
      month: z3.number().optional(),
      year: z3.number().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllOrders(input);
    }),
    getById: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      const order = await getOrderById(input.id);
      if (!order) return null;
      const items = await getOrderItems(input.id);
      return { ...order, items };
    }),
    create: operationsFinanceProcedure.input(z3.object({
      catalogId: z3.number().optional(),
      customerId: z3.number().optional(),
      totalItems: z3.number().optional(),
      totalWeight: z3.string().optional(),
      totalPrice: z3.string().optional(),
      status: z3.enum(["saved", "pending", "production", "completed", "delivered", "cancelled"]).optional(),
      description: z3.string().optional(),
      comments: z3.string().optional(),
      advanceCash: z3.string().optional(),
      orderDate: z3.string().optional(),
      expectedDelivery: z3.string().optional(),
      notes: z3.string().optional(),
      items: z3.array(z3.object({
        productId: z3.number().optional(),
        vendorId: z3.number().optional(),
        itemName: z3.string(),
        quantity: z3.number(),
        unitPrice: z3.string().optional(),
        totalPrice: z3.string().optional(),
        estimatedMetalType: z3.string().optional(),
        estimatedMetalWeight: z3.string().optional(),
        estimatedMetalWastage: z3.string().optional(),
        estimatedMetalRate: z3.string().optional(),
        estimatedMetalValue: z3.string().optional(),
        estimatedGemType: z3.string().optional(),
        estimatedGemQty: z3.number().optional(),
        estimatedGemWeight: z3.string().optional(),
        estimatedGemRate: z3.string().optional(),
        estimatedGemCalcBy: z3.string().optional(),
        estimatedGemValue: z3.string().optional(),
        estimatedLabourCharges: z3.string().optional(),
        bodyMakingRateType: z3.string().optional(),
        stoneSettingRateType: z3.string().optional(),
        comments: z3.string().optional()
      })).optional(),
      advanceMetals: z3.array(z3.object({
        itemName: z3.string().optional(),
        receivedDate: z3.string().optional(),
        weight: z3.string().optional(),
        alloy: z3.string().optional(),
        netWeightRate: z3.string().optional(),
        value: z3.string().optional(),
        comments: z3.string().optional()
      })).optional(),
      advanceGems: z3.array(z3.object({
        itemName: z3.string().optional(),
        qty: z3.number().optional(),
        weight: z3.string().optional(),
        comments: z3.string().optional()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const { items, expectedDelivery, orderDate, advanceMetals, advanceGems, ...orderData } = input;
      const orderDateValue = orderDate ? new Date(orderDate) : /* @__PURE__ */ new Date();
      const hasPostableAdvance = Number(orderData.advanceCash || 0) > 0 || (advanceMetals ?? []).some((metal) => Number(metal.value || 0) > 0);
      if (orderData.customerId) {
        const customer = await getCustomerById(orderData.customerId);
        if (!customer) throw new TRPCError4({ code: "BAD_REQUEST", message: "Selected customer does not exist" });
      } else if (hasPostableAdvance) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Select a customer before recording cash or valued metal advances" });
      }
      for (const vendorId of Array.from(new Set((items ?? []).map((item) => item.vendorId).filter(Boolean)))) {
        const vendor = await getVendorById(vendorId);
        if (!vendor) throw new TRPCError4({ code: "BAD_REQUEST", message: `Vendor #${vendorId} does not exist` });
      }
      if (orderData.customerId && hasPostableAdvance) {
        const codes = [
          ...Number(orderData.advanceCash || 0) > 0 ? ["CA000001"] : [],
          ...(advanceMetals ?? []).some((metal) => Number(metal.value || 0) > 0) ? ["ST000001"] : []
        ];
        await guard(() => ensurePostingReady(orderData.customerId, ctx.user.id, codes));
      }
      const orderNumber = await generateOrderNumber();
      const order = await createOrder({
        ...orderData,
        orderNumber,
        orderDate: orderDateValue,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
        createdBy: ctx.user.id
      });
      if (items && items.length > 0) {
        const createdItems = await addOrderItems(order.id, items);
        for (const item of createdItems) {
          if (item.vendorId) {
            await createOrderProcess({
              orderId: order.id,
              orderItemId: item.id,
              itemName: item.itemName,
              processType: "Body Making",
              vendorId: item.vendorId,
              startDate: orderDateValue,
              expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : null,
              status: "pending",
              comments: "Vendor assigned from Sales Order"
            });
          }
        }
      }
      if (advanceMetals?.length) {
        for (const metal of advanceMetals) {
          const created = await addOrderAdvanceMetal({
            ...metal,
            orderId: order.id,
            receivedDate: metal.receivedDate ? new Date(metal.receivedDate) : null
          });
          if (order.customerId && Number(metal.value || 0) > 0) {
            await postOrderMetalAdvance({
              advanceId: created.id,
              customerId: order.customerId,
              value: metal.value || "0",
              entryDate: metal.receivedDate ? new Date(metal.receivedDate) : orderDateValue,
              description: `${metal.itemName || "Metal"} advance for ${order.orderNumber}`,
              userId: ctx.user.id
            });
          }
        }
      }
      if (advanceGems?.length) {
        for (const gem of advanceGems) {
          await addOrderAdvanceGem({ ...gem, orderId: order.id });
        }
      }
      if (order.customerId && Number(order.advanceCash || 0) > 0) {
        await postOrderCashAdvance({
          orderId: order.id,
          customerId: order.customerId,
          amount: order.advanceCash || "0",
          entryDate: orderDateValue,
          userId: ctx.user.id
        });
      }
      return order;
    }),
    update: operationsFinanceProcedure.input(z3.object({
      id: z3.number(),
      status: z3.enum(["saved", "pending", "production", "completed", "delivered", "cancelled"]).optional(),
      expectedDelivery: z3.string().optional(),
      notes: z3.string().optional(),
      description: z3.string().optional(),
      comments: z3.string().optional(),
      advanceCash: z3.string().optional(),
      totalItems: z3.number().optional(),
      totalWeight: z3.string().optional(),
      totalPrice: z3.string().optional(),
      customerId: z3.number().optional()
    })).mutation(async ({ input, ctx }) => {
      const { id, expectedDelivery, ...data } = input;
      const existing = await getOrderById(id);
      if (!existing) throw new TRPCError4({ code: "NOT_FOUND", message: "Order not found" });
      const current = existing.order;
      const hasCashPosting = await hasActivePosting("order_cash_advance", id);
      if (data.customerId !== void 0 && data.customerId !== current.customerId) {
        const customer = await getCustomerById(data.customerId);
        if (!customer) throw new TRPCError4({ code: "BAD_REQUEST", message: "Selected customer does not exist" });
        const invoices = await getOrderInvoices(id);
        const metalPostings = await Promise.all(
          (await getOrderAdvanceMetals(id)).map((metal) => hasActivePosting("order_metal_advance", metal.id))
        );
        if (hasCashPosting || invoices.length > 0 || metalPostings.some(Boolean)) {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Customer cannot be changed after advances or invoices have been posted" });
        }
      }
      if (data.advanceCash !== void 0 && hasCashPosting) {
        const posted = await getSourceEntry("order_cash_advance", id);
        if (posted && Number(posted.totalDebit) !== Number(data.advanceCash || 0)) {
          throw new TRPCError4({
            code: "BAD_REQUEST",
            message: "The cash advance is already posted to the ledger. Record extra receipts with a Cash Receipt voucher, or reverse the posting first."
          });
        }
      }
      const updateData = { ...data };
      if (expectedDelivery) {
        updateData.expectedDelivery = new Date(expectedDelivery);
      }
      if (data.status === "completed") {
        updateData.completedDate = /* @__PURE__ */ new Date();
      }
      const updated = await updateOrder(id, updateData);
      const customerId = data.customerId ?? current.customerId;
      const advanceCash = data.advanceCash ?? current.advanceCash;
      if (!hasCashPosting && customerId && Number(advanceCash || 0) > 0) {
        await postOrderCashAdvance({
          orderId: id,
          customerId,
          amount: String(advanceCash),
          entryDate: current.orderDate ?? /* @__PURE__ */ new Date(),
          userId: ctx.user.id
        });
      }
      return updated;
    }),
    delete: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      const metals = await getOrderAdvanceMetals(input.id);
      const postings = await Promise.all([
        hasActivePosting("order_cash_advance", input.id),
        ...metals.map((metal) => hasActivePosting("order_metal_advance", metal.id))
      ]);
      if (postings.some(Boolean)) {
        throw new TRPCError4({
          code: "BAD_REQUEST",
          message: "This order has posted advances. Reverse the ledger entries before deleting, or cancel the order instead."
        });
      }
      await guard(() => deleteOrder(input.id));
      return { success: true };
    })
  }),
  // File Upload
  upload: router({
    image: adminProcedure.input(z3.object({
      base64: z3.string(),
      filename: z3.string(),
      contentType: z3.string()
    })).mutation(async ({ input }) => {
      const base64Data = input.base64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const ext = input.filename.split(".").pop() || "jpg";
      const uniqueFilename = `catalog-covers/${Date.now()}-${nanoid2(8)}.${ext}`;
      const { url } = await storagePut(uniqueFilename, buffer, input.contentType);
      return { url };
    })
  }),
  // Vendors
  vendors: router({
    list: operationsFinanceProcedure.input(z3.object({ search: z3.string().optional(), isActive: z3.boolean().optional() }).optional()).query(async ({ input }) => {
      return await getAllVendors(input || void 0);
    }),
    getById: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      return await getVendorById(input.id);
    }),
    create: operationsFinanceProcedure.input(z3.object({
      name: z3.string().min(1),
      phone: z3.string().optional(),
      email: z3.string().optional(),
      address: z3.string().optional(),
      city: z3.string().optional(),
      specialization: z3.string().optional(),
      notes: z3.string().optional()
    })).mutation(async ({ input, ctx }) => {
      const vendor = await createVendor({ ...input, createdBy: ctx.user.id });
      await ensureVendorLedger(vendor.id, ctx.user.id);
      return vendor;
    }),
    update: operationsFinanceProcedure.input(z3.object({
      id: z3.number(),
      name: z3.string().min(1).optional(),
      phone: z3.string().optional(),
      email: z3.string().optional(),
      address: z3.string().optional(),
      city: z3.string().optional(),
      specialization: z3.string().optional(),
      notes: z3.string().optional(),
      isActive: z3.boolean().optional()
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const vendor = await updateVendor(id, data);
      if (!vendor) throw new TRPCError4({ code: "NOT_FOUND", message: "Vendor not found" });
      await ensureVendorLedger(id, ctx.user.id);
      await syncVendorLedger(id);
      return vendor;
    }),
    // Vendors are deactivated (never hard-deleted) because orders, production and ledgers reference them.
    delete: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input, ctx }) => {
      await deleteVendor(input.id);
      await deactivateVendorLedger(input.id, ctx.user.id);
      return { success: true };
    })
  }),
  // Order Processes
  orderProcesses: router({
    list: operationsFinanceProcedure.input(z3.object({ orderId: z3.number() })).query(async ({ input }) => {
      return await getOrderProcesses(input.orderId);
    }),
    getById: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      return await getProcessById(input.id);
    }),
    create: operationsFinanceProcedure.input(z3.object({
      orderId: z3.number(),
      orderItemId: z3.number().optional(),
      itemName: z3.string().optional(),
      processType: z3.string(),
      vendorId: z3.number().optional(),
      startDate: z3.string().optional(),
      expectedDeliveryDate: z3.string().optional(),
      comments: z3.string().optional()
    })).mutation(async ({ input }) => {
      const order = await getOrderById(input.orderId);
      if (!order) throw new TRPCError4({ code: "BAD_REQUEST", message: "Order not found" });
      if (input.vendorId && !await getVendorById(input.vendorId)) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Vendor not found" });
      }
      const data = { ...input };
      if (input.startDate) data.startDate = new Date(input.startDate);
      if (input.expectedDeliveryDate) data.expectedDeliveryDate = new Date(input.expectedDeliveryDate);
      data.status = "pending";
      return await createOrderProcess(data);
    }),
    update: operationsFinanceProcedure.input(z3.object({
      id: z3.number(),
      vendorId: z3.number().optional(),
      startDate: z3.string().optional(),
      expectedDeliveryDate: z3.string().optional(),
      actualDeliveryDate: z3.string().optional(),
      status: z3.enum(["pending", "in_progress", "complete"]).optional(),
      issueBodyWeight: z3.string().optional(),
      returnBodyMetal: z3.string().optional(),
      returnBodyWeight: z3.string().optional(),
      returnBodyPieces: z3.number().optional(),
      gemsIssueType: z3.string().optional(),
      gemsIssueSource: z3.string().optional(),
      gemsIssueDate: z3.string().optional(),
      gemsIssueWeight: z3.string().optional(),
      gemsIssueQty: z3.number().optional(),
      gemsReturnWeight: z3.string().optional(),
      gemsReturnQty: z3.number().optional(),
      gemsReturnDate: z3.string().optional(),
      lumpSumLabour: z3.string().optional(),
      comments: z3.string().optional(),
      isClosed: z3.boolean().optional(),
      closedDate: z3.string().optional()
    })).mutation(async ({ input }) => {
      const { id, ...rest } = input;
      const data = { ...rest };
      if (rest.startDate) data.startDate = new Date(rest.startDate);
      if (rest.expectedDeliveryDate) data.expectedDeliveryDate = new Date(rest.expectedDeliveryDate);
      if (rest.actualDeliveryDate) data.actualDeliveryDate = new Date(rest.actualDeliveryDate);
      if (rest.gemsIssueDate) data.gemsIssueDate = new Date(rest.gemsIssueDate);
      if (rest.gemsReturnDate) data.gemsReturnDate = new Date(rest.gemsReturnDate);
      if (rest.closedDate) data.closedDate = new Date(rest.closedDate);
      return await updateOrderProcess(id, data);
    }),
    delete: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await deleteOrderProcess(input.id);
      return { success: true };
    })
  }),
  // Order Advance Materials
  orderAdvances: router({
    getMetals: operationsFinanceProcedure.input(z3.object({ orderId: z3.number() })).query(async ({ input }) => {
      return await getOrderAdvanceMetals(input.orderId);
    }),
    addMetal: operationsFinanceProcedure.input(z3.object({
      orderId: z3.number(),
      itemName: z3.string().optional(),
      receivedDate: z3.string().optional(),
      weight: z3.string().optional(),
      alloy: z3.string().optional(),
      netWeightRate: z3.string().optional(),
      value: z3.string().optional(),
      comments: z3.string().optional()
    })).mutation(async ({ input, ctx }) => {
      const existing = await getOrderById(input.orderId);
      if (!existing) throw new TRPCError4({ code: "BAD_REQUEST", message: "Order not found" });
      const customerId = existing.order.customerId;
      if (Number(input.value || 0) > 0 && !customerId) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Assign a customer to the order before recording a valued metal advance" });
      }
      const data = { ...input };
      if (input.receivedDate) data.receivedDate = new Date(input.receivedDate);
      const created = await addOrderAdvanceMetal(data);
      if (customerId && Number(input.value || 0) > 0) {
        await postOrderMetalAdvance({
          advanceId: created.id,
          customerId,
          value: input.value || "0",
          entryDate: input.receivedDate ? new Date(input.receivedDate) : /* @__PURE__ */ new Date(),
          description: `${input.itemName || "Metal"} advance for ${existing.order.orderNumber}`,
          userId: ctx.user.id
        });
      }
      return created;
    }),
    deleteMetal: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      if (await hasActivePosting("order_metal_advance", input.id)) {
        throw new TRPCError4({
          code: "BAD_REQUEST",
          message: "This metal advance is posted to the ledger. Reverse its journal entry before deleting it."
        });
      }
      await deleteOrderAdvanceMetal(input.id);
      return { success: true };
    }),
    getGems: operationsFinanceProcedure.input(z3.object({ orderId: z3.number() })).query(async ({ input }) => {
      return await getOrderAdvanceGems(input.orderId);
    }),
    addGem: operationsFinanceProcedure.input(z3.object({
      orderId: z3.number(),
      itemName: z3.string().optional(),
      qty: z3.number().optional(),
      weight: z3.string().optional(),
      comments: z3.string().optional()
    })).mutation(async ({ input }) => {
      return await addOrderAdvanceGem(input);
    }),
    deleteGem: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ input }) => {
      await deleteOrderAdvanceGem(input.id);
      return { success: true };
    })
  }),
  // Order Invoices
  invoices: router({
    list: operationsFinanceProcedure.query(async () => {
      return await getAllInvoices();
    }),
    listByOrder: operationsFinanceProcedure.input(z3.object({ orderId: z3.number() })).query(async ({ input }) => {
      return await getOrderInvoices(input.orderId);
    }),
    getById: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      const invoice = await getInvoiceById(input.id);
      if (!invoice) return null;
      const items = await getInvoiceItems(input.id);
      return { ...invoice, items };
    }),
    create: operationsFinanceProcedure.input(z3.object({
      orderId: z3.number(),
      customerId: z3.number().optional(),
      remarks: z3.string().optional(),
      invoiceDate: z3.string().optional(),
      metalValue: z3.string().optional(),
      stoneValue: z3.string().optional(),
      makingCharges: z3.string().optional(),
      otherCharges: z3.string().optional(),
      discount: z3.string().optional(),
      totalAmount: z3.string().optional(),
      items: z3.array(z3.object({
        itemName: z3.string(),
        particular: z3.string().optional(),
        qty: z3.number().optional(),
        weight: z3.string().optional(),
        weightUnit: z3.string().optional(),
        wastage: z3.string().optional(),
        netWeight: z3.string().optional(),
        rate: z3.string().optional(),
        calculateBy: z3.string().optional(),
        amount: z3.string().optional(),
        sortOrder: z3.number().optional()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const { items, ...invoiceData } = input;
      const existing = await getOrderById(input.orderId);
      if (!existing) throw new TRPCError4({ code: "BAD_REQUEST", message: "Order not found" });
      const customerId = input.customerId ?? existing.order.customerId ?? void 0;
      if (input.customerId && existing.order.customerId && input.customerId !== existing.order.customerId) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Invoice customer must match the Sales Order customer" });
      }
      const orderItems2 = await getOrderItemsRaw(input.orderId);
      const sum = (pick) => orderItems2.reduce((total, item) => total + moneyToCents(pick(item)), 0);
      const metalCents = input.metalValue !== void 0 ? moneyToCents(input.metalValue) : sum((item) => item.estimatedMetalValue);
      const stoneCents = input.stoneValue !== void 0 ? moneyToCents(input.stoneValue) : sum((item) => item.estimatedGemValue);
      const makingCents = input.makingCharges !== void 0 ? moneyToCents(input.makingCharges) : sum((item) => item.estimatedLabourCharges);
      const otherCents = moneyToCents(input.otherCharges);
      const discountCents = moneyToCents(input.discount);
      if ([metalCents, stoneCents, makingCents, otherCents, discountCents].some((value) => value < 0)) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Invoice amounts cannot be negative" });
      }
      const totalCents = metalCents + stoneCents + makingCents + otherCents - discountCents;
      if (totalCents < 0) throw new TRPCError4({ code: "BAD_REQUEST", message: "Discount cannot exceed the invoice value" });
      if (totalCents > 0 && !customerId) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "Assign a customer to the Sales Order before invoicing" });
      }
      if (totalCents > 0) {
        await guard(() => ensurePostingReady(customerId, ctx.user.id, ["SA000001"]));
      }
      const invoiceNumber = await generateInvoiceNumber();
      const invoice = await createInvoice({
        ...invoiceData,
        customerId,
        invoiceNumber,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : /* @__PURE__ */ new Date(),
        metalValue: centsToMoney(metalCents),
        stoneValue: centsToMoney(stoneCents),
        makingCharges: centsToMoney(makingCents),
        otherCharges: centsToMoney(otherCents),
        discount: centsToMoney(discountCents),
        totalAmount: centsToMoney(totalCents),
        status: totalCents > 0 ? "sent" : "draft",
        createdBy: ctx.user.id
      });
      if (items && items.length > 0) {
        await addInvoiceItems(invoice.id, items);
      }
      if (totalCents > 0) {
        await postInvoiceToLedger(invoice.id, ctx.user.id);
      }
      return await getInvoiceById(invoice.id) ?? invoice;
    }),
    update: operationsFinanceProcedure.input(z3.object({
      id: z3.number(),
      remarks: z3.string().optional(),
      metalValue: z3.string().optional(),
      stoneValue: z3.string().optional(),
      makingCharges: z3.string().optional(),
      otherCharges: z3.string().optional(),
      discount: z3.string().optional(),
      totalAmount: z3.string().optional(),
      status: z3.enum(["draft", "sent", "paid", "cancelled"]).optional(),
      items: z3.array(z3.object({
        itemName: z3.string(),
        particular: z3.string().optional(),
        qty: z3.number().optional(),
        weight: z3.string().optional(),
        weightUnit: z3.string().optional(),
        wastage: z3.string().optional(),
        netWeight: z3.string().optional(),
        rate: z3.string().optional(),
        calculateBy: z3.string().optional(),
        amount: z3.string().optional(),
        sortOrder: z3.number().optional()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const { id, items, status, ...amountsAndRemarks } = input;
      const invoice = await getInvoiceById(id);
      if (!invoice) throw new TRPCError4({ code: "NOT_FOUND", message: "Invoice not found" });
      const posted = await getSourceEntry("order_invoice", id);
      const isLivePosting = posted?.status === "posted";
      const { remarks, totalAmount: _ignoredTotal, ...amounts } = amountsAndRemarks;
      const amountChanges = Object.entries(amounts).filter(
        ([key, value]) => value !== void 0 && moneyToCents(value) !== moneyToCents(invoice[key])
      );
      if (amountChanges.length && isLivePosting) {
        throw new TRPCError4({
          code: "BAD_REQUEST",
          message: "This invoice is posted to the ledger. Cancel it (which reverses the posting) and issue a new invoice to change amounts."
        });
      }
      if (invoice.status === "cancelled" && (amountChanges.length || status && status !== "cancelled")) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "A cancelled invoice cannot be changed or reopened. Issue a new invoice instead." });
      }
      if (status === "draft" && isLivePosting) {
        throw new TRPCError4({ code: "BAD_REQUEST", message: "A posted invoice cannot go back to draft. Cancel it instead." });
      }
      if (status === "cancelled" && invoice.status !== "cancelled" && isLivePosting && ctx.user.role !== "admin") {
        throw new TRPCError4({ code: "FORBIDDEN", message: "Only a Super Admin can cancel a posted invoice, because it reverses the ledger entry." });
      }
      const update = { remarks, status };
      if (amountChanges.length) {
        const next = { ...invoice, ...Object.fromEntries(amountChanges) };
        const cents = (key) => moneyToCents(next[key]);
        const totalCents = cents("metalValue") + cents("stoneValue") + cents("makingCharges") + cents("otherCharges") - cents("discount");
        if (totalCents < 0) throw new TRPCError4({ code: "BAD_REQUEST", message: "Discount cannot exceed the invoice value" });
        Object.assign(update, Object.fromEntries(amountChanges), { totalAmount: centsToMoney(totalCents) });
      }
      const statusForPosting = status && status !== "cancelled" && status !== "draft" && !isLivePosting;
      const { status: _deferredStatus, ...fieldsFirst } = update;
      await updateInvoice(id, statusForPosting ? fieldsFirst : update);
      if (items) {
        await deleteInvoiceItems(id);
        await addInvoiceItems(id, items);
      }
      if (status === "cancelled" && invoice.status !== "cancelled" && isLivePosting && posted) {
        await reverseJournalEntry(posted.id, `Invoice ${invoice.invoiceNumber || id} cancelled`, ctx.user.id);
      } else if (statusForPosting) {
        const refreshed = await getInvoiceById(id);
        if (refreshed && Number(refreshed.totalAmount || 0) > 0) {
          await guard(() => postInvoiceToLedger(id, ctx.user.id));
        }
        await updateInvoice(id, { status });
      }
      return await getInvoiceById(id);
    })
  }),
  // Enhanced Order Detail
  orderDetail: router({
    get: operationsFinanceProcedure.input(z3.object({ id: z3.number() })).query(async ({ input }) => {
      return await getOrderWithDetails(input.id);
    }),
    getItems: operationsFinanceProcedure.input(z3.object({ orderId: z3.number() })).query(async ({ input }) => {
      return await getOrderItemsRaw(input.orderId);
    })
  }),
  // JulesBot AI Agent
  julesBot: router({
    // Get greeting with gold news, trends, and weather
    getGreeting: adminProcedure.query(async ({ ctx }) => {
      const goldPrice = await getLatestGoldPrice();
      const stats = await getDashboardStats();
      const systemPrompt = `You are JulesBot, an AI assistant for JULES - a jewelry catalog management platform in Pakistan. 
You help jewelry business owners manage their products, catalogs, and customers.

Current context:
- Today's 22K Gold Price: PKR ${goldPrice?.price22k || "Not set"} per tola
- Today's 24K Gold Price: PKR ${goldPrice?.price24k || "Not set"} per tola
- Total Products: ${stats.products}
- Total Customers: ${stats.customers}
- Total Catalogs: ${stats.catalogs}
- Orders This Month: ${stats.currentMonthOrders}
- In Production: ${stats.productionOrders}

Generate a friendly greeting for the user that includes:
1. A warm welcome message
2. Brief insight about gold market trends in Pakistan (mention if prices are high/stable/volatile)
3. Current weather context for Karachi, Pakistan (assume typical weather for the season)
4. A quick summary of their business status
5. One helpful tip or suggestion for the day

Keep the response concise, professional, and encouraging. Format it nicely with line breaks.`;
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Generate a greeting for ${ctx.user.name || "the user"} who is logging in now.` }
          ]
        });
        const greeting = response.choices[0]?.message?.content || "Welcome to JULES!";
        return {
          greeting: typeof greeting === "string" ? greeting : JSON.stringify(greeting),
          goldPrice,
          stats,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      } catch (error) {
        console.error("JulesBot greeting error:", error);
        return {
          greeting: `Welcome back, ${ctx.user.name || "there"}! \u{1F44B}

Today's Gold Prices:
\u2022 22K: PKR ${goldPrice?.price22k || "Not set"}/tola
\u2022 24K: PKR ${goldPrice?.price24k || "Not set"}/tola

Your business at a glance:
\u2022 ${stats.products} products
\u2022 ${stats.customers} customers
\u2022 ${stats.currentMonthOrders} orders this month

Have a productive day!`,
          goldPrice,
          stats,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }),
    // Chat with JulesBot
    chat: adminProcedure.input(z3.object({
      message: z3.string().min(1),
      conversationHistory: z3.array(z3.object({
        role: z3.enum(["user", "assistant"]),
        content: z3.string()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const goldPrice = await getLatestGoldPrice();
      const stats = await getDashboardStats();
      const products2 = await getAllProducts();
      const customers2 = await getAllCustomers();
      const catalogs2 = await getAllCatalogs();
      const collections2 = await getAllCollections();
      const productList = products2.map((p) => `- ID:${p.product.id} "${p.product.name}" (Category: ${p.category?.name || "N/A"}, Karat: ${p.product.goldKarat || "N/A"}, SKU: ${p.product.sku || "N/A"}, Price: PKR ${p.product.basePrice || "N/A"})`).join("\n");
      const customerList = customers2.map((c) => `- ID:${c.id} "${c.firstName} ${c.lastName || ""}" (Email: ${c.email || "N/A"}, Phone: ${c.phone || "N/A"}, City: ${c.city || "N/A"})`).join("\n");
      const catalogList = catalogs2.map((c) => `- ${c.catalog.name} (ID: ${c.catalog.id}, Status: ${c.catalog.status}, Token: ${c.catalog.publicToken})`).join("\n");
      const collectionList = collections2.map((c) => `- ${c.name} (ID: ${c.id}, ${c.productCount || 0} products)`).join("\n");
      const systemPrompt = `You are JulesBot, an intelligent AI assistant for JULES - a jewelry catalog management platform.
You can help with:
1. Answering questions about products, collections, catalogs, and customers
2. Creating new catalogs automatically when requested
3. Providing business insights and suggestions
4. Helping with jewelry-related queries

Current Business Data:

**Gold Prices:**
- 22K: PKR ${goldPrice?.price22k || "Not set"} per tola
- 24K: PKR ${goldPrice?.price24k || "Not set"} per tola

**Statistics:**
- Total Products: ${stats.products}
- Total Customers: ${stats.customers}
- Total Catalogs: ${stats.catalogs}
- Orders This Month: ${stats.currentMonthOrders}

**Products:**
${productList || "No products yet"}

**Customers:**
${customerList || "No customers yet"}

**Catalogs:**
${catalogList || "No catalogs yet"}

**Collections:**
${collectionList || "No collections yet"}

When the user asks to create a catalog:
1. If catalog name is provided, use it. Otherwise ask for one.
2. Look up product IDs from the Products list above based on what the user wants (by name, category like "Gold Sets", or collection)
3. Look up customer ID from the Customers list if they want to assign it
4. IMMEDIATELY respond with the command format - DO NOT ask for confirmation:
   CATALOG_CREATE:{catalogName}|{description}|{comma-separated product IDs}|{customer ID or empty}

Example: If user says "create catalog with gold sets for Ayesha Khan", find all products with "Gold" in category or name, find Ayesha Khan's ID, then respond:
CATALOG_CREATE:Gold Collection|Exclusive gold jewelry|21,22,23|2

IMPORTANT: Always include actual product IDs from the list above. Match products by category name or product name.

Be helpful, professional, and knowledgeable about jewelry business. Provide specific data when asked.`;
      const messages = [
        { role: "system", content: systemPrompt }
      ];
      if (input.conversationHistory) {
        messages.push(...input.conversationHistory);
      }
      messages.push({ role: "user", content: input.message });
      try {
        const response = await invokeLLM({ messages });
        const assistantMessage = response.choices[0]?.message?.content || "I apologize, I couldn't process that request.";
        const messageStr = typeof assistantMessage === "string" ? assistantMessage : JSON.stringify(assistantMessage);
        let catalogCreated = null;
        if (messageStr.includes("CATALOG_CREATE:")) {
          const match = messageStr.match(/CATALOG_CREATE:([^|]+)\|([^|]*)\|([^|]*)\|(.*)/);
          if (match) {
            const [, name, description, productIdsStr, customerIdStr] = match;
            const productIds = productIdsStr ? productIdsStr.split(",").map((id) => parseInt(id.trim())).filter((id) => !isNaN(id)) : [];
            const customerId = customerIdStr ? parseInt(customerIdStr.trim()) : null;
            const publicToken = nanoid2(12);
            const catalog = await createCatalog({
              name: name.trim(),
              description: description.trim() || null,
              publicToken,
              customerId: customerId && !isNaN(customerId) ? customerId : null,
              status: "published",
              isPublic: true
            });
            if (productIds.length > 0) {
              await updateCatalogProducts(catalog.id, productIds);
            }
            catalogCreated = {
              id: catalog.id,
              name: name.trim(),
              publicToken,
              previewUrl: `/preview/${publicToken}`
            };
          }
        }
        const cleanMessage = messageStr.replace(/CATALOG_CREATE:[^\n]+/g, "").trim();
        return {
          message: cleanMessage || "I've created the catalog for you!",
          catalogCreated,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      } catch (error) {
        console.error("JulesBot chat error:", error);
        const reason = String(error?.message || error).replace(/\s+/g, " ").slice(0, 300);
        return {
          message: `I apologize, I'm having trouble processing your request right now. Please try again.

(AI service error: ${reason})`,
          catalogCreated: null,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    })
  })
});

// server/_core/context.ts
import { parse as parseCookieHeader } from "cookie";
async function createContext(opts) {
  let user = null;
  try {
    const cookieHeader = opts.req.headers.cookie;
    const cookies = cookieHeader ? parseCookieHeader(cookieHeader) : {};
    const sessionToken = cookies[COOKIE_NAME];
    if (sessionToken) {
      const session = await verifySession(sessionToken);
      if (session) {
        user = await getUserById(session.userId);
      }
    }
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid as nanoid3 } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid3()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/migrations.ts
import { Schema as Schema3 } from "mongoose";
var MigrationSchema = new Schema3(
  {
    name: { type: String, required: true, unique: true },
    appliedAt: { type: Date, default: Date.now },
    details: { type: String }
  },
  { collection: "schema_migrations" }
);
var MigrationModel = ensureModel("SchemaMigration", MigrationSchema);
var MIGRATIONS = [
  {
    // Orders -> Production -> Invoice -> Finance release + role-based access.
    name: "2026-09-28-order-production-invoice-finance-roles",
    run: async () => {
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
        audit_logs: AuditLogModel
      };
      const indexErrors = [];
      for (const [name, model] of Object.entries(models)) {
        try {
          await model.createIndexes();
        } catch (error) {
          indexErrors.push(`${name}: ${error.message}`);
        }
      }
      if (indexErrors.length) {
        throw new Error(`Index creation failed (existing data conflicts?): ${indexErrors.join(" | ")}`);
      }
      const users2 = await UserModel.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });
      const orders2 = await OrderModel.updateMany({ advanceCash: { $exists: false } }, { $set: { advanceCash: 0 } });
      const unnamed = await OrderItemModel.find({ $or: [{ itemName: { $exists: false } }, { itemName: null }, { itemName: "" }] }).lean();
      let namedItems = 0;
      if (unnamed.length) {
        const products2 = await ProductModel.find({ id: { $in: unnamed.map((item) => item.productId).filter(Boolean) } }, { id: 1, name: 1 }).lean();
        const names = new Map(products2.map((product) => [product.id, product.name]));
        for (const item of unnamed) {
          await OrderItemModel.updateOne(
            { id: item.id },
            { $set: { itemName: (item.productId ? names.get(item.productId) : void 0) || "Item" } }
          );
          namedItems++;
        }
      }
      await ensureFinanceSetup();
      return {
        usersActivated: users2.modifiedCount,
        ordersDefaulted: orders2.modifiedCount,
        orderItemsNamed: namedItems
      };
    }
  }
];
async function runMigrations(log = console.log) {
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
        { $setOnInsert: { name: migration.name, appliedAt: /* @__PURE__ */ new Date(), details: JSON.stringify(details) } },
        { upsert: true }
      );
      log(`[migrations] applied ${migration.name} ${JSON.stringify(details)}`);
    } catch (error) {
      console.error(`[migrations] ${migration.name} failed and will be retried on next start:`, error);
      if (process.env.MIGRATIONS_STRICT === "true") throw error;
    }
  }
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  await connectDb();
  await ensureAdminUser();
  await runMigrations();
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  const serveClient = process.env.SERVE_CLIENT === "true";
  if (serveClient) {
    if (process.env.NODE_ENV === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch((error) => {
  console.error("[startup] failed to start server", error);
  process.exit(1);
});
