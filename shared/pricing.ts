/**
 * Jewelry pricing rules shared by the backend (source of truth, used when a
 * product is saved and when the daily gold rate changes) and the frontend
 * (live preview in the product form). Keep both copies identical.
 *
 * Units: gold weight in tola (already including wastage), rates in PKR per tola,
 * diamonds / stones in carats with rates in PKR per carat.
 */

/** 1 tola = 11.6638 grams (Pakistan standard). */
export const GRAMS_PER_TOLA = 11.6638038;
/** 1 troy ounce = 31.1035 grams. */
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

export const WHITE_GOLD_KARATS = ["9k", "14k", "18k", "21k", "22k"] as const;
export type WhiteGoldKarat = (typeof WHITE_GOLD_KARATS)[number];
export type ProductKarat = "22k" | "24k" | "white";

export type NumericLike = number | string | null | undefined;

export type GoldRates = {
  price22k?: NumericLike;
  price24k?: NumericLike;
  whiteGoldPrice?: NumericLike;
  whiteGoldKarat?: string | null;
};

export type PricingInput = {
  goldKarat?: ProductKarat | string | null;
  goldWeight?: NumericLike;
  makingCharges?: NumericLike;
  makingChargesType?: "fixed" | "per_gram" | string | null;
  diamondWeight?: NumericLike;
  diamondRate?: NumericLike;
  diamondPrice?: NumericLike;
  stoneWeight?: NumericLike;
  stoneRate?: NumericLike;
  stonePrice?: NumericLike;
};

export type PriceBreakdown = {
  /** PKR per tola used for this product, or null when the rate is not set. */
  goldRate: number | null;
  goldValue: number;
  making: number;
  diamonds: number;
  stones: number;
  /** null when there is nothing to price (no weight and no other component). */
  total: number | null;
};

export function toNumber(value: NumericLike): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Parse "18k" -> 18. */
export function karatNumber(karat: string | null | undefined): number | null {
  const match = /^(\d{1,2})\s*k$/i.exec(String(karat ?? "").trim());
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 && value <= 24 ? value : null;
}

/** Pure-gold-equivalent price for a karat, derived from the 24k rate. */
export function priceForKarat(price24k: number, karat: string): number | null {
  const k = karatNumber(karat);
  if (k === null) return null;
  return Math.round((price24k * k) / 24);
}

/** PKR per tola for the product's gold type. */
export function rateForKarat(karat: string | null | undefined, rates: GoldRates | null | undefined): number | null {
  if (!rates || !karat) return null;
  if (karat === "22k") return toNumber(rates.price22k);
  if (karat === "24k") return toNumber(rates.price24k);
  if (karat === "white") return toNumber(rates.whiteGoldPrice);
  return null;
}

export function calculateProductPrice(input: PricingInput, rates: GoldRates | null | undefined): PriceBreakdown {
  const weight = toNumber(input.goldWeight) ?? 0;
  const goldRate = rateForKarat(input.goldKarat ?? null, rates);
  const goldValue = weight > 0 && goldRate !== null ? weight * goldRate : 0;

  const makingInput = toNumber(input.makingCharges) ?? 0;
  // per_gram making is entered per gram while weight is in tola.
  const making = input.makingChargesType === "per_gram" ? makingInput * weight * GRAMS_PER_TOLA : makingInput;

  const diamonds =
    toNumber(input.diamondPrice) ??
    ((toNumber(input.diamondWeight) ?? 0) * (toNumber(input.diamondRate) ?? 0));
  const stones =
    toNumber(input.stonePrice) ??
    ((toNumber(input.stoneWeight) ?? 0) * (toNumber(input.stoneRate) ?? 0));

  const hasGold = weight > 0 && goldRate !== null;
  const hasAnything = hasGold || making > 0 || diamonds > 0 || stones > 0;
  // Gold is part of this product but today's rate for its karat is not set:
  // do not produce a price that silently leaves the gold out.
  const missingRate = weight > 0 && !!input.goldKarat && goldRate === null;

  return {
    goldRate,
    goldValue: round2(goldValue),
    making: round2(making),
    diamonds: round2(diamonds),
    stones: round2(stones),
    total: hasAnything && !missingRate ? round2(goldValue + making + diamonds + stones) : null,
  };
}

export function karatLabel(karat: string | null | undefined, whiteGoldKarat?: string | null): string {
  if (karat === "22k") return "22K Gold";
  if (karat === "24k") return "24K Gold";
  if (karat === "white") return `White Gold${whiteGoldKarat ? ` (${whiteGoldKarat.toUpperCase()})` : ""}`;
  return "—";
}
