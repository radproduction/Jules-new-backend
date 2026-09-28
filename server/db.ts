import mongoose, { Schema } from "mongoose";
import { ENV } from "./_core/env";
import { hashPassword } from "./_core/auth";
import type { User as AppUser, UserRole } from "./_core/types";
import {
  catalogs as catalogsTable,
  customers as customersTable,
  goldPrices as goldPricesTable,
  orderAdvanceGems as orderAdvanceGemsTable,
  orderAdvanceMetals as orderAdvanceMetalsTable,
  orderInvoiceItems as orderInvoiceItemsTable,
  orderInvoices as orderInvoicesTable,
  orderItems as orderItemsTable,
  orderProcesses as orderProcessesTable,
  orders as ordersTable,
  products as productsTable,
  vendors as vendorsTable,
} from "../drizzle/schema";
import { num, toRow, toRowOrNull, toRows } from "./rows";

let connected = false;

export async function connectDb() {
  if (connected) return;
  if (!ENV.mongoUri) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }
  await mongoose.connect(ENV.mongoUri);
  connected = true;
}

export function ensureModel<TSchema extends Schema>(name: string, schema: TSchema) {
  const create = () => mongoose.model(name, schema);
  // Reuse the compiled model when the module is re-evaluated (tests / hot reload).
  return (mongoose.models[name] as ReturnType<typeof create> | undefined) ?? create();
}

const CounterSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { collection: "counters" }
);

const Counter = ensureModel("Counter", CounterSchema);

export async function getNextSequence(name: string): Promise<number> {
  // Atomic $inc on a uniquely-indexed counter document. A first-time upsert
  // race can surface as E11000 on the counter itself; retrying resolves it.
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { name },
        { $inc: { value: 1 } },
        { new: true, upsert: true }
      ).lean();
      return counter?.value ?? 1;
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000 || attempt >= 3) throw error;
    }
  }
}

const withTimestamps = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
};

const UserSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["user", "operations_finance", "admin"], default: "user" },
    isActive: { type: Boolean, default: true },
    lastSignedIn: { type: Date, default: Date.now },
  },
  { ...withTimestamps, collection: "users" }
);

const GoldPriceSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    priceDate: { type: Date, required: true },
    price22k: { type: Number, required: true },
    price24k: { type: Number, required: true },
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "gold_prices" }
);

const CategorySchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true },
    description: { type: String },
  },
  { ...withTimestamps, collection: "categories" }
);

const ProductSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "products" }
);

const CustomerSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "customers" }
);

const CatalogSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "catalogs" }
);

const CatalogProductSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { ...withTimestamps, collection: "catalog_products" }
);

const CatalogLikeSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    visitorId: { type: String },
  },
  { ...withTimestamps, collection: "catalog_likes" }
);

const CatalogCommentSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number },
    visitorName: { type: String },
    comment: { type: String, required: true },
    isRead: { type: Boolean, default: false },
  },
  { ...withTimestamps, collection: "catalog_comments" }
);

const OrderSchema = new Schema(
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
      default: "saved",
    },
    orderDate: { type: Date, default: Date.now },
    expectedDelivery: { type: Date },
    completedDate: { type: Date },
    notes: { type: String },
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "orders" }
);

const OrderItemSchema = new Schema(
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
    comments: { type: String },
  },
  { ...withTimestamps, collection: "order_items" }
);

const CollectionSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    coverImage: { type: String },
    productCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "collections" }
);

const CollectionProductSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    collectionId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { ...withTimestamps, collection: "collection_products" }
);

const VendorSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "vendors" }
);

const OrderProcessSchema = new Schema(
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
    closedDate: { type: Date },
  },
  { ...withTimestamps, collection: "order_processes" }
);

const OrderAdvanceMetalSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    itemName: { type: String },
    receivedDate: { type: Date },
    weight: { type: Number },
    alloy: { type: String },
    netWeightRate: { type: Number },
    value: { type: Number },
    comments: { type: String },
  },
  { ...withTimestamps, collection: "order_advance_metals" }
);

const OrderAdvanceGemSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    orderId: { type: Number, required: true, index: true },
    itemName: { type: String },
    qty: { type: Number },
    weight: { type: Number },
    comments: { type: String },
  },
  { ...withTimestamps, collection: "order_advance_gems" }
);

const OrderInvoiceSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "order_invoices" }
);

const OrderInvoiceItemSchema = new Schema(
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
    sortOrder: { type: Number, default: 0 },
  },
  { ...withTimestamps, collection: "order_invoice_items" }
);

