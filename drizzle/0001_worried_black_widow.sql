CREATE TABLE `catalog_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`catalogId` int NOT NULL,
	`productId` int,
	`visitorName` varchar(100),
	`comment` text NOT NULL,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`catalogId` int NOT NULL,
	`productId` int NOT NULL,
	`visitorId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_likes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`catalogId` int NOT NULL,
	`productId` int NOT NULL,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`coverImage` text,
	`productType` varchar(100),
	`customFields` text,
	`customerId` int,
	`publicToken` varchar(64),
	`isPublic` boolean DEFAULT true,
	`status` enum('draft','published','archived') DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	CONSTRAINT `catalogs_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalogs_publicToken_unique` UNIQUE(`publicToken`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100),
	`email` varchar(320),
	`phone` varchar(20),
	`address` text,
	`city` varchar(100),
	`state` varchar(100),
	`country` varchar(100) DEFAULT 'Pakistan',
	`paymentStatus` enum('paid','unpaid') DEFAULT 'unpaid',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gold_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`priceDate` date NOT NULL,
	`price22k` decimal(12,2) NOT NULL,
	`price24k` decimal(12,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	CONSTRAINT `gold_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` int DEFAULT 1,
	`unitPrice` decimal(12,2),
	`totalPrice` decimal(12,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderNumber` varchar(50) NOT NULL,
	`catalogId` int,
	`customerId` int,
	`totalItems` int DEFAULT 0,
	`totalWeight` decimal(10,3),
	`totalPrice` decimal(14,2),
	`status` enum('pending','production','completed','delivered','cancelled') DEFAULT 'pending',
	`orderDate` timestamp NOT NULL DEFAULT (now()),
	`expectedDelivery` date,
	`completedDate` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_orderNumber_unique` UNIQUE(`orderNumber`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`sku` varchar(50),
	`categoryId` int,
	`goldWeight` decimal(10,3),
	`goldKarat` enum('22k','24k'),
	`makingCharges` decimal(12,2),
	`makingChargesType` enum('fixed','per_gram') DEFAULT 'fixed',
	`stoneType` varchar(100),
	`stoneWeight` decimal(10,3),
	`stonePrice` decimal(12,2),
	`images` text,
	`primaryImage` text,
	`basePrice` decimal(12,2),
	`totalPrice` decimal(12,2),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `catalog_comments` ADD CONSTRAINT `catalog_comments_catalogId_catalogs_id_fk` FOREIGN KEY (`catalogId`) REFERENCES `catalogs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_comments` ADD CONSTRAINT `catalog_comments_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_likes` ADD CONSTRAINT `catalog_likes_catalogId_catalogs_id_fk` FOREIGN KEY (`catalogId`) REFERENCES `catalogs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_likes` ADD CONSTRAINT `catalog_likes_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_products` ADD CONSTRAINT `catalog_products_catalogId_catalogs_id_fk` FOREIGN KEY (`catalogId`) REFERENCES `catalogs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_products` ADD CONSTRAINT `catalog_products_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalogs` ADD CONSTRAINT `catalogs_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalogs` ADD CONSTRAINT `catalogs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gold_prices` ADD CONSTRAINT `gold_prices_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_catalogId_catalogs_id_fk` FOREIGN KEY (`catalogId`) REFERENCES `catalogs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;