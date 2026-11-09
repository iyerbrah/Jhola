import { CartBuilder } from "@/components/CartBuilder";
import { catalog } from "@/lib/catalog";

// The page gets the product count, not the catalog: the browser downloads that only when carts need it.
export default function Home() {
  return <CartBuilder catalogSize={catalog.length} />;
}
