# JULES release — Live gold rate, white gold, customer catalogs, product import

## What changed

| Area | Backend | Frontend |
|---|---|---|
| Daily gold rate | `goldPrice.live` returns today's suggested rate: international spot (gold-api.com, USD/oz) × USD→PKR (open.er-api.com) converted to PKR/tola, plus the local premium learned from the last saved rate. "Today" now uses Pakistan time. | New "Today's Gold Rate" popup, pre-filled with the live rate, editable, shows change vs last saved. |
| White gold | `gold_prices` stores `whiteGoldPrice` + `whiteGoldKarat` (9k–22k). Products accept `goldKarat: "white"`. | Third rate in the popup with a karat selector; dashboard card shows it; product form offers White Gold. |
| Prices everywhere | Saving the rate re-prices every product (`recalculateAllProductPrices`). Product create/update is priced on the server (`shared/pricing.ts`), not trusted from the browser. | Product form shows a live price breakdown with the same rules. |
| Product edit bug | Numeric inputs accept numbers or strings (`decimalInput`); "" clears a value. | Form converts Mongo numbers to strings. |
| Catalogs | — | Removed from the sidebar. Created, edited and shared from **Customer → Catalogs** (WhatsApp / copy link). |
| Product popups | — | Redesigned detail view (photo viewer + price breakdown + specs) and add/edit form (sections, photo upload, live price). |
| Images on server | `UPLOAD_DIR` (Railway volume) stores uploads on disk; served at `/api/files/:id`. Falls back to MongoDB when unset. | Grids use thumbnails + lazy loading; products page renders in pages of 60. |
| Bulk import | `products.importImage` (one photo = one product, folder = category + collection, idempotent per `sourceKey`), `products.importedKeys`. | **Products → Import photos**: choose the "Shaikha Jewellers" folder, review, start / pause / resume. |
| JulesBot | Prompt carries per-category counts + 150 latest products instead of every product. | — |

## Deploy (in this order)

1. **Railway volume**: backend service → Volumes → add a volume mounted at `/data`.
2. **Railway variables**: add `UPLOAD_DIR=/data/uploads`.
3. Locally, in `Jules-new-backend`: `pnpm install && pnpm check && pnpm test`, then push. Migration
   `2026-11-03-product-import-white-gold` runs on start (adds the unique `sourceKey` index).
4. Locally, in `jules-frontend`: `pnpm install && pnpm check && pnpm build`, then push (Vercel).
5. Dashboard → the rate popup opens with the live rate → adjust to the sarafa rate if needed → **Save & update prices**.
   From the second save onwards the live suggestion includes the learned local premium.
6. Products → **Import photos** → choose `D:\New-Jules\Shaikha Jewellers` → Start import. Keep the tab open;
   pause/resume is safe. The one `.heic` photo must be converted to JPG first.

No new npm dependencies were added, so `pnpm-lock.yaml` is unchanged.

## Notes

- The live rate is a suggestion. International spot converted to PKR does not include the local premium until
  one rate has been saved; always confirm against the day's sarafa rate.
- ~4,000 photos ≈ 1.4 GB originals → roughly 1–1.5 GB on the volume after resizing (1600px + 480px thumbnail).
- Imported products have a generated name/SKU (e.g. "Diamond Ring 0001", `DR-0001`) and no weight yet; their price
  appears once karat and weight are filled in.
