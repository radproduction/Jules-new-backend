import { describe, expect, it, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Auto-mock every data-layer function (models stay real but are never queried).
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

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    email: "test@example.com",
    name: "Test User",
    role: "admin",
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

function createPublicContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("Gold Price Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get today's gold price", async () => {
    const mockPrice = {
      id: 1,
      price22k: "245000",
      price24k: "267000",
      priceDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    vi.mocked(db.getTodayGoldPrice).mockResolvedValue(mockPrice);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.goldPrice.getToday();
    
    expect(result).toEqual(mockPrice);
    expect(db.getTodayGoldPrice).toHaveBeenCalled();
  });

  it("should set gold price", async () => {
    vi.mocked(db.setGoldPrice).mockResolvedValue({ success: true } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.goldPrice.set({
      price22k: "245000",
      price24k: "267000",
    });
    
    expect(result.success).toBe(true);
    expect(db.setGoldPrice).toHaveBeenCalled();
  });
});

describe("Categories Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list categories", async () => {
    const mockCategories = [
      { id: 1, name: "Diamonds", description: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, name: "Necklaces", description: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    
    vi.mocked(db.getAllCategories).mockResolvedValue(mockCategories);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.categories.list();
    
    expect(result).toEqual(mockCategories);
    expect(db.getAllCategories).toHaveBeenCalled();
  });
});

describe("Products Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list products", async () => {
    const mockProducts = [
      {
        product: {
          id: 1,
          name: "Diamond Ring",
          sku: "DR001",
          categoryId: 1,
          goldWeight: "10.5",
          goldKarat: "22k",
          totalPrice: "300000",
          isActive: true,
        },
        category: { id: 1, name: "Diamonds" },
      },
    ];
    
    vi.mocked(db.getAllProducts).mockResolvedValue(mockProducts);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.products.list({});
    
    expect(result).toEqual(mockProducts);
    expect(db.getAllProducts).toHaveBeenCalled();
  });

  it("should create a product", async () => {
    vi.mocked(db.createProduct).mockResolvedValue({ id: 1 } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.products.create({
      name: "New Ring",
      categoryId: 1,
      goldWeight: "5.0",
      goldKarat: "22k",
    });
    
    expect(result.id).toBe(1);
    expect(db.createProduct).toHaveBeenCalled();
  });

  it("should update a product", async () => {
    vi.mocked(db.updateProduct).mockResolvedValue({ id: 1, name: "Updated Ring" } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.products.update({
      id: 1,
      name: "Updated Ring",
    });
    
    expect(result.id).toBe(1);
    expect(db.updateProduct).toHaveBeenCalled();
  });

  it("should delete a product", async () => {
    vi.mocked(db.deleteProduct).mockResolvedValue(undefined);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.products.delete({ id: 1 });
    
    expect(result.success).toBe(true);
    expect(db.deleteProduct).toHaveBeenCalledWith(1);
  });
});

describe("Customers Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list customers", async () => {
    const mockCustomers = [
      {
        id: 1,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+92 300 1234567",
        paymentStatus: "paid",
      },
    ];
    
    vi.mocked(db.getAllCustomers).mockResolvedValue(mockCustomers);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.customers.list({});
    
    expect(result).toEqual(mockCustomers);
    expect(db.getAllCustomers).toHaveBeenCalled();
  });

  it("should create a customer", async () => {
    vi.mocked(db.createCustomer).mockResolvedValue({ id: 1 } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.customers.create({
      firstName: "Jane",
      lastName: "Doe",
      paymentStatus: "unpaid",
    });
    
    expect(result.id).toBe(1);
    expect(db.createCustomer).toHaveBeenCalled();
  });

  it("should update a customer", async () => {
    vi.mocked(db.updateCustomer).mockResolvedValue({ id: 1, paymentStatus: "paid" } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.customers.update({
      id: 1,
      paymentStatus: "paid",
    });
    
    expect(result.id).toBe(1);
    expect(db.updateCustomer).toHaveBeenCalled();
  });

  it("should delete a customer", async () => {
    vi.mocked(db.deleteCustomer).mockResolvedValue(undefined);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.customers.delete({ id: 1 });
    
    expect(result.success).toBe(true);
    expect(db.deleteCustomer).toHaveBeenCalledWith(1);
  });
});

describe("Catalogs Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list catalogs", async () => {
    const mockCatalogs = [
      {
        catalog: {
          id: 1,
          name: "Summer Collection",
          status: "published",
          publicToken: "abc123",
        },
        customer: null,
      },
    ];
    
    vi.mocked(db.getAllCatalogs).mockResolvedValue(mockCatalogs);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.catalogs.list({});
    
    expect(result).toEqual(mockCatalogs);
    expect(db.getAllCatalogs).toHaveBeenCalled();
  });

  it("should create a catalog", async () => {
    vi.mocked(db.createCatalog).mockResolvedValue({ id: 1, publicToken: "token123" } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.catalogs.create({
      name: "New Catalog",
      isPublic: true,
      status: "draft",
    });
    
    expect(result.id).toBe(1);
    expect(result.publicToken).toBe("token123");
    expect(db.createCatalog).toHaveBeenCalled();
  });

  it("should get catalog by public token (public access)", async () => {
    const mockCatalogBase = {
      catalog: {
        id: 1,
        name: "Public Catalog",
        isPublic: true,
        publicToken: "public123",
      },
      customer: null,
    };
    
    vi.mocked(db.getCatalogByToken).mockResolvedValue(mockCatalogBase as any);
    vi.mocked(db.getCatalogProducts).mockResolvedValue([]);
    vi.mocked(db.getCatalogLikes).mockResolvedValue([]);
    
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.catalogs.getByToken({ token: "public123" });
    
    expect(result?.catalog.id).toBe(1);
    expect(result?.catalog.name).toBe("Public Catalog");
    expect(db.getCatalogByToken).toHaveBeenCalledWith("public123");
  });

  it("should add like to catalog (public access)", async () => {
    vi.mocked(db.addCatalogLike).mockResolvedValue({ liked: true });
    
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.catalogs.like({
      catalogId: 1,
      productId: 1,
      visitorId: "visitor123",
    });
    
    expect(result.liked).toBe(true);
    expect(db.addCatalogLike).toHaveBeenCalled();
  });

  it("should add comment to catalog (public access)", async () => {
    vi.mocked(db.addCatalogComment).mockResolvedValue({ id: 1, comment: "Beautiful piece!" } as any);
    
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.catalogs.comment({
      catalogId: 1,
      productId: 1,
      visitorName: "John",
      comment: "Beautiful piece!",
    });
    
    expect(result.id).toBe(1);
    expect(db.addCatalogComment).toHaveBeenCalled();
  });
});

