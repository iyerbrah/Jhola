import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SignHeadline, SiteHeader } from "@/components/SiteHeader";
import { button } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <SignHeadline title="This page isn't on the list.">
          <p>The link may be old or mistyped.</p>
        </SignHeadline>
      </SiteHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 sm:px-6">
        <Link href="/" className={button("primary", "inline-block px-5 py-3")}>
          Build a cart
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