export const UserModel = ensureModel("User", UserSchema);
const GoldPriceModel = ensureModel("GoldPrice", GoldPriceSchema);
const CategoryModel = ensureModel("Category", CategorySchema);
const ProductModel = ensureModel("Product", ProductSchema);
const CustomerModel = ensureModel("Customer", CustomerSchema);
const CatalogModel = ensureModel("Catalog", CatalogSchema);
const CatalogProductModel = ensureModel("CatalogProduct", CatalogProductSchema);
const CatalogLikeModel = ensureModel("CatalogLike", CatalogLikeSchema);
const CatalogCommentModel = ensureModel("CatalogComment", CatalogCommentSchema);
const OrderModel = ensureModel("Order", OrderSchema);
const OrderItemModel = ensureModel("OrderItem", OrderItemSchema);
const CollectionModel = ensureModel("Collection", CollectionSchema);
const CollectionProductModel = ensureModel("CollectionProduct", CollectionProductSchema);
export const VendorModel = ensureModel("Vendor", VendorSchema);
export const OrderProcessModel = ensureModel("OrderProcess", OrderProcessSchema);
export const OrderAdvanceMetalModel = ensureModel("OrderAdvanceMetal", OrderAdvanceMetalSchema);
export const OrderAdvanceGemModel = ensureModel("OrderAdvanceGem", OrderAdvanceGemSchema);
export const OrderInvoiceModel = ensureModel("OrderInvoice", OrderInvoiceSchema);
export const OrderInvoiceItemModel = ensureModel("OrderInvoiceItem", OrderInvoiceItemSchema);
export { CustomerModel, OrderModel, OrderItemModel, ProductModel };

type DbUser = {
  id: number;
  email: string;
  passwordHash: string;
  name?: string | null;
  role: UserRole;
  isActive?: boolean;
  lastSignedIn?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export type PublicUser = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  lastSignedIn: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function toPublicUser(user: DbUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    isActive: user.isActive !== false,
    lastSignedIn: user.lastSignedIn ?? null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function ensureAdminUser() {
  await connectDb();
  if (!ENV.adminEmail || !ENV.adminPassword) {
    console.warn("[Auth] ADMIN_EMAIL or ADMIN_PASSWORD not configured; skipping admin seed");
    return;
  }

  const email = normalizeEmail(ENV.adminEmail);
  const existing = await UserModel.findOne({
    email: { $in: Array.from(new Set([ENV.adminEmail, email])) },
  }).lean<DbUser>();
  if (existing) {
    // The configured owner account is always retained as an active Super Admin.
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
    lastSignedIn: new Date(),
  });
}

export async function getUserById(id: number): Promise<AppUser | null> {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean<DbUser>();
  if (!user || user.isActive === false) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
  };
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  await connectDb();
  const normalized = normalizeEmail(email);
  // Legacy accounts may have been stored with mixed-case emails.
  return UserModel.findOne({
    email: { $in: Array.from(new Set([email.trim(), normalized])) },
  }).lean<DbUser>();
}

export async function updateUserLastSignedIn(id: number) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: { lastSignedIn: new Date() } });
}

export async function listUsers(): Promise<PublicUser[]> {
  await connectDb();
  const users = await UserModel.find({}).sort({ lastSignedIn: -1 }).lean<DbUser[]>();
  return users.map(toPublicUser);
}

export async function getPublicUserById(id: number): Promise<PublicUser | null> {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean<DbUser>();
  return user ? toPublicUser(user) : null;
}

export async function createUserAccount(data: {
  email: string;
  name?: string;
  password: string;
  role: UserRole;
}): Promise<PublicUser> {
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
    lastSignedIn: null,
  });
  return toPublicUser(created.toObject() as unknown as DbUser);
}

export async function setUserFields(
  id: number,
  data: Partial<{ role: UserRole; isActive: boolean; name: string | null; passwordHash: string }>
) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: data });
  return getPublicUserById(id);
}

// Gold Price functions
export async function getTodayGoldPrice() {
  await connectDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const price = await GoldPriceModel.findOne({ priceDate: { $gte: start, $lte: end } })
    .sort({ priceDate: -1 })
    .lean();
  return toRowOrNull(goldPricesTable, price);
}

export async function getLatestGoldPrice() {
  await connectDb();
  return toRowOrNull(goldPricesTable, await GoldPriceModel.findOne({}).sort({ priceDate: -1 }).lean());
}

export async function setGoldPrice(data: { price22k: string; price24k: string; userId?: number }) {
  await connectDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await getTodayGoldPrice();

  const payload = {
    price22k: Number(data.price22k),
    price24k: Number(data.price24k),
  };

  if (existing) {
    await GoldPriceModel.updateOne({ id: existing.id }, { $set: payload });
    return toRow(goldPricesTable, { ...existing, ...payload });
  }

  const id = await getNextSequence("gold_prices");
  const created = await GoldPriceModel.create({
    id,
    priceDate: today,
    ...payload,
    createdBy: data.userId,
  });
  return toRow(goldPricesTable, created.toObject());
}

