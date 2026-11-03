import { describe, expect, it } from "vitest";
import { calculateProductPrice, priceForKarat, GRAMS_PER_TOLA } from "../shared/pricing";
import { computeLiveRate, pakistanDayRange, parseSpot, parseUsdPkr } from "./goldRate";

const rates = { price22k: "403333", price24k: "440000", whiteGoldPrice: "330000", whiteGoldKarat: "18k" };

describe("pricing", () => {
  it("prices gold by karat including white gold", () => {
    expect(calculateProductPrice({ goldKarat: "24k", goldWeight: "1" }, rates).total).toBe(440000);
    expect(calculateProductPrice({ goldKarat: "22k", goldWeight: 2 }, rates).total).toBe(806666);
    expect(calculateProductPrice({ goldKarat: "white", goldWeight: "0.5" }, rates).total).toBe(165000);
  });

  it("adds making (fixed and per gram), diamonds and stones", () => {
    const fixed = calculateProductPrice(
      { goldKarat: "22k", goldWeight: "1", makingCharges: "20000", diamondWeight: "0.5", diamondRate: "100000", stonePrice: "5000" },
      rates
    );
    expect(fixed).toMatchObject({ goldValue: 403333, making: 20000, diamonds: 50000, stones: 5000, total: 478333 });

    const perGram = calculateProductPrice({ goldKarat: "24k", goldWeight: "1", makingCharges: "1000", makingChargesType: "per_gram" }, rates);
    expect(perGram.making).toBeCloseTo(1000 * GRAMS_PER_TOLA, 1);
  });

  it("returns null total when there is nothing to price", () => {
    expect(calculateProductPrice({}, rates).total).toBeNull();
    expect(calculateProductPrice({ goldKarat: "white", goldWeight: 1 }, { price22k: 1, price24k: 1 }).total).toBeNull();
  });

  it("derives karat prices from 24k", () => {
    expect(priceForKarat(440000, "22k")).toBe(403333);
    expect(priceForKarat(440000, "18k")).toBe(330000);
  });
});

describe("live gold rate", () => {
  it("converts spot USD/oz to PKR per tola and applies the learned local premium", () => {
    const plain = computeLiveRate(3902, 276.73, null);
    expect(plain.international24k).toBeGreaterThan(400000);
    expect(plain.international24k).toBeLessThan(410000);
    expect(plain.price24k % 100).toBe(0);

    const withPremium = computeLiveRate(3902, 276.73, { price24k: 420000, marketReference24k: 400000 });
    expect(withPremium.localPremium).toBe(20000);
    expect(withPremium.price24k - plain.price24k).toBeGreaterThanOrEqual(19900);
    expect(withPremium.price22k).toBe(Math.round(Math.round((withPremium.price24k * 22) / 24) / 100) * 100);
  });

  it("ignores an implausible premium", () => {
    expect(computeLiveRate(3902, 276.73, { price24k: 900000, marketReference24k: 400000 }).localPremium).toBe(0);
  });

  it("validates provider responses", () => {
    expect(parseSpot({ price: 3902.1, updatedAt: "x" }).price).toBe(3902.1);
    expect(() => parseSpot({ price: "abc" })).toThrow();
    expect(parseUsdPkr({ rates: { PKR: 276.7 } })).toBe(276.7);
    expect(() => parseUsdPkr({ rates: {} })).toThrow();
  });

  it("uses the Pakistan calendar day", () => {
    // 2026-11-03 20:30 UTC is already 4 Nov 01:30 in Pakistan.
    const { start, end } = pakistanDayRange(new Date("2026-11-03T20:30:00Z"));
    expect(start.toISOString()).toBe("2026-11-03T19:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-04T18:59:59.999Z");
  });
});
