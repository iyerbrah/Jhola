"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/schema";

// One download per page view, shared by every component that asks.
let loaded: Product[] | null = null;
let loading: Promise<Product[]> | null = null;

/**
 * The catalog, downloaded only once `enabled` is true (when there are carts to swap items in), so the
 * first page load doesn't carry ~2,700 products. null until it arrives. The server checked it already,
 * so it isn't parsed again here.
 */
export function useCatalog(enabled: boolean): Product[] | null {
  const [catalog, setCatalog] = useState(loaded);
  useEffect(() => {
    if (!enabled || catalog) return;
    let live = true;
    loading ??= import("@/data/catalog.json").then((m) => (loaded = m.default as Product[]));
    loading.then((c) => live && setCatalog(c)).catch(() => (loading = null));
    return () => {
      live = false;
    };
  }, [enabled, catalog]);
  return catalog;
}