// Categories
export async function getAllCategories() {
  await connectDb();
  return CategoryModel.find({}).sort({ name: 1 }).lean();
}

// Products
export async function getAllProducts(filters?: { categoryId?: number; search?: string; isActive?: boolean }) {
  await connectDb();
  const query: Record<string, unknown> = {};
  if (filters?.categoryId) query.categoryId = filters.categoryId;
  if (filters?.isActive !== undefined) query.isActive = filters.isActive;
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };

  const products = await ProductModel.find(query)
    .sort({ createdAt: -1 })
    .lean();

  const categoryIds = Array.from(new Set(products.map(p => p.categoryId).filter(Boolean)));
  const categories = await CategoryModel.find({ id: { $in: categoryIds } }).lean();
  const categoryMap = new Map(categories.map(cat => [cat.id, cat]));

  return products.map(product => ({
    product,
    category: product.categoryId ? categoryMap.get(product.categoryId) ?? null : null,
  }));
}

export async function getProductById(id: number) {
  await connectDb();
  const product = await ProductModel.findOne({ id }).lean();
  if (!product) return null;
  const category = product.categoryId
    ? await CategoryModel.findOne({ id: product.categoryId }).lean()
    : null;
  return { product, category };
}

export async function createProduct(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("products");
  const created = await ProductModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

export async function updateProduct(id: number, data: Record<string, unknown>) {
  await connectDb();
  await ProductModel.updateOne({ id }, { $set: data });
  return await getProductById(id);
}

export async function deleteProduct(id: number) {
  await connectDb();
  await ProductModel.deleteOne({ id });
}

// Customers
export async function getAllCustomers(filters?: { search?: string; paymentStatus?: "paid" | "unpaid" }) {
  await connectDb();
  const query: Record<string, unknown> = {};

  if (filters?.paymentStatus) {
    query.paymentStatus = filters.paymentStatus;
  }

  if (filters?.search) {
    const regex = new RegExp(escapeRegex(filters.search), "i");
    query.$or = [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { phone: regex },
    ];
  }

  return CustomerModel.find(query).sort({ createdAt: -1 }).lean();
}

export async function getCustomerById(id: number) {
  await connectDb();
  return CustomerModel.findOne({ id }).lean();
}

export async function createCustomer(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("customers");
  const created = await CustomerModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

export async function updateCustomer(id: number, data: Record<string, unknown>) {
  await connectDb();
  await CustomerModel.updateOne({ id }, { $set: data });
  return await getCustomerById(id);
}

export async function deleteCustomer(id: number) {
  await connectDb();
  const [orderCount, invoiceCount] = await Promise.all([
    OrderModel.countDocuments({ customerId: id }),
    OrderInvoiceModel.countDocuments({ customerId: id }),
  ]);
  if (orderCount > 0 || invoiceCount > 0) {
    throw new Error("This customer has orders or invoices and cannot be deleted");
  }
  // Ledger protection (posted journals) is enforced by financeDb before this runs.
  await CustomerModel.deleteOne({ id });
}

// Catalogs
export async function getAllCatalogs(filters?: { search?: string; status?: string; customerId?: number }) {
  await connectDb();
  const query: Record<string, unknown> = {};
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  if (filters?.status) query.status = filters.status;
  if (filters?.customerId) query.customerId = filters.customerId;

  const catalogs = await CatalogModel.find(query).sort({ createdAt: -1 }).lean();
  const customerIds = Array.from(new Set(catalogs.map(c => c.customerId).filter(Boolean)));
  const customers = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));

  return catalogs.map(catalog => ({
    catalog,
    customer: catalog.customerId ? customerMap.get(catalog.customerId) ?? null : null,
  }));
}

export async function getCatalogById(id: number) {
  await connectDb();
  const catalog = await CatalogModel.findOne({ id }).lean();
  if (!catalog) return null;
  const customer = catalog.customerId
    ? await CustomerModel.findOne({ id: catalog.customerId }).lean()
    : null;
  return { catalog, customer };
}

export async function getCatalogByToken(token: string) {
  await connectDb();
  const catalog = await CatalogModel.findOne({ publicToken: token }).lean();
  if (!catalog) return null;
  const customer = catalog.customerId
    ? await CustomerModel.findOne({ id: catalog.customerId }).lean()
    : null;
  return { catalog, customer };
}

