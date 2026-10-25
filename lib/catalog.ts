import catalogJson from "@/data/catalog.json";
import { CatalogSchema, type Product } from "./schema";

export const catalog: Product[] = CatalogSchema.parse(catalogJson);

export type CatalogIndex = Map<string, Product>;

export function indexCatalog(products: Product[]): CatalogIndex {
  return new Map(products.map((p) => [p.id, p]));
}

export const catalogIndex = indexCatalog(catalog);
