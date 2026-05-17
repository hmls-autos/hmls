// /obd hub page — directory listing of the SEO landing pages.
//
// SEO purpose: internal linking. Google's crawler discovers /obd/[code]
// pages from sitemap.xml AND from any page linking to them. A hub
// page concentrates that internal-link signal — every code page links
// up to /obd, and /obd links down to every code page. This boosts the
// per-page crawl frequency and helps Google understand the relationship
// between the codes (they're a topical cluster, not orphaned pages).
//
// The card grid + search input is delegated to the ObdCodeSearch
// client component so user input filters the visible cards without a
// page reload. The page itself stays SSG (server-side render at build).

import type { Metadata } from "next";
import Link from "next/link";
import { ObdCodeSearch } from "@/components/seo/ObdCodeSearch";
import { OBD_SEO_CODES_LIST } from "@/data/obd-seed";
import { SITE_URL } from "@/lib/seo-config";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "OBD-II Code Library — What Every Check Engine Code Means",
  description:
    "Plain-English answers for the most-searched OBD-II diagnostic codes. Can I drive? What does it cost to fix? Mobile-mechanic reviewed.",
  alternates: { canonical: "/obd" },
  openGraph: {
    title: "OBD-II Code Library | Fixo",
    description:
      "Plain-English answers for the most-searched OBD-II diagnostic codes. Can I drive? What does it cost to fix?",
    url: `${SITE_URL}/obd`,
    type: "website",
  },
};

export default function ObdHubPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">
          OBD-II Code Library
        </h1>
        <p className="mt-3 text-base text-text-secondary">
          Plain-English answers for the most-searched check engine codes. Every
          page reviewed by working mobile mechanics — what the code means,
          whether you can drive, and what it actually costs to fix.
        </p>
      </header>

      <ObdCodeSearch codes={OBD_SEO_CODES_LIST} />

      <section className="mt-10 rounded-lg bg-surface-alt p-6 text-center">
        <h2 className="m-0 mb-2 text-lg font-semibold text-text">
          Don&apos;t see your code?
        </h2>
        <p className="m-0 mb-4 text-sm text-text-secondary">
          Fixo&apos;s AI knows every standard OBD-II code — paste yours into the
          diagnostic chat and get a car-specific answer in 90 seconds.
        </p>
        <Link
          href="/chat?utm_source=seo&utm_campaign=obd_hub"
          className="inline-flex items-center justify-center rounded-md bg-red-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary focus-visible:ring-offset-2"
        >
          Diagnose any code for free →
        </Link>
      </section>
    </main>
  );
}