export async function createCatalog(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("catalogs");
  const created = await CatalogModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

export async function updateCatalog(id: number, data: Record<string, unknown>) {
  await connectDb();
  await CatalogModel.updateOne({ id }, { $set: data });
  return await getCatalogById(id);
}

export async function deleteCatalog(id: number) {
  await connectDb();
  await CatalogProductModel.deleteMany({ catalogId: id });
  await CatalogLikeModel.deleteMany({ catalogId: id });
  await CatalogCommentModel.deleteMany({ catalogId: id });
  await CatalogModel.deleteOne({ id });
}

// Catalog products
export async function getCatalogProducts(catalogId: number) {
  await connectDb();
  const catalogProducts = await CatalogProductModel.find({ catalogId })
    .sort({ sortOrder: 1 })
    .lean();
  const productIds = catalogProducts.map(cp => cp.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories = await CategoryModel.find({ id: { $in: products.map(p => p.categoryId).filter(Boolean) } }).lean();

  const productMap = new Map(products.map(product => [product.id, product]));
  const categoryMap = new Map(categories.map(category => [category.id, category]));

  return catalogProducts.map(catalogProduct => {
    const product = productMap.get(catalogProduct.productId);
    const category = product?.categoryId ? categoryMap.get(product.categoryId) ?? null : null;
    return { catalogProduct, product, category };
  });
}

export async function addProductsToCatalog(catalogId: number, productIds: number[]) {
  await connectDb();
  if (!productIds.length) return;

  const values = [];
  for (let i = 0; i < productIds.length; i++) {
    values.push({
      id: await getNextSequence("catalog_products"),
      catalogId,
      productId: productIds[i],
      sortOrder: i,
    });
  }

  await CatalogProductModel.insertMany(values);
}

export async function removeProductFromCatalog(catalogId: number, productId: number) {
  await connectDb();
  await CatalogProductModel.deleteOne({ catalogId, productId });
}

export async function updateCatalogProducts(catalogId: number, productIds: number[]) {
  await connectDb();
  await CatalogProductModel.deleteMany({ catalogId });
  await addProductsToCatalog(catalogId, productIds);
}

// Catalog likes
export async function getCatalogLikes(catalogId: number) {
  await connectDb();
  return CatalogLikeModel.find({ catalogId }).lean();
}

export async function addCatalogLike(data: { catalogId: number; productId: number; visitorId?: string }) {
  await connectDb();
  const visitorId = data.visitorId || "";
  const existing = await CatalogLikeModel.findOne({
    catalogId: data.catalogId,
    productId: data.productId,
    visitorId,
  }).lean();

  if (existing) {
    await CatalogLikeModel.deleteOne({ id: existing.id });
    return { liked: false };
  }

  await CatalogLikeModel.create({
    id: await getNextSequence("catalog_likes"),
    catalogId: data.catalogId,
    productId: data.productId,
    visitorId,
  });
  return { liked: true };
}

// Catalog comments
export async function getCatalogComments(catalogId: number) {
  await connectDb();
  return CatalogCommentModel.find({ catalogId }).sort({ createdAt: -1 }).lean();
}

export async function addCatalogComment(data: { catalogId: number; productId?: number; visitorName?: string; comment: string }) {
  await connectDb();
  const created = await CatalogCommentModel.create({
    id: await getNextSequence("catalog_comments"),
    catalogId: data.catalogId,
    productId: data.productId,
    visitorName: data.visitorName,
    comment: data.comment,
    isRead: false,
  });
  return { id: created.id, ...data };
}

export async function markCommentAsRead(id: number) {
  await connectDb();
  await CatalogCommentModel.updateOne({ id }, { $set: { isRead: true } });
}

// Orders
function orderRow(order: unknown) {
  return toRow(ordersTable, order);
}

export async function getAllOrders(filters?: { status?: string; customerId?: number; month?: number; year?: number }) {
  await connectDb();
  const query: Record<string, unknown> = {};
  if (filters?.status) query.status = filters.status;
  if (filters?.customerId) query.customerId = filters.customerId;
  if (filters?.month && filters?.year) {
    const startDate = new Date(filters.year, filters.month - 1, 1);
    const endDate = new Date(filters.year, filters.month, 0, 23, 59, 59, 999);
    query.orderDate = { $gte: startDate, $lte: endDate };
  }

  const orders = await OrderModel.find(query).sort({ orderDate: -1, id: -1 }).lean();
  const customerIds = Array.from(new Set(orders.map(order => order.customerId).filter(Boolean)));
  const catalogIds = Array.from(new Set(orders.map(order => order.catalogId).filter(Boolean)));
  const customers = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const catalogs = await CatalogModel.find({ id: { $in: catalogIds } }).lean();

  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const catalogMap = new Map(catalogs.map(catalog => [catalog.id, catalog]));

  return orders.map(order => ({
    order: orderRow(order),
    customer: order.customerId ? toRowOrNull(customersTable, customerMap.get(order.customerId)) : null,
    catalog: order.catalogId ? toRowOrNull(catalogsTable, catalogMap.get(order.catalogId)) : null,
  }));
}

export async function getOrderById(id: number) {
  await connectDb();
  const order = await OrderModel.findOne({ id }).lean();
  if (!order) return null;
  const customer = order.customerId
    ? await CustomerModel.findOne({ id: order.customerId }).lean()
    : null;
  const catalog = order.catalogId
    ? await CatalogModel.findOne({ id: order.catalogId }).lean()
    : null;
  return {
    order: orderRow(order),
    customer: toRowOrNull(customersTable, customer),
    catalog: toRowOrNull(catalogsTable, catalog),
  };
}

const ORDER_DECIMALS = ["totalWeight", "totalPrice", "advanceCash"] as const;

function cleanDecimals<T extends Record<string, unknown>>(data: T, fields: readonly string[]) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    result[key] = fields.includes(key) ? num(value as string) ?? null : value;
  }
  return result;
}

