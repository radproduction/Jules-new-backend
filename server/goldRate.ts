import { GRAMS_PER_TOLA, GRAMS_PER_TROY_OUNCE, priceForKarat, toNumber } from "../shared/pricing";

/**
 * Live gold rate for the daily "Set Today's Gold Price" popup.
 *
 * Source: international spot gold (USD / troy ounce) from gold-api.com and the
 * USD→PKR rate from open.er-api.com, both free and keyless. That gives the
 * international 24k price per tola in PKR. The local Pakistani (sarafa) rate
 * usually carries a premium over that, so we learn it from the last rate the
 * owner saved: premium = saved 24k − international 24k at that moment.
 * The suggestion is always editable before it is saved.
 */

const GOLD_SPOT_URL = process.env.GOLD_SPOT_URL || "https://api.gold-api.com/price/XAU";
const USD_PKR_URL = process.env.USD_PKR_URL || "https://open.er-api.com/v6/latest/USD";
const CACHE_MS = 10 * 60 * 1000;

export type LiveGoldRate = {
  price24k: number;
  price22k: number;
  /** International 24k per tola in PKR, before the local premium. */
  international24k: number;
  /** Local premium per tola applied on top of the international price. */
  localPremium: number;
  spotUsdPerOunce: number;
  usdToPkr: number;
  fetchedAt: string;
  spotUpdatedAt: string | null;
  sources: string[];
};

export type LastSavedRate = {
  price24k?: unknown;
  marketReference24k?: unknown;
} | null;

let cache: { at: number; spot: number; fx: number; spotUpdatedAt: string | null } | null = null;

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "jules-backend/1.0" },
    });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function parseSpot(json: any): { price: number; updatedAt: string | null } {
  const price = toNumber(json?.price);
  if (price === null || price < 500 || price > 50000) {
    throw new Error("Gold spot price response is not valid");
  }
  return { price, updatedAt: typeof json?.updatedAt === "string" ? json.updatedAt : null };
}

export function parseUsdPkr(json: any): number {
  const rate = toNumber(json?.rates?.PKR);
  if (rate === null || rate < 50 || rate > 2000) {
    throw new Error("USD→PKR response is not valid");
  }
  return rate;
}

/** Round to the nearest 100 rupees, the way sarafa rates are quoted. */
const roundRate = (value: number) => Math.round(value / 100) * 100;

export function computeLiveRate(
  spotUsdPerOunce: number,
  usdToPkr: number,
  lastSaved: LastSavedRate
): Pick<LiveGoldRate, "price24k" | "price22k" | "international24k" | "localPremium"> {
  const international24k = (spotUsdPerOunce * usdToPkr * GRAMS_PER_TOLA) / GRAMS_PER_TROY_OUNCE;

  const saved24k = toNumber(lastSaved?.price24k as any);
  const savedReference = toNumber(lastSaved?.marketReference24k as any);
  let localPremium = 0;
  if (saved24k !== null && savedReference !== null && savedReference > 0) {
    localPremium = saved24k - savedReference;
    // Ignore an implausible premium (e.g. a typo when it was saved): keep within ±15%.
    if (Math.abs(localPremium) > international24k * 0.15) localPremium = 0;
  }

  const price24k = roundRate(international24k + localPremium);
  const price22k = roundRate(priceForKarat(price24k, "22k") ?? 0);
  return {
    price24k,
    price22k,
    international24k: Math.round(international24k),
    localPremium: Math.round(localPremium),
  };
}

export async function fetchLiveGoldRate(lastSaved: LastSavedRate): Promise<LiveGoldRate> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const [spotJson, fxJson] = await Promise.all([fetchJson(GOLD_SPOT_URL), fetchJson(USD_PKR_URL)]);
    const spot = parseSpot(spotJson);
    cache = { at: Date.now(), spot: spot.price, fx: parseUsdPkr(fxJson), spotUpdatedAt: spot.updatedAt };
  }

  return {
    ...computeLiveRate(cache.spot, cache.fx, lastSaved),
    spotUsdPerOunce: cache.spot,
    usdToPkr: cache.fx,
    fetchedAt: new Date(cache.at).toISOString(),
    spotUpdatedAt: cache.spotUpdatedAt,
    sources: ["gold-api.com (XAU/USD)", "open.er-api.com (USD/PKR)"],
  };
}

/** Pakistan has no daylight saving: always UTC+5. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Start/end of "today" in Pakistan time, as UTC instants. */
export function pakistanDayRange(now = new Date()): { start: Date; end: Date } {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const startUtc = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS;
  return { start: new Date(startUtc), end: new Date(startUtc + 24 * 60 * 60 * 1000 - 1) };
}
