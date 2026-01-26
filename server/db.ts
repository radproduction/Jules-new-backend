import mongoose, { Schema } from "mongoose";
import { ENV } from "./_core/env";
import { hashPassword } from "./_core/auth";
import type { User as AppUser, UserRole } from "./_core/types";

let connected = false;

export async function connectDb() {
  if (connected) return;
  if (!ENV.mongoUri) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }
  await mongoose.connect(ENV.mongoUri);
  connected = true;
}

const ensureModel = <T>(name: string, schema: Schema<T>) =>
  (mongoose.models[name] as mongoose.Model<T>) || mongoose.model<T>(name, schema);

const CounterSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { collection: "counters" }
);

const Counter = ensureModel("Counter", CounterSchema);

async function getNextSequence(name: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  ).lean();
  return counter?.value ?? 1;
}

const withTimestamps = {
  timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
};

const UserSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    lastSignedIn: { type: Date, default: Date.now },
  },
  { ...withTimestamps, collection: "users" }
);

const GoldPriceSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    priceDate: { type: Date, required: true },
    price22k: { type: Number, required: true },
    price24k: { type: Number, required: true },
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "gold_prices" }
);

const CategorySchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    name: { type: String, required: true, unique: true },
    description: { type: String },
  },
  { ...withTimestamps, collection: "categories" }
);

const ProductSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "products" }
);

const CustomerSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "customers" }
);

const CatalogSchema = new Schema(
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
    createdBy: { type: Number },
  },
  { ...withTimestamps, collection: "catalogs" }
);

const CatalogProductSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { ...withTimestamps, collection: "catalog_products" }
);

const CatalogLikeSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    catalogId: { type: Number, required: true },
    productId: { type: Number, required: true },
    visitorId: { type: String },
  },
  { ...withTimestamps, collection: "catalog_likes" }
);

const CatalogCommentSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
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
      default: "pending",
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
    id: { type: Number, unique: true, index: true },
    orderId: { type: Number, required: true },
    productId: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number },
    totalPrice: { type: Number },
  },
  { ...withTimestamps, collection: "order_items" }
);

const CollectionSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
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
    id: { type: Number, unique: true, index: true },
    collectionId: { type: Number, required: true },
    productId: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { ...withTimestamps, collection: "collection_products" }
);

const UserModel = ensureModel("User", UserSchema);
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

type DbUser = {
  id: number;
  email: string;
  passwordHash: string;
  name?: string | null;
  role: UserRole;
};

export async function ensureAdminUser() {
  await connectDb();
  if (!ENV.adminEmail || !ENV.adminPassword) {
    console.warn("[Auth] ADMIN_EMAIL or ADMIN_PASSWORD not configured; skipping admin seed");
    return;
  }

  const existing = await UserModel.findOne({ email: ENV.adminEmail }).lean<DbUser>();
  if (existing) return;

  const id = await getNextSequence("users");
  const passwordHash = await hashPassword(ENV.adminPassword);
  await UserModel.create({
    id,
    email: ENV.adminEmail,
    passwordHash,
    name: ENV.adminName || "Admin",
    role: "admin",
    lastSignedIn: new Date(),
  });
}

export async function getUserById(id: number): Promise<AppUser | null> {
  await connectDb();
  const user = await UserModel.findOne({ id }).lean<DbUser>();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
  };
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  await connectDb();
  return UserModel.findOne({ email }).lean<DbUser>();
}

export async function updateUserLastSignedIn(id: number) {
  await connectDb();
  await UserModel.updateOne({ id }, { $set: { lastSignedIn: new Date() } });
}

// Gold Price functions
export async function getTodayGoldPrice() {
  await connectDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return GoldPriceModel.findOne({ priceDate: { $gte: start, $lte: end } })
    .sort({ priceDate: -1 })
    .lean();
}

export async function getLatestGoldPrice() {
  await connectDb();
  return GoldPriceModel.findOne({}).sort({ priceDate: -1 }).lean();
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
    return { ...existing, ...payload };
  }

  const id = await getNextSequence("gold_prices");
  const created = await GoldPriceModel.create({
    id,
    priceDate: today,
    ...payload,
    createdBy: data.userId,
  });
  return created.toObject();
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
    const regex = new RegExp(filters.search, "i");
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

  const orders = await OrderModel.find(query).sort({ orderDate: -1 }).lean();
  const customerIds = Array.from(new Set(orders.map(order => order.customerId).filter(Boolean)));
  const catalogIds = Array.from(new Set(orders.map(order => order.catalogId).filter(Boolean)));
  const customers = await CustomerModel.find({ id: { $in: customerIds } }).lean();
  const catalogs = await CatalogModel.find({ id: { $in: catalogIds } }).lean();

  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const catalogMap = new Map(catalogs.map(catalog => [catalog.id, catalog]));

  return orders.map(order => ({
    order,
    customer: order.customerId ? customerMap.get(order.customerId) ?? null : null,
    catalog: order.catalogId ? catalogMap.get(order.catalogId) ?? null : null,
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
  return { order, customer, catalog };
}

export async function createOrder(data: Record<string, unknown>) {
  await connectDb();
  const id = await getNextSequence("orders");
  const created = await OrderModel.create({ id, ...data });
  return { id, ...data, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

export async function updateOrder(id: number, data: Record<string, unknown>) {
  await connectDb();
  await OrderModel.updateOne({ id }, { $set: data });
  return await getOrderById(id);
}

export async function deleteOrder(id: number) {
  await connectDb();
  await OrderItemModel.deleteMany({ orderId: id });
  await OrderModel.deleteOne({ id });
}

// Order items
export async function getOrderItems(orderId: number) {
  await connectDb();
  const items = await OrderItemModel.find({ orderId }).lean();
  const productIds = items.map(item => item.productId);
  const products = await ProductModel.find({ id: { $in: productIds } }).lean();
  const productMap = new Map(products.map(product => [product.id, product]));

  return items.map(orderItem => ({
    orderItem,
    product: productMap.get(orderItem.productId) ?? null,
  }));
}

export async function addOrderItems(orderId: number, items: { productId: number; quantity: number; unitPrice: string; totalPrice: string }[]) {
  await connectDb();
  const values = [];
  for (const item of items) {
    values.push({
      id: await getNextSequence("order_items"),
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    });
  }
  if (values.length > 0) {
    await OrderItemModel.insertMany(values);
  }
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
export async function generateOrderNumber() {
  await connectDb();
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, "0");
  const prefix = `JO${year}${month}`;

  const lastOrder = await OrderModel.findOne({ orderNumber: { $regex: `^${prefix}` } })
    .sort({ orderNumber: -1 })
    .lean();

  let sequence = 1;
  if (lastOrder?.orderNumber) {
    const lastSequence = parseInt(lastOrder.orderNumber.slice(-4), 10);
    if (!Number.isNaN(lastSequence)) {
      sequence = lastSequence + 1;
    }
  }

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
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