export async function createOrder(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("orders");
  const created = await OrderModel.create({ id, ...cleanDecimals(data, ORDER_DECIMALS) });
  return orderRow(created.toObject());
}

export async function updateOrder(id: number, data: Record<string, unknown>) {
  await connectDb();
  await OrderModel.updateOne({ id }, { $set: cleanDecimals(data, ORDER_DECIMALS) });
  return await getOrderById(id);
}

export async function deleteOrder(id: number) {
  await connectDb();
  const invoiceCount = await OrderInvoiceModel.countDocuments({ orderId: id });
  if (invoiceCount > 0) {
    throw new Error("This order has invoices and cannot be deleted. Cancel it instead.");
  }
  const itemIds = (await OrderItemModel.find({ orderId: id }, { id: 1 }).lean()).map(item => item.id);
  await OrderProcessModel.deleteMany({ $or: [{ orderId: id }, { orderItemId: { $in: itemIds } }] });
  await OrderAdvanceMetalModel.deleteMany({ orderId: id });
  await OrderAdvanceGemModel.deleteMany({ orderId: id });
  await OrderItemModel.deleteMany({ orderId: id });
  await OrderModel.deleteOne({ id });
}

// Order items
const ORDER_ITEM_DECIMALS = [
  "estimatedMetalWeight",
  "estimatedMetalWastage",
  "estimatedMetalRate",
  "estimatedMetalValue",
  "estimatedGemWeight",
  "estimatedGemRate",
  "estimatedGemValue",
  "estimatedLabourCharges",
  "unitPrice",
  "totalPrice",
] as const;

export type OrderItemInput = {
  productId?: number;
  vendorId?: number;
  itemName: string;
  quantity: number;
  unitPrice?: string;
  totalPrice?: string;
  estimatedMetalType?: string;
  estimatedMetalWeight?: string;
  estimatedMetalWastage?: string;
  estimatedMetalRate?: string;
  estimatedMetalValue?: string;
  estimatedGemType?: string;
  estimatedGemQty?: number;
  estimatedGemWeight?: string;
  estimatedGemRate?: string;
  estimatedGemCalcBy?: string;
  estimatedGemValue?: string;
  estimatedLabourCharges?: string;
  bodyMakingRateType?: string;
  stoneSettingRateType?: string;
  comments?: string;
};

async function productNameMap(productIds: Array<number | null | undefined>) {
  const ids = Array.from(new Set(productIds.filter((id): id is number => typeof id === "number" && id > 0)));
  if (!ids.length) return new Map<number, any>();
  const products = await ProductModel.find({ id: { $in: ids } }).lean();
  return new Map(products.map(product => [product.id, product]));
}

function orderItemRow(item: any, productMap?: Map<number, any>) {
  const withName = {
    ...item,
    itemName: item.itemName || (item.productId ? productMap?.get(item.productId)?.name : undefined) || "Item",
  };
  return toRow(orderItemsTable, withName);
}

export async function getOrderItems(orderId: number) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).sort({ id: 1 }).lean();
  const productMap = await productNameMap(items.map(item => item.productId));

  return items.map(item => ({
    orderItem: orderItemRow(item, productMap),
    product: item.productId ? toRowOrNull(productsTable, productMap.get(item.productId)) : null,
  }));
}

export async function getOrderItemsRaw(orderId: number) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).sort({ id: 1 }).lean();
  const productMap = await productNameMap(items.map(item => item.productId));
  return items.map(item => orderItemRow(item, productMap));
}

