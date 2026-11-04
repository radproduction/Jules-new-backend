/**
 * Builds sales-invoice lines from Sales Order items, in the shop's bill layout:
 * each item (Necklace, Earrings…) gets a metal line (Gold 20k: net weight, wastage,
 * total weight, rate) and a stone line (Diamonds Melee: qty, weight, rate).
 * Same file in the frontend and backend (shared/invoiceLines.ts).
 */

export type InvoiceLineType = "metal" | "stone";

export type InvoiceLine = {
  itemName: string;
  particular: string;
  lineType: InvoiceLineType;
  qty?: number;
  weight?: string;
  weightUnit: string;
  wastage?: string;
  netWeight?: string;
  rate?: string;
  calculateBy?: string;
  amount: string;
  sortOrder: number;
};

type Value = string | number | null | undefined;

export type OrderItemForInvoice = {
  itemName?: string | null;
  estimatedMetalType?: string | null;
  estimatedMetalWeight?: Value;
  estimatedMetalWastage?: Value;
  estimatedMetalRate?: Value;
  estimatedMetalValue?: Value;
  estimatedGemType?: string | null;
  estimatedGemQty?: Value;
  estimatedGemWeight?: Value;
  estimatedGemRate?: Value;
  estimatedGemCalcBy?: string | null;
  estimatedGemValue?: Value;
};

const num = (value: Value) => {
  const n = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? 0 : n;
};
const fixed = (value: number, digits: number) => String(Math.round(value * 10 ** digits) / 10 ** digits);

export function invoiceLinesFromOrderItems(items: OrderItemForInvoice[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  items.forEach((item, index) => {
    const itemName = (item.itemName || "Item").trim();
    const base = index * 10;

    const weight = num(item.estimatedMetalWeight);
    const wastage = num(item.estimatedMetalWastage);
    const metalValue = num(item.estimatedMetalValue);
    if (item.estimatedMetalType || weight > 0 || metalValue > 0) {
      lines.push({
        itemName,
        particular: item.estimatedMetalType || "Gold",
        lineType: "metal",
        weight: weight ? fixed(weight, 3) : undefined,
        weightUnit: "gm",
        wastage: fixed(wastage, 2),
        netWeight: weight ? fixed(weight + (weight * wastage) / 100, 3) : undefined,
        rate: num(item.estimatedMetalRate) ? fixed(num(item.estimatedMetalRate), 2) : undefined,
        amount: fixed(metalValue, 2),
        sortOrder: base,
      });
    }

    const gemQty = num(item.estimatedGemQty);
    const gemWeight = num(item.estimatedGemWeight);
    const gemValue = num(item.estimatedGemValue);
    if (item.estimatedGemType || gemQty > 0 || gemWeight > 0 || gemValue > 0) {
      lines.push({
        itemName,
        particular: item.estimatedGemType || "Stones",
        lineType: "stone",
        qty: gemQty ? Math.round(gemQty) : undefined,
        weight: gemWeight ? fixed(gemWeight, 3) : undefined,
        weightUnit: "ct",
        rate: num(item.estimatedGemRate) ? fixed(num(item.estimatedGemRate), 2) : undefined,
        calculateBy: item.estimatedGemCalcBy || "weight",
        amount: fixed(gemValue, 2),
        sortOrder: base + 1,
      });
    }
  });
  return lines;
}

/** Older invoices saved lines without a type: stones are counted in carats or pieces. */
export function lineTypeOf(line: { lineType?: string | null; weightUnit?: string | null; qty?: Value; particular?: string | null }): InvoiceLineType {
  if (line.lineType === "metal" || line.lineType === "stone") return line.lineType;
  if (line.weightUnit === "ct") return "stone";
  if (/gold|silver|platinum|palladium|metal|\d+\s*k\b/i.test(line.particular ?? "")) return "metal";
  return num(line.qty) > 0 ? "stone" : "metal";
}
