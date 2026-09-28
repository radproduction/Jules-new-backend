# JULES release — Orders, Production, Invoices, Finance & Role-Based Access

Ported from the Manus handoff (`JULES-production-2026-09-28`, MySQL + Manus OAuth)
to this stack: **Express + tRPC + MongoDB (Mongoose)** backend on Railway and the
separate **Vite/React** frontend on Vercel, keeping email + password login.

## What changed

| Area | Backend | Frontend |
|---|---|---|
| Roles | `user` (awaiting access), `operations_finance`, `admin` (Super Admin). Guards in `server/_core/trpc.ts`; deactivated accounts cannot sign in. | `RoleGate`, role-filtered sidebar, **Users & Access** page |
| Staff logins | Super Admin creates staff accounts, changes roles, resets passwords, deactivates (`access.*`). Passwords stored as bcrypt hashes. | Add staff / reset password / activate dialogs + audit trail |
| Sales Orders | Items with metal/gem/labour estimates, per-item vendor, advances (cash, metal, gems), order date | `Orders → New Sales Order` |
| Production | Vendor assignment creates the first "Body Making" process; processes track dates, metal/gem issue & return, labour | Order Detail |
| Invoices | Total always derived from components; posting Customer Dr / Sales Cr is automatic and idempotent; posted amounts are locked; cancelling a posted invoice (Super Admin) reverses it | Invoices workspace |
| Finance | Chart of accounts (control/detail), cash receipt/payment vouchers, general journal (must balance), reversals, account ledger, trial balance | Finance Control Center |
| Audit | `audit_logs` for role, user, ledger and journal actions | Users & Access → Recent Activity |

## New MongoDB collections

`vendors`, `order_processes`, `order_advance_metals`, `order_advance_gems`,
`order_invoices`, `order_invoice_items`, `ledger_accounts`, `journal_entries`
(lines embedded, amounts in integer cents), `audit_logs`, `schema_migrations`.

Extended: `users` (`role` adds `operations_finance`, new `isActive`), `orders`
(`description`, `comments`, `advanceCash`, status `saved`), `order_items`
(item name, estimates, `vendorId`; `productId` optional).

## Migration

Runs automatically on server start (`server/migrations.ts`) and is recorded in
`schema_migrations`, so it applies once. It only creates indexes (never drops),
back-fills defaults (`isActive`, `advanceCash`, order item names) and creates the
system chart of accounts plus a ledger for every existing customer/vendor.
Manual run: `pnpm migrate`. Set `MIGRATIONS_STRICT=true` to stop start-up on failure.

**Back up the production database before deploying.**

## Deploy

1. Backend (Railway): push `Jules-new-backend`; build `pnpm run build`, start `pnpm start`.
   Env: see `.env.example` (`MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`).
2. Frontend (Vercel): push `jules-frontend`; `/api/*` is rewritten to Railway (see `vercel.json`).
3. Sign in as the owner (`ADMIN_EMAIL`) → Users & Access → add staff.

## Smoke test

- Super Admin sees all menus; Operations & Finance sees Customers, Orders, Invoices, Finance only.
- Create a customer → ledger `CS…` appears in Finance → Chart of Accounts.
- New Sales Order with order date, item + vendor, cash/metal/gem advances → Order Detail shows the process.
- Generate invoice → appears in Invoices; Finance shows Customer Dr / Jewelry Sales Cr.
- Cash Receipt from the customer → customer balance drops; Trial Balance totals match.
- Public catalog preview still shows no dashboard navigation.
