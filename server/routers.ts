import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, operationsFinanceProcedure, publicProcedure, router } from "./_core/trpc";
import { accessRouter, financeRouter } from "./financeRouter";
import { ordersRouter, orderAdvancesHelpers } from "./ordersRouter";
import * as financeDb from "./financeDb";
import { z } from "zod";
import { nanoid } from "nanoid";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { storeImage } from "./storage";
import { TRPCError } from "@trpc/server";
import { signSession, verifyPassword } from "./_core/auth";

/** Run a data-layer call and surface domain errors (validation/integrity) as 400s. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const message = (error as Error)?.message || "Request failed";
    throw new TRPCError({ code: "BAD_REQUEST", message, cause: error });
  }
}

const optionalDate = z.string().optional().refine(
  value => !value || !Number.isNaN(new Date(value).getTime()),
  "Invalid date"
);

export const appRouter = router({
  system: systemRouter,
  access: accessRouter,
  finance: financeRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByEmail(input.email);
        const isValid = user ? await verifyPassword(input.password, user.passwordHash) : false;
        if (!user || !isValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        }
        if (user.isActive === false) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This account has been deactivated. Contact your Super Admin." });
        }

        await db.updateUserLastSignedIn(user.id);

        const token = await signSession({
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name ?? null,
            role: user.role,
          },
        };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Dashboard
  dashboard: router({
    stats: operationsFinanceProcedure.query(async () => {
      return await db.getDashboardStats();
    }),
  }),

  // Gold Prices
  goldPrice: router({
    getToday: operationsFinanceProcedure.query(async () => {
      return await db.getTodayGoldPrice();
    }),
    getLatest: operationsFinanceProcedure.query(async () => {
      return await db.getLatestGoldPrice();
    }),
    set: operationsFinanceProcedure
      .input(z.object({
        price22k: z.coerce.string(),
        price24k: z.coerce.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.setGoldPrice({
          ...input,
          userId: ctx.user.id,
        });
      }),
  }),

  // Categories
  categories: router({
    list: adminProcedure.query(async () => {
      return await db.getAllCategories();
    }),
  }),

  // Products
  products: router({
    list: adminProcedure
      .input(z.object({
        categoryId: z.number().optional(),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllProducts(input);
      }),
    
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getProductById(input.id);
      }),
    
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        sku: z.string().optional(),
        categoryId: z.number().optional(),
        goldKarat: z.enum(["22k", "24k"]).optional(),
        goldWeight: z.string().optional(),
        goldWastage: z.string().optional(),
        goldRateAtOrder: z.string().optional(),
        makingCharges: z.string().optional(),
        makingChargesType: z.enum(["fixed", "per_gram"]).optional(),
        diamondWeight: z.string().optional(),
        diamondRate: z.string().optional(),
        diamondPrice: z.string().optional(),
        stoneType: z.string().optional(),
        stoneWeight: z.string().optional(),
        stoneRate: z.string().optional(),
        stonePrice: z.string().optional(),
        images: z.string().optional(),
        primaryImage: z.string().optional(),
        basePrice: z.string().optional(),
        totalPrice: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createProduct({
          ...input,
          createdBy: ctx.user.id,
        });
      }),
    
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        sku: z.string().optional(),
        categoryId: z.number().nullable().optional(),
        goldKarat: z.enum(["22k", "24k"]).nullable().optional(),
        goldWeight: z.string().optional(),
        goldWastage: z.string().optional(),
        goldRateAtOrder: z.string().optional(),
        makingCharges: z.string().optional(),
        makingChargesType: z.enum(["fixed", "per_gram"]).optional(),
        diamondWeight: z.string().optional(),
        diamondRate: z.string().optional(),
        diamondPrice: z.string().optional(),
        stoneType: z.string().optional(),
        stoneWeight: z.string().optional(),
        stoneRate: z.string().optional(),
        stonePrice: z.string().optional(),
        images: z.string().optional(),
        primaryImage: z.string().optional(),
        basePrice: z.string().optional(),
        totalPrice: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateProduct(id, data);
      }),
    
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteProduct(input.id);
        return { success: true };
      }),
  }),

  // Customers
  customers: router({
    list: operationsFinanceProcedure
      .input(z.object({
        search: z.string().optional(),
        paymentStatus: z.enum(["paid", "unpaid"]).optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCustomers(input);
      }),
    
    getById: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getCustomerById(input.id);
      }),
    
    create: operationsFinanceProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        paymentStatus: z.enum(["paid", "unpaid"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const customer = await db.createCustomer({
          ...input,
          email: input.email || null,
          createdBy: ctx.user.id,
        });
        await financeDb.ensureCustomerLedger(customer.id, ctx.user.id);
        return customer;
      }),
    
    update: operationsFinanceProcedure
      .input(z.object({
        id: z.number(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        paymentStatus: z.enum(["paid", "unpaid"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const updated = await db.updateCustomer(id, {
          ...data,
          ...(data.email !== undefined ? { email: data.email || null } : {}),
        });
        if (data.firstName !== undefined || data.lastName !== undefined) {
          await financeDb.syncCustomerLedgerTitle(id);
        }
        return updated;
      }),
    
    delete: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await guard(async () => {
          await financeDb.assertCustomerLedgerDeletable(input.id);
          await db.deleteCustomer(input.id); // refuses customers with orders or invoices
          await financeDb.removeCustomerLedger(input.id, ctx.user.id);
        });
        return { success: true };
      }),
  }),

  // Catalogs
  catalogs: router({
    list: adminProcedure
      .input(z.object({
        search: z.string().optional(),
        status: z.string().optional(),
        customerId: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCatalogs(input);
      }),
    
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const catalog = await db.getCatalogById(input.id);
        if (!catalog) return null;
        
        const products = await db.getCatalogProducts(input.id);
        const comments = await db.getCatalogComments(input.id);
        const likes = await db.getCatalogLikes(input.id);
        
        return { ...catalog, products, comments, likes };
      }),
    
    getByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const catalog = await db.getCatalogByToken(input.token);
        if (!catalog) return null;
        
        const products = await db.getCatalogProducts(catalog.catalog.id);
        const likes = await db.getCatalogLikes(catalog.catalog.id);
        
        return { ...catalog, products, likes };
      }),
    
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        productType: z.string().optional(),
        customFields: z.string().optional(),
        customerId: z.number().nullable().optional(),
        isPublic: z.boolean().optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        productIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { productIds, ...catalogData } = input;
        const publicToken = nanoid(16);
        
        const catalog = await db.createCatalog({
          ...catalogData,
          publicToken,
          createdBy: ctx.user.id,
        });
        
        if (productIds && productIds.length > 0) {
          await db.addProductsToCatalog(catalog.id, productIds);
        }
        
        return catalog;
      }),
    
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        productType: z.string().optional(),
        customFields: z.string().optional(),
        customerId: z.number().nullable().optional(),
        isPublic: z.boolean().optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        productIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, productIds, ...data } = input;
        
        const catalog = await db.updateCatalog(id, data);
        
        if (productIds !== undefined) {
          await db.updateCatalogProducts(id, productIds);
        }
        
        return catalog;
      }),
    
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCatalog(input.id);
        return { success: true };
      }),
    
    // Public actions for catalog preview
    like: publicProcedure
      .input(z.object({
        catalogId: z.number(),
        productId: z.number(),
        visitorId: z.string(),
      }))
      .mutation(async ({ input }) => {
        return await db.addCatalogLike(input);
      }),
    
    comment: publicProcedure
      .input(z.object({
        catalogId: z.number(),
        productId: z.number().optional(),
        visitorName: z.string().optional(),
        comment: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        return await db.addCatalogComment(input);
      }),
    
    getComments: adminProcedure
      .input(z.object({ catalogId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCatalogComments(input.catalogId);
      }),
    
    markCommentRead: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.markCommentAsRead(input.id);
        return { success: true };
      }),
  }),

  // Collections
  collections: router({
    list: adminProcedure
      .input(z.object({
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCollections(input);
      }),
    
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const collection = await db.getCollectionById(input.id);
        if (!collection) return null;
        
        const products = await db.getCollectionProducts(input.id);
        return { ...collection, products };
      }),
    
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        productIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { productIds, ...collectionData } = input;
        
        const collection = await db.createCollection({
          ...collectionData,
          createdBy: ctx.user.id,
        });
        
        if (productIds && productIds.length > 0) {
          await db.addProductsToCollection(collection.id, productIds);
        }
        
        return collection;
      }),
    
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        isActive: z.boolean().optional(),
        productIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, productIds, ...data } = input;
        
        const collection = await db.updateCollection(id, data);
        
        // If productIds provided, update the collection products
        if (productIds !== undefined) {
          // Remove all existing and add new
          const existing = await db.getCollectionProducts(id);
          for (const p of existing) {
            await db.removeProductFromCollection(id, p.collectionProduct.productId);
          }
          if (productIds.length > 0) {
            await db.addProductsToCollection(id, productIds);
          }
        }
        
        return collection;
      }),
    
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCollection(input.id);
        return { success: true };
      }),
    
    addProducts: adminProcedure
      .input(z.object({
        collectionId: z.number(),
        productIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await db.addProductsToCollection(input.collectionId, input.productIds);
        return { success: true };
      }),
    
    removeProduct: adminProcedure
      .input(z.object({
        collectionId: z.number(),
        productId: z.number(),
      }))
      .mutation(async ({ input }) => {
        await db.removeProductFromCollection(input.collectionId, input.productId);
        return { success: true };
      }),
  }),

  // Orders
  orders: ordersRouter,

  // File Upload
  upload: router({
    // Order item photos (Operations & Finance) and catalog covers (Super Admin).
    image: operationsFinanceProcedure
      .input(z.object({
        base64: z.string(),
        filename: z.string().max(200),
        contentType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(input.contentType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only PNG, JPG, WEBP or GIF images can be uploaded" });
        }
        const base64Data = input.base64.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length > 5 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Image is larger than 5 MB" });
        }
        return storeImage("uploads", buffer, input.contentType, input.filename, ctx.user.id);
      }),
  }),

  // Vendors
  vendors: router({
    list: operationsFinanceProcedure
      .input(z.object({ search: z.string().optional(), isActive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return await db.getAllVendors(input || undefined);
      }),
    
    getById: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getVendorById(input.id);
      }),
    
    create: operationsFinanceProcedure
      .input(z.object({
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        specialization: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const vendor = await db.createVendor({ ...input, createdBy: ctx.user.id });
        await financeDb.ensureVendorLedger(vendor.id, ctx.user.id);
        return vendor;
      }),
    
    update: operationsFinanceProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        specialization: z.string().optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const vendor = await db.updateVendor(id, data);
        if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
        await financeDb.ensureVendorLedger(id, ctx.user.id);
        await financeDb.syncVendorLedger(id);
        return vendor;
      }),
    
    // Vendors are deactivated (never hard-deleted) because orders, production and ledgers reference them.
    delete: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await db.deleteVendor(input.id);
        await financeDb.deactivateVendorLedger(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // Order Processes
  orderProcesses: router({
    list: operationsFinanceProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderProcesses(input.orderId);
      }),
    
    getById: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getProcessById(input.id);
      }),
    
    create: operationsFinanceProcedure
      .input(z.object({
        orderId: z.number(),
        orderItemId: z.number().optional(),
        itemName: z.string().optional(),
        processType: z.string(),
        vendorId: z.number().optional(),
        startDate: z.string().optional(),
        expectedDeliveryDate: z.string().optional(),
        comments: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const order = await db.getOrderById(input.orderId);
        if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "Order not found" });
        if (input.vendorId && !(await db.getVendorById(input.vendorId))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Vendor not found" });
        }
        const data: Record<string, unknown> = { ...input };
        if (input.startDate) data.startDate = new Date(input.startDate);
        if (input.expectedDeliveryDate) data.expectedDeliveryDate = new Date(input.expectedDeliveryDate);
        data.status = 'pending';
        return await db.createOrderProcess(data);
      }),
    
    update: operationsFinanceProcedure
      .input(z.object({
        id: z.number(),
        vendorId: z.number().optional(),
        startDate: z.string().optional(),
        expectedDeliveryDate: z.string().optional(),
        actualDeliveryDate: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'complete']).optional(),
        issueBodyWeight: z.string().optional(),
        returnBodyMetal: z.string().optional(),
        returnBodyWeight: z.string().optional(),
        returnBodyPieces: z.number().optional(),
        gemsIssueType: z.string().optional(),
        gemsIssueSource: z.string().optional(),
        gemsIssueDate: z.string().optional(),
        gemsIssueWeight: z.string().optional(),
        gemsIssueQty: z.number().optional(),
        gemsReturnWeight: z.string().optional(),
        gemsReturnQty: z.number().optional(),
        gemsReturnDate: z.string().optional(),
        lumpSumLabour: z.string().optional(),
        comments: z.string().optional(),
        isClosed: z.boolean().optional(),
        closedDate: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        const data: any = { ...rest };
        if (rest.startDate) data.startDate = new Date(rest.startDate);
        if (rest.expectedDeliveryDate) data.expectedDeliveryDate = new Date(rest.expectedDeliveryDate);
        if (rest.actualDeliveryDate) data.actualDeliveryDate = new Date(rest.actualDeliveryDate);
        if (rest.gemsIssueDate) data.gemsIssueDate = new Date(rest.gemsIssueDate);
        if (rest.gemsReturnDate) data.gemsReturnDate = new Date(rest.gemsReturnDate);
        if (rest.closedDate) data.closedDate = new Date(rest.closedDate);
        return await db.updateOrderProcess(id, data);
      }),
    
    delete: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteOrderProcess(input.id);
        return { success: true };
      }),
  }),

  // Order Advance Materials
  orderAdvances: router({
    getMetals: operationsFinanceProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderAdvanceMetals(input.orderId);
      }),
    
    addMetal: operationsFinanceProcedure
      .input(z.object({
        orderId: z.number(),
        itemName: z.string().optional(),
        receivedDate: optionalDate,
        weight: z.string().optional(),
        alloy: z.string().optional(),
        wastage: z.string().optional(),
        wastageType: z.enum(["percent", "ratti"]).optional(),
        netWeightRate: z.string().optional(),
        value: z.string().optional(),
        comments: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const existing = await db.getOrderById(input.orderId);
        if (!existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Order not found" });
        const { orderId, ...metal } = input;
        const data = orderAdvancesHelpers.normalizeMetal(metal);
        if (Number(data.value || 0) > 0 && !existing.order.customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Assign a customer to the order before recording a valued metal advance" });
        }
        const created = await db.addOrderAdvanceMetal({ ...data, orderId });
        await orderAdvancesHelpers.syncOrderPostings(orderId, ctx.user, "Metal advance added");
        return created;
      }),
    
    deleteMetal: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await orderAdvancesHelpers.reverseMetalAdvance(input.id, ctx.user, "Metal advance deleted");
        await db.deleteOrderAdvanceMetal(input.id);
        return { success: true };
      }),
    
    getGems: operationsFinanceProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderAdvanceGems(input.orderId);
      }),
    
    addGem: operationsFinanceProcedure
      .input(z.object({
        orderId: z.number(),
        itemName: z.string().optional(),
        qty: z.number().optional(),
        weight: z.string().optional(),
        comments: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.addOrderAdvanceGem(input);
      }),
    
    deleteGem: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteOrderAdvanceGem(input.id);
        return { success: true };
      }),
  }),

  // Order Invoices
  invoices: router({
    list: operationsFinanceProcedure.query(async () => {
      return await db.getAllInvoices();
    }),

    listByOrder: operationsFinanceProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderInvoices(input.orderId);
      }),
    
    getById: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const invoice = await db.getInvoiceById(input.id);
        if (!invoice) return null;
        const items = await db.getInvoiceItems(input.id);
        return { ...invoice, items };
      }),
    
    create: operationsFinanceProcedure
      .input(z.object({
        orderId: z.number(),
        customerId: z.number().optional(),
        remarks: z.string().optional(),
        invoiceDate: z.string().optional(),
        metalValue: z.string().optional(),
        stoneValue: z.string().optional(),
        makingCharges: z.string().optional(),
        otherCharges: z.string().optional(),
        discount: z.string().optional(),
        totalAmount: z.string().optional(),
        items: z.array(z.object({
          itemName: z.string(),
          particular: z.string().optional(),
          qty: z.number().optional(),
          weight: z.string().optional(),
          weightUnit: z.string().optional(),
          wastage: z.string().optional(),
          netWeight: z.string().optional(),
          rate: z.string().optional(),
          calculateBy: z.string().optional(),
          amount: z.string().optional(),
          sortOrder: z.number().optional(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { items, ...invoiceData } = input;
        const existing = await db.getOrderById(input.orderId);
        if (!existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Order not found" });
        const customerId = input.customerId ?? existing.order.customerId ?? undefined;
        if (input.customerId && existing.order.customerId && input.customerId !== existing.order.customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice customer must match the Sales Order customer" });
        }

        const orderItems = await db.getOrderItemsRaw(input.orderId);
        const sum = (pick: (item: (typeof orderItems)[number]) => string | null) =>
          orderItems.reduce((total, item) => total + financeDb.moneyToCents(pick(item)), 0);
        const metalCents = input.metalValue !== undefined ? financeDb.moneyToCents(input.metalValue) : sum(item => item.estimatedMetalValue);
        const stoneCents = input.stoneValue !== undefined ? financeDb.moneyToCents(input.stoneValue) : sum(item => item.estimatedGemValue);
        const makingCents = input.makingCharges !== undefined ? financeDb.moneyToCents(input.makingCharges) : sum(item => item.estimatedLabourCharges);
        const otherCents = financeDb.moneyToCents(input.otherCharges);
        const discountCents = financeDb.moneyToCents(input.discount);
        if ([metalCents, stoneCents, makingCents, otherCents, discountCents].some(value => value < 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice amounts cannot be negative" });
        }
        // The total is always derived from its components so the invoice and its ledger posting agree.
        const totalCents = metalCents + stoneCents + makingCents + otherCents - discountCents;
        if (totalCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Discount cannot exceed the invoice value" });
        if (totalCents > 0 && !customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Assign a customer to the Sales Order before invoicing" });
        }

        if (totalCents > 0) {
          await guard(() => financeDb.ensurePostingReady(customerId!, ctx.user.id, ["SA000001"]));
        }

        const invoiceNumber = await db.generateInvoiceNumber();
        const invoice = await db.createInvoice({
          ...invoiceData,
          customerId,
          invoiceNumber,
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
          metalValue: financeDb.centsToMoney(metalCents),
          stoneValue: financeDb.centsToMoney(stoneCents),
          makingCharges: financeDb.centsToMoney(makingCents),
          otherCharges: financeDb.centsToMoney(otherCents),
          discount: financeDb.centsToMoney(discountCents),
          totalAmount: financeDb.centsToMoney(totalCents),
          status: totalCents > 0 ? "sent" : "draft",
          createdBy: ctx.user.id,
        });
        if (items && items.length > 0) {
          await db.addInvoiceItems(invoice.id, items);
        }
        if (totalCents > 0) {
          await financeDb.postInvoiceToLedger(invoice.id, ctx.user.id);
        }
        return (await db.getInvoiceById(invoice.id)) ?? invoice;
      }),
    
    update: operationsFinanceProcedure
      .input(z.object({
        id: z.number(),
        remarks: z.string().optional(),
        metalValue: z.string().optional(),
        stoneValue: z.string().optional(),
        makingCharges: z.string().optional(),
        otherCharges: z.string().optional(),
        discount: z.string().optional(),
        totalAmount: z.string().optional(),
        status: z.enum(['draft', 'sent', 'paid', 'cancelled']).optional(),
        items: z.array(z.object({
          itemName: z.string(),
          particular: z.string().optional(),
          qty: z.number().optional(),
          weight: z.string().optional(),
          weightUnit: z.string().optional(),
          wastage: z.string().optional(),
          netWeight: z.string().optional(),
          rate: z.string().optional(),
          calculateBy: z.string().optional(),
          amount: z.string().optional(),
          sortOrder: z.number().optional(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, items, status, ...amountsAndRemarks } = input;
        const invoice = await db.getInvoiceById(id);
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        const posted = await financeDb.getSourceEntry("order_invoice", id);
        const isLivePosting = posted?.status === "posted";

        const { remarks, totalAmount: _ignoredTotal, ...amounts } = amountsAndRemarks;
        const amountChanges = Object.entries(amounts).filter(
          ([key, value]) => value !== undefined && financeDb.moneyToCents(value) !== financeDb.moneyToCents((invoice as Record<string, any>)[key])
        );
        if (amountChanges.length && isLivePosting) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invoice is posted to the ledger. Cancel it (which reverses the posting) and issue a new invoice to change amounts.",
          });
        }
        if (invoice.status === "cancelled" && (amountChanges.length || (status && status !== "cancelled"))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled invoice cannot be changed or reopened. Issue a new invoice instead." });
        }
        if (status === "draft" && isLivePosting) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A posted invoice cannot go back to draft. Cancel it instead." });
        }
        if (status === "cancelled" && invoice.status !== "cancelled" && isLivePosting && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only a Super Admin can cancel a posted invoice, because it reverses the ledger entry." });
        }

        const update: Record<string, unknown> = { remarks, status };
        if (amountChanges.length) {
          const next = { ...invoice, ...Object.fromEntries(amountChanges) } as Record<string, any>;
          const cents = (key: string) => financeDb.moneyToCents(next[key]);
          const totalCents = cents("metalValue") + cents("stoneValue") + cents("makingCharges") + cents("otherCharges") - cents("discount");
          if (totalCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Discount cannot exceed the invoice value" });
          Object.assign(update, Object.fromEntries(amountChanges), { totalAmount: financeDb.centsToMoney(totalCents) });
        }
        // Moving to sent/paid posts the invoice first, so a failed posting never leaves a "sent" invoice without a ledger entry.
        const statusForPosting = status && status !== "cancelled" && status !== "draft" && !isLivePosting;
        const { status: _deferredStatus, ...fieldsFirst } = update;
        await db.updateInvoice(id, statusForPosting ? fieldsFirst : update);
        if (items) {
          await db.deleteInvoiceItems(id);
          await db.addInvoiceItems(id, items);
        }

        if (status === "cancelled" && invoice.status !== "cancelled" && isLivePosting && posted) {
          await financeDb.reverseJournalEntry(posted.id, `Invoice ${invoice.invoiceNumber || id} cancelled`, ctx.user.id);
        } else if (statusForPosting) {
          const refreshed = await db.getInvoiceById(id);
          if (refreshed && Number(refreshed.totalAmount || 0) > 0) {
            await guard(() => financeDb.postInvoiceToLedger(id, ctx.user.id));
          }
          await db.updateInvoice(id, { status });
        }
        return await db.getInvoiceById(id);
      }),
  }),

  // Enhanced Order Detail
  orderDetail: router({
    get: operationsFinanceProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderWithDetails(input.id);
      }),
    
    getItems: operationsFinanceProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return await db.getOrderItemsRaw(input.orderId);
      }),
  }),

  // JulesBot AI Agent
  julesBot: router({
    // Get greeting with gold news, trends, and weather
    getGreeting: adminProcedure.query(async ({ ctx }) => {
      const goldPrice = await db.getLatestGoldPrice();
      const stats = await db.getDashboardStats();
      
      const systemPrompt = `You are JulesBot, an AI assistant for JULES - a jewelry catalog management platform in Pakistan. 
You help jewelry business owners manage their products, catalogs, and customers.

Current context:
- Today's 22K Gold Price: PKR ${goldPrice?.price22k || 'Not set'} per tola
- Today's 24K Gold Price: PKR ${goldPrice?.price24k || 'Not set'} per tola
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
            { role: "user", content: `Generate a greeting for ${ctx.user.name || 'the user'} who is logging in now.` }
          ],
        });
        
        const greeting = response.choices[0]?.message?.content || "Welcome to JULES!";
        
        return {
          greeting: typeof greeting === 'string' ? greeting : JSON.stringify(greeting),
          goldPrice,
          stats,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error('JulesBot greeting error:', error);
        return {
          greeting: `Welcome back, ${ctx.user.name || 'there'}! 👋\n\nToday's Gold Prices:\n• 22K: PKR ${goldPrice?.price22k || 'Not set'}/tola\n• 24K: PKR ${goldPrice?.price24k || 'Not set'}/tola\n\nYour business at a glance:\n• ${stats.products} products
• ${stats.customers} customers
• ${stats.currentMonthOrders} orders this month\n\nHave a productive day!`,
          goldPrice,
          stats,
          timestamp: new Date().toISOString(),
        };
      }
    }),

    // Chat with JulesBot
    chat: adminProcedure
      .input(z.object({
        message: z.string().min(1),
        conversationHistory: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Get context data
        const goldPrice = await db.getLatestGoldPrice();
        const stats = await db.getDashboardStats();
        const products = await db.getAllProducts();
        const customers = await db.getAllCustomers();
        const catalogs = await db.getAllCatalogs();
        const collections = await db.getAllCollections();
        
        const productList = products.map(p => `- ID:${p.product.id} "${p.product.name}" (Category: ${p.category?.name || 'N/A'}, Karat: ${p.product.goldKarat || 'N/A'}, SKU: ${p.product.sku || 'N/A'}, Price: PKR ${p.product.basePrice || 'N/A'})`).join('\n');
        const customerList = customers.map(c => `- ID:${c.id} "${c.firstName} ${c.lastName || ''}" (Email: ${c.email || 'N/A'}, Phone: ${c.phone || 'N/A'}, City: ${c.city || 'N/A'})`).join('\n');
        const catalogList = catalogs.map(c => `- ${c.catalog.name} (ID: ${c.catalog.id}, Status: ${c.catalog.status}, Token: ${c.catalog.publicToken})`).join('\n');
        const collectionList = collections.map(c => `- ${c.name} (ID: ${c.id}, ${c.productCount || 0} products)`).join('\n');
        
        const systemPrompt = `You are JulesBot, an intelligent AI assistant for JULES - a jewelry catalog management platform.
You can help with:
1. Answering questions about products, collections, catalogs, and customers
2. Creating new catalogs automatically when requested
3. Providing business insights and suggestions
4. Helping with jewelry-related queries

Current Business Data:

**Gold Prices:**
- 22K: PKR ${goldPrice?.price22k || 'Not set'} per tola
- 24K: PKR ${goldPrice?.price24k || 'Not set'} per tola

**Statistics:**
- Total Products: ${stats.products}
- Total Customers: ${stats.customers}
- Total Catalogs: ${stats.catalogs}
- Orders This Month: ${stats.currentMonthOrders}

**Products:**
${productList || 'No products yet'}

**Customers:**
${customerList || 'No customers yet'}

**Catalogs:**
${catalogList || 'No catalogs yet'}

**Collections:**
${collectionList || 'No collections yet'}

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

        const messages: any[] = [
          { role: "system", content: systemPrompt },
        ];
        
        // Add conversation history
        if (input.conversationHistory) {
          messages.push(...input.conversationHistory);
        }
        
        messages.push({ role: "user", content: input.message });

        try {
          const response = await invokeLLM({ messages });
          const assistantMessage = response.choices[0]?.message?.content || "I apologize, I couldn't process that request.";
          const messageStr = typeof assistantMessage === 'string' ? assistantMessage : JSON.stringify(assistantMessage);
          
          // Check if the response contains a catalog creation command
          let catalogCreated = null;
          if (messageStr.includes('CATALOG_CREATE:')) {
            const match = messageStr.match(/CATALOG_CREATE:([^|]+)\|([^|]*)\|([^|]*)\|(.*)/);
            if (match) {
              const [, name, description, productIdsStr, customerIdStr] = match;
              const productIds = productIdsStr ? productIdsStr.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
              const customerId = customerIdStr ? parseInt(customerIdStr.trim()) : null;
              
              // Create the catalog
              const publicToken = nanoid(12);
              const catalog = await db.createCatalog({
                name: name.trim(),
                description: description.trim() || null,
                publicToken,
                customerId: customerId && !isNaN(customerId) ? customerId : null,
                status: 'published',
                isPublic: true,
              });
              
              if (productIds.length > 0) {
                await db.updateCatalogProducts(catalog.id, productIds);
              }
              
              catalogCreated = {
                id: catalog.id,
                name: name.trim(),
                publicToken,
                previewUrl: `/preview/${publicToken}`,
              };
            }
          }
          
          // Clean the response if it contains the command
          const cleanMessage = messageStr.replace(/CATALOG_CREATE:[^\n]+/g, '').trim();
          
          return {
            message: cleanMessage || "I've created the catalog for you!",
            catalogCreated,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          console.error('JulesBot chat error:', error);
          // JulesBot is Super Admin only, so surface a short technical reason to help fix configuration.
          const reason = String((error as Error)?.message || error).replace(/\s+/g, " ").slice(0, 300);
          return {
            message: `I apologize, I'm having trouble processing your request right now. Please try again.\n\n(AI service error: ${reason})`,
            catalogCreated: null,
            timestamp: new Date().toISOString(),
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