describe("Orders Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list orders", async () => {
    const mockOrders = [
      {
        order: {
          id: 1,
          orderNumber: "ORD-001",
          status: "pending",
          totalPrice: "500000",
        },
        customer: { firstName: "John", lastName: "Doe" },
        catalog: { name: "Summer Collection" },
      },
    ];
    
    vi.mocked(db.getAllOrders).mockResolvedValue(mockOrders);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.orders.list({});
    
    expect(result).toEqual(mockOrders);
    expect(db.getAllOrders).toHaveBeenCalled();
  });

  it("should create an order", async () => {
    vi.mocked(db.getCustomerById).mockResolvedValue({ id: 1, firstName: "John" } as any);
    vi.mocked(db.generateOrderNumber).mockResolvedValue("ORD-001");
    vi.mocked(db.createOrder).mockResolvedValue({ id: 1, orderNumber: "ORD-001" } as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.orders.create({
      customerId: 1,
      status: "pending",
    });
    
    expect(result.id).toBe(1);
    expect(result.orderNumber).toBe("ORD-001");
    expect(db.createOrder).toHaveBeenCalled();
  });

  it("should update an order", async () => {
    vi.mocked(db.getOrderById).mockResolvedValue({
      order: { id: 1, status: "pending", orderNumber: "ORD-001", customerId: null, advanceCash: "0.00" },
      customer: null,
      catalog: null,
    } as any);
    const mockUpdatedOrder = {
      order: { id: 1, status: "production", orderNumber: "ORD-001" },
      customer: null,
      catalog: null,
    };
    vi.mocked(db.updateOrder).mockResolvedValue(mockUpdatedOrder as any);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.orders.update({
      id: 1,
      status: "production",
    });
    
    expect(result).toEqual(mockUpdatedOrder);
    expect(db.updateOrder).toHaveBeenCalled();
  });

  it("should delete an order", async () => {
    vi.mocked(db.getOrderAdvanceMetals).mockResolvedValue([]);
    vi.mocked(db.deleteOrder).mockResolvedValue(undefined);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.orders.delete({ id: 1 });
    
    expect(result.success).toBe(true);
    expect(db.deleteOrder).toHaveBeenCalledWith(1);
  });
});

describe("Dashboard Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get dashboard stats", async () => {
    const mockStats = {
      totalCatalogs: 5,
      totalProducts: 50,
      totalCustomers: 20,
      ordersThisMonth: 10,
      ordersInProduction: 3,
    };
    
    vi.mocked(db.getDashboardStats).mockResolvedValue(mockStats);
    
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    
    const result = await caller.dashboard.stats();
    
    expect(result).toEqual(mockStats);
    expect(db.getDashboardStats).toHaveBeenCalled();
  });
});