export async function addOrderItems(orderId: number, items: OrderItemInput[]) {
  await connectDb();
  const created = [];
  for (const item of items) {
    const { productId, vendorId, ...rest } = item;
    const doc = {
      id: await getNextSequence("order_items"),
      orderId,
      ...cleanDecimals(rest, ORDER_ITEM_DECIMALS),
      // Only keep references that point at real records (0 means "manual item").
      ...(productId && productId > 0 ? { productId } : {}),
      ...(vendorId && vendorId > 0 ? { vendorId } : {}),
    };
    const saved = await OrderItemModel.create(doc);
    created.push(orderItemRow(saved.toObject()));
  }
  return created;
}

export async function deleteOrderItems(orderId: number) {
  await connectDb();
  await OrderItemModel.deleteMany({ orderId });
}

// Dashboard statistics
export async function getDashboardStats() {
  await connectDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [catalogCount, productCount, customerCount, currentMonthOrders, productionOrders] = await Promise.all([
    CatalogModel.countDocuments(),
    ProductModel.countDocuments({ isActive: true }),
    CustomerModel.countDocuments(),
    OrderModel.countDocuments({ orderDate: { $gte: startOfMonth } }),
    OrderModel.countDocuments({ status: "production" }),
  ]);

  return {
    catalogs: catalogCount,
    products: productCount,
    customers: customerCount,
    currentMonthOrders,
    productionOrders,
  };
}

