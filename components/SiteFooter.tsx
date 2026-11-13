import Link from "next/link";
import { button } from "./ui";

export const REPO_URL = "https://github.com/iyerbrah/Jhola";
const AUTHOR_URL = "https://github.com/iyerbrah";

/** Shared footer: who built it, where the code is, and the data credit. */
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-20 w-full max-w-6xl px-4 text-sm text-ink-soft sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-t-2 border-line pt-8">
        <p className="text-base text-ink">
          Built by{" "}
          <a href={AUTHOR_URL} className="font-semibold underline decoration-rani decoration-2 underline-offset-4">
            Ram Iyer
          </a>
        </p>
        <nav aria-label="Project links" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/history" className={button("quiet")}>
            History
          </Link>
          <Link href="/results" className={button("quiet")}>
            Results
          </Link>
          <Link href="/how-it-works" className={button("quiet")}>
            How it works
          </Link>
          <a href={REPO_URL} className={button("quiet")}>
            Source on GitHub
          </a>
        </nav>
      </div>
      <p className="mt-4 max-w-3xl pb-8 leading-relaxed">
        Product data: about 2,500 products from the Kaggle &quot;BigBasket Products&quot; dataset by Chinmay Shanbhag (CC0, public domain), and about 800 hand-curated everyday groceries. Prices are an
        illustrative snapshot, not live prices. Jhola is a portfolio demo: it isn&apos;t affiliated with any retailer, and no orders are placed or delivered.
      </p>
    </footer>
  );
}
