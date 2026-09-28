import { getTableColumns, type InferSelectModel, type Table } from "drizzle-orm";

/**
 * Serialize a MongoDB document into the row shape described by a Drizzle
 * table in drizzle/schema.ts (the API data contract).
 *
 * - decimal columns  -> fixed-scale string ("1250.50"), or null
 * - date/timestamp   -> Date, or null
 * - int columns      -> number, or null
 * - literal defaults -> applied when the document has no value (e.g. "0", "gm")
 * - unknown fields (_id, __v, passwordHash, ...) are dropped
 */
export function toRow<T extends Table>(table: T, doc: unknown): InferSelectModel<T> {
  const source = (doc ?? {}) as Record<string, unknown>;
  const row: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const meta = column as unknown as {
      columnType: string;
      scale?: number;
      hasDefault?: boolean;
      default?: unknown;
    };
    let value = source[key];

    if (value === undefined || value === null) {
      const literalDefault =
        meta.hasDefault && meta.default !== undefined && (typeof meta.default !== "object" || meta.default === null)
          ? meta.default
          : undefined;
      value = literalDefault ?? null;
    }

    if (value === null) {
      row[key] = null;
      continue;
    }

    switch (meta.columnType) {
      case "MySqlDecimal": {
        const numeric = Number(value);
        row[key] = Number.isFinite(numeric) ? numeric.toFixed(meta.scale ?? 2) : null;
        break;
      }
      case "MySqlDate":
      case "MySqlTimestamp":
      case "MySqlDateTime": {
        const date = value instanceof Date ? value : new Date(value as string);
        row[key] = Number.isNaN(date.getTime()) ? null : date;
        break;
      }
      case "MySqlInt": {
        const numeric = Number(value);
        row[key] = Number.isFinite(numeric) ? numeric : null;
        break;
      }
      case "MySqlBoolean":
        row[key] = Boolean(value);
        break;
      default:
        row[key] = value;
    }
  }

  return row as InferSelectModel<T>;
}

export function toRows<T extends Table>(table: T, docs: unknown[]): InferSelectModel<T>[] {
  return docs.map(doc => toRow(table, doc));
}

export function toRowOrNull<T extends Table>(table: T, doc: unknown): InferSelectModel<T> | null {
  return doc ? toRow(table, doc) : null;
}

/** Parse an optional decimal input ("12.5", "", undefined) into a number or undefined. */
export function num(value: string | number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