// Generate unique order number
async function nextPrefixedNumber(
  model: mongoose.Model<any>,
  field: string,
  prefix: string
): Promise<string> {
  // Seed the atomic counter from the highest existing number once, then rely on $inc
  // so two concurrent requests can never receive the same number.
  const counterName = `${field}_${prefix}`;
  const existingCounter = await Counter.findOne({ name: counterName }).lean();
  if (!existingCounter) {
    const last = await model
      .findOne({ [field]: { $regex: `^${prefix}\\d{4}$` } })
      .sort({ [field]: -1 })
      .lean<Record<string, string>>();
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

export async function generateOrderNumber() {
  await connectDb();
  const now = new Date();
  const prefix = `JO${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  return nextPrefixedNumber(OrderModel, "orderNumber", prefix);
}

// Collections
export async function getAllCollections(filters?: { search?: string; isActive?: boolean }) {
  await connectDb();
  const query: Record<string, unknown> = {};
  if (filters?.search) query.name = { $regex: filters.search, $options: "i" };
  if (filters?.isActive !== undefined) query.isActive = filters.isActive;
  return CollectionModel.find(query).sort({ name: 1 }).lean();
}

export async function getCollectionById(id: number) {
  await connectDb();
  return CollectionModel.findOne({ id }).lean();
}

export async function createCollection(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("collections");
  const created = await CollectionModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

export async function updateCollection(id: number, data: Record<string, unknown>) {
  await connectDb();
  await CollectionModel.updateOne({ id }, { $set: data });
  return await getCollectionById(id);
}

export async function deleteCollection(id: number) {
  await connectDb();
  await CollectionProductModel.deleteMany({ collectionId: id });
  await CollectionModel.deleteOne({ id });
}

export async function getCollectionProducts(collectionId: number) {
  await connectDb();
  const collectionProducts = await CollectionProductModel.find({ collectionId })
    .sort({ sortOrder: 1 })
    .lean();
  const productIds = collectionProducts.map(cp => cp.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const categories = await CategoryModel.find({ id: { $in: products.map(p => p.categoryId).filter(Boolean) } }).lean();

  const productMap = new Map(products.map(product => [product.id, product]));
  const categoryMap = new Map(categories.map(category => [category.id, category]));

  return collectionProducts.map(collectionProduct => {
    const product = productMap.get(collectionProduct.productId);
    const category = product?.categoryId ? categoryMap.get(product.categoryId) ?? null : null;
    return { collectionProduct, product, category };
  });
}

export async function addProductsToCollection(collectionId: number, productIds: number[]) {
  await connectDb();
  if (!productIds.length) return;

  const values = [];
  for (let i = 0; i < productIds.length; i++) {
    values.push({
      id: await getNextSequence("collection_products"),
      collectionId,
      productId: productIds[i],
      sortOrder: i,
    });
  }

  await CollectionProductModel.insertMany(values);
  await CollectionModel.updateOne(
    { id: collectionId },
    { $set: { productCount: await CollectionProductModel.countDocuments({ collectionId }) } }
  );
}

export async function removeProductFromCollection(collectionId: number, productId: number) {
  await connectDb();
  await CollectionProductModel.deleteOne({ collectionId, productId });
  await CollectionModel.updateOne(
    { id: collectionId },
    { $set: { productCount: await CollectionProductModel.countDocuments({ collectionId }) } }
  );
}

export async function getProductCollections(productId: number) {
  await connectDb();
  const collectionProducts = await CollectionProductModel.find({ productId }).lean();
  const collectionIds = collectionProducts.map(cp => cp.collectionId);
  return CollectionModel.find({ id: { $in: collectionIds } }).lean();
}

// ============ VENDOR FUNCTIONS ============

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getAllVendors(filters?: { search?: string; isActive?: boolean }) {
  await connectDb();
  const query: Record<string, unknown> = {};
  if (filters?.search) query.name = { $regex: escapeRegex(filters.search), $options: "i" };
  if (filters?.isActive !== undefined) query.isActive = filters.isActive;
  const vendors = await VendorModel.find(query).sort({ createdAt: -1, id: -1 }).lean();
  return toRows(vendorsTable, vendors);
}

export async function getVendorById(id: number) {
  await connectDb();
  return toRowOrNull(vendorsTable, await VendorModel.findOne({ id }).lean());
}

export async function createVendor(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("vendors");
  const code = (data.code as string | undefined) || `VN${String(id).padStart(6, "0")}`;
  const created = await VendorModel.create({ ...cleanDecimals(data, []), id, code });
  return toRow(vendorsTable, created.toObject());
}

export async function updateVendor(id: number, data: Record<string, unknown>) {
  await connectDb();
  await VendorModel.updateOne({ id }, { $set: cleanDecimals(data, []) });
  return await getVendorById(id);
}

/**
 * Vendors are never hard-deleted: they may be referenced by order items,
 * production processes and ledger postings. Deleting deactivates the vendor
 * (and its ledger, handled in financeDb.deactivateVendorLedger).
 */
export async function deleteVendor(id: number) {
  await connectDb();
  await VendorModel.updateOne({ id }, { $set: { isActive: false } });
}

/** Vendor code is derived from the vendor's own id inside createVendor. Kept for API compatibility. */
export async function generateVendorCode() {
  return undefined;
}

// ============ ORDER PROCESS FUNCTIONS ============

const PROCESS_DECIMALS = [
  "issueBodyWeight",
  "returnBodyWeight",
  "gemsIssueWeight",
  "gemsReturnWeight",
  "lumpSumLabour",
] as const;

async function withVendors(processes: any[]) {
  const vendorIds = Array.from(new Set(processes.map(p => p.vendorId).filter(Boolean)));
  const vendors = vendorIds.length ? await VendorModel.find({ id: { $in: vendorIds } }).lean() : [];
  const vendorMap = new Map(vendors.map(vendor => [vendor.id, vendor]));
  return processes.map(process => ({
    process: toRow(orderProcessesTable, process),
    vendor: process.vendorId ? toRowOrNull(vendorsTable, vendorMap.get(process.vendorId)) : null,
  }));
}

export async function getOrderProcesses(orderId: number) {
  await connectDb();
  const processes = await OrderProcessModel.find({ orderId }).sort({ createdAt: 1, id: 1 }).lean();
  return withVendors(processes);
}

export async function getProcessById(id: number) {
  await connectDb();
  const process = await OrderProcessModel.findOne({ id }).lean();
  if (!process) return null;
  const [row] = await withVendors([process]);
  return row;
}

export async function createOrderProcess(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("order_processes");
  const created = await OrderProcessModel.create({ id, ...cleanDecimals(data, PROCESS_DECIMALS) });
  return toRow(orderProcessesTable, created.toObject());
}

export async function updateOrderProcess(id: number, data: Record<string, unknown>) {
  await connectDb();
  await OrderProcessModel.updateOne({ id }, { $set: cleanDecimals(data, PROCESS_DECIMALS) });
  return await getProcessById(id);
}

export async function deleteOrderProcess(id: number) {
  await connectDb();
  await OrderProcessModel.deleteOne({ id });
}

// ============ ORDER ADVANCE METALS/GEMS ============

export async function getOrderAdvanceMetals(orderId: number) {
  await connectDb();
  const rows = await OrderAdvanceMetalModel.find({ orderId }).sort({ id: 1 }).lean();
  return toRows(orderAdvanceMetalsTable, rows);
}

export async function getOrderAdvanceMetalById(id: number) {
  await connectDb();
  return toRowOrNull(orderAdvanceMetalsTable, await OrderAdvanceMetalModel.findOne({ id }).lean());
}

export async function addOrderAdvanceMetal(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("order_advance_metals");
  const created = await OrderAdvanceMetalModel.create({
    id,
    ...cleanDecimals(data, ["weight", "netWeightRate", "value"]),
  });
  return toRow(orderAdvanceMetalsTable, created.toObject());
}

export async function deleteOrderAdvanceMetal(id: number) {
  await connectDb();
  await OrderAdvanceMetalModel.deleteOne({ id });
}

export async function getOrderAdvanceGems(orderId: number) {
  await connectDb();
  const rows = await OrderAdvanceGemModel.find({ orderId }).sort({ id: 1 }).lean();
  return toRows(orderAdvanceGemsTable, rows);
}

export async function addOrderAdvanceGem(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("order_advance_gems");
  const created = await OrderAdvanceGemModel.create({ id, ...cleanDecimals(data, ["weight"]) });
  return toRow(orderAdvanceGemsTable, created.toObject());
}

export async function deleteOrderAdvanceGem(id: number) {
  await connectDb();
  await OrderAdvanceGemModel.deleteOne({ id });
}

// ============ ORDER INVOICE FUNCTIONS ============

const INVOICE_DECIMALS = ["metalValue", "stoneValue", "makingCharges", "otherCharges", "discount", "totalAmount"] as const;
const INVOICE_ITEM_DECIMALS = ["weight", "wastage", "netWeight", "rate", "amount"] as const;

export async function getAllInvoices() {
  await connectDb();
  const invoices = await OrderInvoiceModel.find({}).sort({ invoiceDate: -1, id: -1 }).lean();
  const orderIds = Array.from(new Set(invoices.map(invoice => invoice.orderId)));
  const customerIds = Array.from(new Set(invoices.map(invoice => invoice.customerId).filter(Boolean)));
  const [orders, customers] = await Promise.all([
    OrderModel.find({ id: { $in: orderIds } }, { id: 1, orderNumber: 1 }).lean(),
    CustomerModel.find({ id: { $in: customerIds } }, { id: 1, firstName: 1, lastName: 1 }).lean(),
  ]);
  const orderMap = new Map(orders.map(order => [order.id, order]));
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  return invoices.map(invoice => {
    const customer = invoice.customerId ? customerMap.get(invoice.customerId) : undefined;
    return {
      invoice: toRow(orderInvoicesTable, invoice),
      orderNumber: (orderMap.get(invoice.orderId)?.orderNumber as string | undefined) ?? null,
      customerFirstName: (customer?.firstName as string | undefined) ?? null,
      customerLastName: (customer?.lastName as string | undefined) ?? null,
    };
  });
}

export async function getOrderInvoices(orderId: number) {
  await connectDb();
  const invoices = await OrderInvoiceModel.find({ orderId }).sort({ createdAt: -1, id: -1 }).lean();
  return toRows(orderInvoicesTable, invoices);
}

export async function getInvoiceById(id: number) {
  await connectDb();
  return toRowOrNull(orderInvoicesTable, await OrderInvoiceModel.findOne({ id }).lean());
}

export async function createInvoice(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("order_invoices");
  const created = await OrderInvoiceModel.create({ id, ...cleanDecimals(data, INVOICE_DECIMALS) });
  return toRow(orderInvoicesTable, created.toObject());
}

export async function updateInvoice(id: number, data: Record<string, unknown>) {
  await connectDb();
  await OrderInvoiceModel.updateOne({ id }, { $set: cleanDecimals(data, INVOICE_DECIMALS) });
  return await getInvoiceById(id);
}

export async function getInvoiceItems(invoiceId: number) {
  await connectDb();
  const items = await OrderInvoiceItemModel.find({ invoiceId }).sort({ sortOrder: 1, id: 1 }).lean();
  return toRows(orderInvoiceItemsTable, items);
}

export async function addInvoiceItems(invoiceId: number, items: Array<Record<string, unknown>>) {
  await connectDb();
  const docs = [];
  for (const item of items) {
    docs.push({
      id: await getNextSequence("order_invoice_items"),
      invoiceId,
      ...cleanDecimals(item, INVOICE_ITEM_DECIMALS),
    });
  }
  if (docs.length) await OrderInvoiceItemModel.insertMany(docs);
}

export async function deleteInvoiceItems(invoiceId: number) {
  await connectDb();
  await OrderInvoiceItemModel.deleteMany({ invoiceId });
}

export async function generateInvoiceNumber() {
  await connectDb();
  const now = new Date();
  const prefix = `INV${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  return nextPrefixedNumber(OrderInvoiceModel, "invoiceNumber", prefix);
}

// ============ ENHANCED ORDER FUNCTIONS ============

export async function getOrderWithDetails(orderId: number) {
  await connectDb();
  const order = await OrderModel.findOne({ id: orderId }).lean();
  if (!order) return null;
  const customer = order.customerId ? await CustomerModel.findOne({ id: order.customerId }).lean() : null;

  const [items, processes, advanceMetals, advanceGems, invoices] = await Promise.all([
    getOrderItemsRaw(orderId),
    getOrderProcesses(orderId),
    getOrderAdvanceMetals(orderId),
    getOrderAdvanceGems(orderId),
    getOrderInvoices(orderId),
  ]);

  return {
    order: orderRow(order),
    customer: toRowOrNull(customersTable, customer),
    items,
    processes,
    advanceMetals,
    advanceGems,
    invoices,
  };
}
