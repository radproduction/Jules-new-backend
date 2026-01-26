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
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
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

// server/routers.ts
import { z as z2 } from "zod";
import { nanoid } from "nanoid";

// server/db.ts
import mongoose, { Schema } from "mongoose";

// server/_core/auth.ts
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
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
    if (typeof userId !== "number" || typeof email !== "string" || role !== "admin" && role !== "user") {
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
var connected = false;
async function connectDb() {
  if (connected) return;
  if (!ENV.mongoUri) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }
  await mongoose.connect(ENV.mongoUri);
  connected = true;
}
var ensureModel = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
var CounterSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 }
  },
  { collection: "counters" }
);
var Counter = ensureModel("Counter", CounterSchema);
async function getNextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  ).lean();
  return counter?.value ?? 1;
}
var withTimestamps = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
};
var UserSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    lastSignedIn: { type: Date, default: Date.now }
  },
  { ...withTimestamps, collection: "users" }
);
var GoldPriceSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    priceDate: { type: Date, required: true },
    price22k: { type: Number, required: true },
    price24k: { type: Number, required: true },
    createdBy: { type: Number }
  },
  { ...withTimestamps, collection: "gold_prices" }
);
var CategorySchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    name: { type: String, required: true, unique: true },
    description: { type: String }
  },
  { ...withTimestamps, collection: "categories" }
);
var ProductSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 }
  },
  { ...withTimestamps, collection: "catalog_products" }
);
var CatalogLikeSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    visitorId: { type: String }
  },
  { ...withTimestamps, collection: "catalog_likes" }
);
var CatalogCommentSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
    orderNumber: { type: String, required: true, unique: true },
    catalogId: { type: Number },
    customerId: { type: Number },
    totalItems: { type: Number, default: 0 },
    totalWeight: { type: Number },
    totalPrice: { type: Number },
    status: {
      type: String,
      enum: ["pending", "production", "completed", "delivered", "cancelled"],
      default: "pending"
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
    id: { type: Number, unique: true, index: true },
    orderId: { type: Number, required: true },
    productId: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number },
    totalPrice: { type: Number }
  },
  { ...withTimestamps, collection: "order_items" }
);
var CollectionSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
    collectionId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 }
  },
  { ...withTimestamps, collection: "collection_products" }
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
async function ensureAdminUser() {
  await connectDb();
  if (!ENV.adminEmail || !ENV.adminPassword) {
    console.warn("[Auth] ADMIN_EMAIL or ADMIN_PASSWORD not configured; skipping admin seed");
    return;
  }
  const existing = await UserModel.findOne({ email: ENV.adminEmail }).lean();
  if (existing) return;
  const id = await getNextSequence("users");
  const passwordHash = await hashPassword(ENV.adminPassword);
  await UserModel.create({
    id,
    email: ENV.adminEmail,
    passwordHash,
    name: ENV.adminName || "Admin",
    role: "admin",
    lastSignedIn: /* @__PURE__ */ new Date()
  });
}
async function getUserById(id) {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role
  };
}
async function getUserByEmail(email) {
  await connectDb();
  return UserModel.findOne({ email }).lean();
}
async function updateUserLastSignedIn(id) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: { lastSignedIn: /* @__PURE__ */ new Date() } });
}
async function getTodayGoldPrice() {
  await connectDb();
  const start = /* @__PURE__ */ new Date();
  start.setHours(0, 0, 0, 0);
  const end = /* @__PURE__ */ new Date();
  end.setHours(23, 59, 59, 999);
  return GoldPriceModel.findOne({ priceDate: { $gte: start, $lte: end } }).sort({ priceDate: -1 }).lean();
}
async function getLatestGoldPrice() {
  await connectDb();
  return GoldPriceModel.findOne({}).sort({ priceDate: -1 }).lean();
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
    return { ...existing, ...payload };
  }
  const id = await getNextSequence("gold_prices");
  const created = await GoldPriceModel.create({
    id,
    priceDate: today,
    ...payload,
    createdBy: data.userId
  });
  return created.toObject();
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
  const products = await ProductModel.find(query).sort({ createdAt: -1 }).lean();
  const categoryIds = Array.from(new Set(products.map((p) => p.categoryId).filter(Boolean)));
  const categories = await CategoryModel.find({ id: { $in: categoryIds } }).lean();
  const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));
  return products.map((product) => ({
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
    const regex = new RegExp(filters.search, "i");
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
  await CustomerModel.deleteOne({ id });
}
async function getAllCatalogs(filters) {
  await connectDb();
  const query = {};
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  if (filters?.status) query.status = filters.status;
  if (filters?.customerId) query.customerId = filters.customerId;
  const catalogs = await CatalogModel.find(query).sort({ createdAt: -1 }).lean();
  const customerIds = Array.from(new Set(catalogs.map((c) => c.customerId).filter(Boolean)));
  const customers = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  return catalogs.map((catalog) => ({
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
  const catalogProducts = await CatalogProductModel.find({ catalogId }).sort({ sortOrder: 1 }).lean();
  const productIds = catalogProducts.map((cp) => cp.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories = await CategoryModel.find({ id: { $in: products.map((p) => p.categoryId).filter(Boolean) } }).lean();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  return catalogProducts.map((catalogProduct) => {
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
  const orders = await OrderModel.find(query).sort({ orderDate: -1 }).lean();
  const customerIds = Array.from(new Set(orders.map((order) => order.customerId).filter(Boolean)));
  const catalogIds = Array.from(new Set(orders.map((order) => order.catalogId).filter(Boolean)));
  const customers = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const catalogs = await CatalogModel.find({ id: { $in: catalogIds } }).lean();
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const catalogMap = new Map(catalogs.map((catalog) => [catalog.id, catalog]));
  return orders.map((order) => ({
    order,
    customer: order.customerId ? customerMap.get(order.customerId) ?? null : null,
    catalog: order.catalogId ? catalogMap.get(order.catalogId) ?? null : null
  }));
}
async function getOrderById(id) {
  await connectDb();
  const order = await OrderModel.findOne({ id }).lean();
  if (!order) return null;
  const customer = order.customerId ? await CustomerModel.findOne({ id: order.customerId }).lean() : null;
  const catalog = order.catalogId ? await CatalogModel.findOne({ id: order.catalogId }).lean() : null;
  return { order, customer, catalog };
}
async function createOrder(data) {
  await connectDb();
  const id = await getNextSequence("orders");
  const created = await OrderModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}
async function updateOrder(id, data) {
  await connectDb();
  await OrderModel.updateOne({ id }, { $set: data });
  return await getOrderById(id);
}
async function deleteOrder(id) {
  await connectDb();
  await OrderItemModel.deleteMany({ orderId: id });
  await OrderModel.deleteOne({ id });
}
async function getOrderItems(orderId) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).lean();
  const productIds = items.map((item) => item.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const productMap = new Map(products.map((product) => [product.id, product]));
  return items.map((orderItem) => ({
    orderItem,
    product: productMap.get(orderItem.productId) ?? null
  }));
}
async function addOrderItems(orderId, items) {
  await connectDb();
  const values = [];
  for (const item of items) {
    values.push({
      id: await getNextSequence("order_items"),
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice)
    });
  }
  if (values.length > 0) {
    await OrderItemModel.insertMany(values);
  }
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
async function generateOrderNumber() {
  await connectDb();
  const year = (/* @__PURE__ */ new Date()).getFullYear().toString().slice(-2);
  const month = ((/* @__PURE__ */ new Date()).getMonth() + 1).toString().padStart(2, "0");
  const prefix = `JO${year}${month}`;
  const lastOrder = await OrderModel.findOne({ orderNumber: { $regex: `^${prefix}` } }).sort({ orderNumber: -1 }).lean();
  let sequence = 1;
  if (lastOrder?.orderNumber) {
    const lastSequence = parseInt(lastOrder.orderNumber.slice(-4), 10);
    if (!Number.isNaN(lastSequence)) {
      sequence = lastSequence + 1;
    }
  }
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
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
  const collectionProducts = await CollectionProductModel.find({ collectionId }).sort({ sortOrder: 1 }).lean();
  const productIds = collectionProducts.map((cp) => cp.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories = await CategoryModel.find({ id: { $in: products.map((p) => p.categoryId).filter(Boolean) } }).lean();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  return collectionProducts.map((collectionProduct) => {
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
var resolveApiUrl = () => ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions` : "https://forge.manus.im/v1/chat/completions";
var assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
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
  assertApiKey();
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
    model: "gemini-2.5-flash",
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
  payload.max_tokens = 32768;
  payload.thinking = {
    "budget_tokens": 128
  };
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`
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
import { TRPCError as TRPCError3 } from "@trpc/server";
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure.input(z2.object({
      email: z2.string().email(),
      password: z2.string().min(1)
    })).mutation(async ({ input, ctx }) => {
      const user = await getUserByEmail(input.email);
      if (!user) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      const isValid = await verifyPassword(input.password, user.passwordHash);
      if (!isValid) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid credentials" });
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
    stats: protectedProcedure.query(async () => {
      return await getDashboardStats();
    })
  }),
  // Gold Prices
  goldPrice: router({
    getToday: protectedProcedure.query(async () => {
      return await getTodayGoldPrice();
    }),
    getLatest: protectedProcedure.query(async () => {
      return await getLatestGoldPrice();
    }),
    set: protectedProcedure.input(z2.object({
      price22k: z2.string(),
      price24k: z2.string()
    })).mutation(async ({ input, ctx }) => {
      return await setGoldPrice({
        ...input,
        userId: ctx.user.id
      });
    })
  }),
  // Categories
  categories: router({
    list: protectedProcedure.query(async () => {
      return await getAllCategories();
    })
  }),
  // Products
  products: router({
    list: protectedProcedure.input(z2.object({
      categoryId: z2.number().optional(),
      search: z2.string().optional(),
      isActive: z2.boolean().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllProducts(input);
    }),
    getById: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      return await getProductById(input.id);
    }),
    create: protectedProcedure.input(z2.object({
      name: z2.string().min(1),
      description: z2.string().optional(),
      sku: z2.string().optional(),
      categoryId: z2.number().optional(),
      goldKarat: z2.enum(["22k", "24k"]).optional(),
      goldWeight: z2.string().optional(),
      goldWastage: z2.string().optional(),
      goldRateAtOrder: z2.string().optional(),
      makingCharges: z2.string().optional(),
      makingChargesType: z2.enum(["fixed", "per_gram"]).optional(),
      diamondWeight: z2.string().optional(),
      diamondRate: z2.string().optional(),
      diamondPrice: z2.string().optional(),
      stoneType: z2.string().optional(),
      stoneWeight: z2.string().optional(),
      stoneRate: z2.string().optional(),
      stonePrice: z2.string().optional(),
      images: z2.string().optional(),
      primaryImage: z2.string().optional(),
      basePrice: z2.string().optional(),
      totalPrice: z2.string().optional()
    })).mutation(async ({ input, ctx }) => {
      return await createProduct({
        ...input,
        createdBy: ctx.user.id
      });
    }),
    update: protectedProcedure.input(z2.object({
      id: z2.number(),
      name: z2.string().min(1).optional(),
      description: z2.string().optional(),
      sku: z2.string().optional(),
      categoryId: z2.number().nullable().optional(),
      goldKarat: z2.enum(["22k", "24k"]).nullable().optional(),
      goldWeight: z2.string().optional(),
      goldWastage: z2.string().optional(),
      goldRateAtOrder: z2.string().optional(),
      makingCharges: z2.string().optional(),
      makingChargesType: z2.enum(["fixed", "per_gram"]).optional(),
      diamondWeight: z2.string().optional(),
      diamondRate: z2.string().optional(),
      diamondPrice: z2.string().optional(),
      stoneType: z2.string().optional(),
      stoneWeight: z2.string().optional(),
      stoneRate: z2.string().optional(),
      stonePrice: z2.string().optional(),
      images: z2.string().optional(),
      primaryImage: z2.string().optional(),
      basePrice: z2.string().optional(),
      totalPrice: z2.string().optional(),
      isActive: z2.boolean().optional()
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await updateProduct(id, data);
    }),
    delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteProduct(input.id);
      return { success: true };
    })
  }),
  // Customers
  customers: router({
    list: protectedProcedure.input(z2.object({
      search: z2.string().optional(),
      paymentStatus: z2.enum(["paid", "unpaid"]).optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCustomers(input);
    }),
    getById: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      return await getCustomerById(input.id);
    }),
    create: protectedProcedure.input(z2.object({
      firstName: z2.string().min(1),
      lastName: z2.string().optional(),
      email: z2.string().email().optional().or(z2.literal("")),
      phone: z2.string().optional(),
      address: z2.string().optional(),
      city: z2.string().optional(),
      state: z2.string().optional(),
      country: z2.string().optional(),
      paymentStatus: z2.enum(["paid", "unpaid"]).optional(),
      notes: z2.string().optional()
    })).mutation(async ({ input, ctx }) => {
      return await createCustomer({
        ...input,
        email: input.email || null,
        createdBy: ctx.user.id
      });
    }),
    update: protectedProcedure.input(z2.object({
      id: z2.number(),
      firstName: z2.string().min(1).optional(),
      lastName: z2.string().optional(),
      email: z2.string().email().optional().or(z2.literal("")),
      phone: z2.string().optional(),
      address: z2.string().optional(),
      city: z2.string().optional(),
      state: z2.string().optional(),
      country: z2.string().optional(),
      paymentStatus: z2.enum(["paid", "unpaid"]).optional(),
      notes: z2.string().optional()
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await updateCustomer(id, {
        ...data,
        email: data.email || null
      });
    }),
    delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteCustomer(input.id);
      return { success: true };
    })
  }),
  // Catalogs
  catalogs: router({
    list: protectedProcedure.input(z2.object({
      search: z2.string().optional(),
      status: z2.string().optional(),
      customerId: z2.number().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCatalogs(input);
    }),
    getById: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      const catalog = await getCatalogById(input.id);
      if (!catalog) return null;
      const products = await getCatalogProducts(input.id);
      const comments = await getCatalogComments(input.id);
      const likes = await getCatalogLikes(input.id);
      return { ...catalog, products, comments, likes };
    }),
    getByToken: publicProcedure.input(z2.object({ token: z2.string() })).query(async ({ input }) => {
      const catalog = await getCatalogByToken(input.token);
      if (!catalog) return null;
      const products = await getCatalogProducts(catalog.catalog.id);
      const likes = await getCatalogLikes(catalog.catalog.id);
      return { ...catalog, products, likes };
    }),
    create: protectedProcedure.input(z2.object({
      name: z2.string().min(1),
      description: z2.string().optional(),
      coverImage: z2.string().optional(),
      productType: z2.string().optional(),
      customFields: z2.string().optional(),
      customerId: z2.number().nullable().optional(),
      isPublic: z2.boolean().optional(),
      status: z2.enum(["draft", "published", "archived"]).optional(),
      productIds: z2.array(z2.number()).optional()
    })).mutation(async ({ input, ctx }) => {
      const { productIds, ...catalogData } = input;
      const publicToken = nanoid(16);
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
    update: protectedProcedure.input(z2.object({
      id: z2.number(),
      name: z2.string().min(1).optional(),
      description: z2.string().optional(),
      coverImage: z2.string().optional(),
      productType: z2.string().optional(),
      customFields: z2.string().optional(),
      customerId: z2.number().nullable().optional(),
      isPublic: z2.boolean().optional(),
      status: z2.enum(["draft", "published", "archived"]).optional(),
      productIds: z2.array(z2.number()).optional()
    })).mutation(async ({ input }) => {
      const { id, productIds, ...data } = input;
      const catalog = await updateCatalog(id, data);
      if (productIds !== void 0) {
        await updateCatalogProducts(id, productIds);
      }
      return catalog;
    }),
    delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteCatalog(input.id);
      return { success: true };
    }),
    // Public actions for catalog preview
    like: publicProcedure.input(z2.object({
      catalogId: z2.number(),
      productId: z2.number(),
      visitorId: z2.string()
    })).mutation(async ({ input }) => {
      return await addCatalogLike(input);
    }),
    comment: publicProcedure.input(z2.object({
      catalogId: z2.number(),
      productId: z2.number().optional(),
      visitorName: z2.string().optional(),
      comment: z2.string().min(1)
    })).mutation(async ({ input }) => {
      return await addCatalogComment(input);
    }),
    getComments: protectedProcedure.input(z2.object({ catalogId: z2.number() })).query(async ({ input }) => {
      return await getCatalogComments(input.catalogId);
    }),
    markCommentRead: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await markCommentAsRead(input.id);
      return { success: true };
    })
  }),
  // Collections
  collections: router({
    list: protectedProcedure.input(z2.object({
      search: z2.string().optional(),
      isActive: z2.boolean().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllCollections(input);
    }),
    getById: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      const collection = await getCollectionById(input.id);
      if (!collection) return null;
      const products = await getCollectionProducts(input.id);
      return { ...collection, products };
    }),
    create: protectedProcedure.input(z2.object({
      name: z2.string().min(1),
      description: z2.string().optional(),
      coverImage: z2.string().optional(),
      productIds: z2.array(z2.number()).optional()
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
    update: protectedProcedure.input(z2.object({
      id: z2.number(),
      name: z2.string().min(1).optional(),
      description: z2.string().optional(),
      coverImage: z2.string().optional(),
      isActive: z2.boolean().optional(),
      productIds: z2.array(z2.number()).optional()
    })).mutation(async ({ input }) => {
      const { id, productIds, ...data } = input;
      const collection = await updateCollection(id, data);
      if (productIds !== void 0) {
        const existing = await getCollectionProducts(id);
        for (const p of existing) {
          await removeProductFromCollection(id, p.product.id);
        }
        if (productIds.length > 0) {
          await addProductsToCollection(id, productIds);
        }
      }
      return collection;
    }),
    delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteCollection(input.id);
      return { success: true };
    }),
    addProducts: protectedProcedure.input(z2.object({
      collectionId: z2.number(),
      productIds: z2.array(z2.number())
    })).mutation(async ({ input }) => {
      await addProductsToCollection(input.collectionId, input.productIds);
      return { success: true };
    }),
    removeProduct: protectedProcedure.input(z2.object({
      collectionId: z2.number(),
      productId: z2.number()
    })).mutation(async ({ input }) => {
      await removeProductFromCollection(input.collectionId, input.productId);
      return { success: true };
    })
  }),
  // Orders
  orders: router({
    list: protectedProcedure.input(z2.object({
      status: z2.string().optional(),
      customerId: z2.number().optional(),
      month: z2.number().optional(),
      year: z2.number().optional()
    }).optional()).query(async ({ input }) => {
      return await getAllOrders(input);
    }),
    getById: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      const order = await getOrderById(input.id);
      if (!order) return null;
      const items = await getOrderItems(input.id);
      return { ...order, items };
    }),
    create: protectedProcedure.input(z2.object({
      catalogId: z2.number().optional(),
      customerId: z2.number().optional(),
      totalItems: z2.number().optional(),
      totalWeight: z2.string().optional(),
      totalPrice: z2.string().optional(),
      status: z2.enum(["pending", "production", "completed", "delivered", "cancelled"]).optional(),
      expectedDelivery: z2.string().optional(),
      notes: z2.string().optional(),
      items: z2.array(z2.object({
        productId: z2.number(),
        quantity: z2.number(),
        unitPrice: z2.string(),
        totalPrice: z2.string()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const { items, expectedDelivery, ...orderData } = input;
      const orderNumber = await generateOrderNumber();
      const order = await createOrder({
        ...orderData,
        orderNumber,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
        createdBy: ctx.user.id
      });
      if (items && items.length > 0) {
        await addOrderItems(order.id, items);
      }
      return order;
    }),
    update: protectedProcedure.input(z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "production", "completed", "delivered", "cancelled"]).optional(),
      expectedDelivery: z2.string().optional(),
      notes: z2.string().optional(),
      totalItems: z2.number().optional(),
      totalWeight: z2.string().optional(),
      totalPrice: z2.string().optional()
    })).mutation(async ({ input }) => {
      const { id, expectedDelivery, ...data } = input;
      const updateData = { ...data };
      if (expectedDelivery) {
        updateData.expectedDelivery = new Date(expectedDelivery);
      }
      if (data.status === "completed") {
        updateData.completedDate = /* @__PURE__ */ new Date();
      }
      return await updateOrder(id, updateData);
    }),
    delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteOrder(input.id);
      return { success: true };
    })
  }),
  // File Upload
  upload: router({
    image: protectedProcedure.input(z2.object({
      base64: z2.string(),
      filename: z2.string(),
      contentType: z2.string()
    })).mutation(async ({ input }) => {
      const base64Data = input.base64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const ext = input.filename.split(".").pop() || "jpg";
      const uniqueFilename = `catalog-covers/${Date.now()}-${nanoid(8)}.${ext}`;
      const { url } = await storagePut(uniqueFilename, buffer, input.contentType);
      return { url };
    })
  }),
  // JulesBot AI Agent
  julesBot: router({
    // Get greeting with gold news, trends, and weather
    getGreeting: protectedProcedure.query(async ({ ctx }) => {
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
\u2022 ${stats.currentMonthOrders} orders this monthth

Have a productive day!`,
          goldPrice,
          stats,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }),
    // Chat with JulesBot
    chat: protectedProcedure.input(z2.object({
      message: z2.string().min(1),
      conversationHistory: z2.array(z2.object({
        role: z2.enum(["user", "assistant"]),
        content: z2.string()
      })).optional()
    })).mutation(async ({ input, ctx }) => {
      const goldPrice = await getLatestGoldPrice();
      const stats = await getDashboardStats();
      const products = await getAllProducts();
      const customers = await getAllCustomers();
      const catalogs = await getAllCatalogs();
      const collections = await getAllCollections();
      const productList = products.map((p) => `- ID:${p.product.id} "${p.product.name}" (Category: ${p.category?.name || "N/A"}, Karat: ${p.product.goldKarat || "N/A"}, SKU: ${p.product.sku || "N/A"}, Price: PKR ${p.product.basePrice || "N/A"})`).join("\n");
      const customerList = customers.map((c) => `- ID:${c.id} "${c.firstName} ${c.lastName || ""}" (Email: ${c.email || "N/A"}, Phone: ${c.phone || "N/A"}, City: ${c.city || "N/A"})`).join("\n");
      const catalogList = catalogs.map((c) => `- ${c.catalog.name} (ID: ${c.catalog.id}, Status: ${c.catalog.status}, Token: ${c.catalog.publicToken})`).join("\n");
      const collectionList = collections.map((c) => `- ${c.name} (ID: ${c.id}, ${c.productCount || 0} products)`).join("\n");
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
            const publicToken = nanoid(12);
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
        return {
          message: "I apologize, I'm having trouble processing your request right now. Please try again.",
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
import { nanoid as nanoid2 } from "nanoid";
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
        `src="/src/main.tsx?v=${nanoid2()}"`
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
startServer().catch(console.error);
