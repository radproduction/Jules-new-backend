import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { nanoid } from "nanoid";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { signSession, verifyPassword } from "./_core/auth";

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByEmail(input.email);
        if (!user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        }

        const isValid = await verifyPassword(input.password, user.passwordHash);
        if (!isValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
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
    stats: protectedProcedure.query(async () => {
      return await db.getDashboardStats();
    }),
  }),

  // Gold Prices
  goldPrice: router({
    getToday: protectedProcedure.query(async () => {
      return await db.getTodayGoldPrice();
    }),
    getLatest: protectedProcedure.query(async () => {
      return await db.getLatestGoldPrice();
    }),
    set: protectedProcedure
      .input(z.object({
        price22k: z.string(),
        price24k: z.string(),
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
    list: protectedProcedure.query(async () => {
      return await db.getAllCategories();
    }),
  }),

  // Products
  products: router({
    list: protectedProcedure
      .input(z.object({
        categoryId: z.number().optional(),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllProducts(input);
      }),
    
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getProductById(input.id);
      }),
    
    create: protectedProcedure
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
    
    update: protectedProcedure
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
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteProduct(input.id);
        return { success: true };
      }),
  }),

  // Customers
  customers: router({
    list: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        paymentStatus: z.enum(["paid", "unpaid"]).optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCustomers(input);
      }),
    
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getCustomerById(input.id);
      }),
    
    create: protectedProcedure
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
        return await db.createCustomer({
          ...input,
          email: input.email || null,
          createdBy: ctx.user.id,
        });
      }),
    
    update: protectedProcedure
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
        return await db.updateCustomer(id, {
          ...data,
          email: data.email || null,
        });
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCustomer(input.id);
        return { success: true };
      }),
  }),

  // Catalogs
  catalogs: router({
    list: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        status: z.string().optional(),
        customerId: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCatalogs(input);
      }),
    
    getById: protectedProcedure
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
    
    create: protectedProcedure
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
    
    update: protectedProcedure
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
    
    delete: protectedProcedure
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
    
    getComments: protectedProcedure
      .input(z.object({ catalogId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCatalogComments(input.catalogId);
      }),
    
    markCommentRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.markCommentAsRead(input.id);
        return { success: true };
      }),
  }),

  // Collections
  collections: router({
    list: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllCollections(input);
      }),
    
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const collection = await db.getCollectionById(input.id);
        if (!collection) return null;
        
        const products = await db.getCollectionProducts(input.id);
        return { ...collection, products };
      }),
    
    create: protectedProcedure
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
    
    update: protectedProcedure
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
            await db.removeProductFromCollection(id, p.product.id);
          }
          if (productIds.length > 0) {
            await db.addProductsToCollection(id, productIds);
          }
        }
        
        return collection;
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCollection(input.id);
        return { success: true };
      }),
    
    addProducts: protectedProcedure
      .input(z.object({
        collectionId: z.number(),
        productIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await db.addProductsToCollection(input.collectionId, input.productIds);
        return { success: true };
      }),
    
    removeProduct: protectedProcedure
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
  orders: router({
    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        customerId: z.number().optional(),
        month: z.number().optional(),
        year: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getAllOrders(input);
      }),
    
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const order = await db.getOrderById(input.id);
        if (!order) return null;
        
        const items = await db.getOrderItems(input.id);
        return { ...order, items };
      }),
    
    create: protectedProcedure
      .input(z.object({
        catalogId: z.number().optional(),
        customerId: z.number().optional(),
        totalItems: z.number().optional(),
        totalWeight: z.string().optional(),
        totalPrice: z.string().optional(),
        status: z.enum(["pending", "production", "completed", "delivered", "cancelled"]).optional(),
        expectedDelivery: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(z.object({
          productId: z.number(),
          quantity: z.number(),
          unitPrice: z.string(),
          totalPrice: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { items, expectedDelivery, ...orderData } = input;
        const orderNumber = await db.generateOrderNumber();
        
        const order = await db.createOrder({
          ...orderData,
          orderNumber,
          expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
          createdBy: ctx.user.id,
        });
        
        if (items && items.length > 0) {
          await db.addOrderItems(order.id, items);
        }
        
        return order;
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "production", "completed", "delivered", "cancelled"]).optional(),
        expectedDelivery: z.string().optional(),
        notes: z.string().optional(),
        totalItems: z.number().optional(),
        totalWeight: z.string().optional(),
        totalPrice: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, expectedDelivery, ...data } = input;
        
        const updateData: any = { ...data };
        if (expectedDelivery) {
          updateData.expectedDelivery = new Date(expectedDelivery);
        }
        if (data.status === 'completed') {
          updateData.completedDate = new Date();
        }
        
        return await db.updateOrder(id, updateData);
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteOrder(input.id);
        return { success: true };
      }),
  }),

  // File Upload
  upload: router({
    image: protectedProcedure
      .input(z.object({
        base64: z.string(),
        filename: z.string(),
        contentType: z.string(),
      }))
      .mutation(async ({ input }) => {
        // Decode base64 to buffer
        const base64Data = input.base64.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate unique filename
        const ext = input.filename.split('.').pop() || 'jpg';
        const uniqueFilename = `catalog-covers/${Date.now()}-${nanoid(8)}.${ext}`;
        
        // Upload to S3
        const { url } = await storagePut(uniqueFilename, buffer, input.contentType);
        
        return { url };
      }),
  }),

  // JulesBot AI Agent
  julesBot: router({
    // Get greeting with gold news, trends, and weather
    getGreeting: protectedProcedure.query(async ({ ctx }) => {
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
• ${stats.currentMonthOrders} orders this monthth\n\nHave a productive day!`,
          goldPrice,
          stats,
          timestamp: new Date().toISOString(),
        };
      }
    }),

    // Chat with JulesBot
    chat: protectedProcedure
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
          return {
            message: "I apologize, I'm having trouble processing your request right now. Please try again.",
            catalogCreated: null,
            timestamp: new Date().toISOString(),
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
