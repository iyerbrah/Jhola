import Link from "next/link";

export const REPO_URL = "https://github.com/iyerbrah/Jhola";
const AUTHOR_URL = "https://github.com/iyerbrah";

/** Shared footer: who built it, where the code is, and the data credit. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line py-8 text-sm text-ink-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <p className="text-base text-ink">
          Built by{" "}
          <a href={AUTHOR_URL} className="font-semibold underline decoration-marigold decoration-2 underline-offset-4">
            Ram Iyer
          </a>
        </p>
        <nav aria-label="Project links" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/how-it-works" className="font-semibold text-ink underline underline-offset-4">
            How it works
          </Link>
          <a href={REPO_URL} className="font-semibold text-ink underline underline-offset-4">
            Source on GitHub
          </a>
        </nav>
      </div>
      <p className="mt-4 max-w-3xl">
        Product data from the Kaggle &quot;BigBasket Entire Product List&quot; dataset (CC BY-NC-SA 4.0), plus a few hand-added staples. Prices are an
        illustrative snapshot, not live prices. Jhola is a portfolio demo: it is not affiliated with any retailer, and no orders are placed.
      </p>
    </footer>
  );
}
