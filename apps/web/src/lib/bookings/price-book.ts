import { db } from "@/lib/db";
import { productPrices, products, schedulePrices, vessels } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import type { PriceBook, PricingTrip } from "./price-cart";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Loads the fares that apply to `trips`: their products' active fares, their
 * schedules' overrides and their vessels' group discounts, all scoped to the
 * operator. Every caller that shows or charges a price loads it here, so the
 * booking calendar, the quote and the charge can't disagree (P8-3).
 */
export async function loadPriceBook(
  operatorId: string,
  trips: Pick<PricingTrip, "productId" | "scheduleId" | "vesselId">[],
  tx: Tx | typeof db = db,
): Promise<PriceBook> {
  const productIds = [...new Set(trips.map((t) => t.productId))];
  // One-off "Add a departure" trips have no schedule, so no override.
  const scheduleIds = [...new Set(trips.map((t) => t.scheduleId).filter((id): id is string => id !== null))];
  const vesselIds = [...new Set(trips.map((t) => t.vesselId))];

  const [productPriceRows, schedulePriceRows, vesselRows] = await Promise.all([
    productIds.length > 0
      ? tx
          .select({
            productId: productPrices.productId,
            ticketType: productPrices.ticketType,
            priceCents: productPrices.priceCents,
          })
          .from(productPrices)
          .innerJoin(products, eq(products.id, productPrices.productId))
          .where(
            and(
              inArray(productPrices.productId, productIds),
              eq(products.operatorId, operatorId),
              eq(productPrices.active, true),
            ),
          )
      : [],
    scheduleIds.length > 0
      ? tx
          .select({
            scheduleId: schedulePrices.scheduleId,
            ticketType: schedulePrices.ticketType,
            priceCents: schedulePrices.priceCents,
          })
          .from(schedulePrices)
          .where(and(inArray(schedulePrices.scheduleId, scheduleIds), eq(schedulePrices.operatorId, operatorId)))
      : [],
    vesselIds.length > 0
      ? tx
          .select({
            id: vessels.id,
            groupDiscountThreshold: vessels.groupDiscountThreshold,
            groupDiscountPct: vessels.groupDiscountPct,
          })
          .from(vessels)
          .where(and(inArray(vessels.id, vesselIds), eq(vessels.operatorId, operatorId)))
      : [],
  ]);

  return { productPrices: productPriceRows, schedulePrices: schedulePriceRows, vessels: vesselRows };
}
