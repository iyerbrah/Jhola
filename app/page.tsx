import { Jhola } from "@/components/jhola/Jhola";
import { catalog } from "@/lib/catalog";

// The page gets the product count, not the catalog: the browser downloads that only when a swap needs it.
export default function Home() {
  return <Jhola catalogSize={catalog.length} />;
}
