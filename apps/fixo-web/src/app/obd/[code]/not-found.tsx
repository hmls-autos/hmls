// Custom 404 for /obd/[code] when the URL doesn't match a seeded code.
//
// We have 5 codes in OBD_SEO_CODES today; someone hitting /obd/P0301
// or /obd/B1234 gets here. Default Next.js 404 is a dead end — this
// version turns the dead end into a recovery path: keep the user on
// fixo, route them to /obd hub (where they can search) and to /chat
// (where the AI handles any DTC).
//
// We can't read the URL in a not-found.tsx (Next.js doesn't expose
// route params here), so the copy is generic — the user just SAW
// their code in the URL bar, no need to repeat it.

import Link from "next/link";

export default function ObdCodeNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="mb-2 font-mono text-sm uppercase tracking-widest text-text-secondary">
        404 · Code not in library
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">
        We don&apos;t have a page for that code yet.
      </h1>
      <p className="mt-4 text-base text-text-secondary">
        Fixo&apos;s SEO library covers the top 5 most-searched OBD-II codes by
        volume — but the AI itself knows every standard DTC. Two ways forward:
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/chat?utm_source=seo&utm_campaign=obd_not_found"
          className="rounded-lg border border-border bg-red-primary p-5 text-left transition hover:bg-red-dark"
        >
          <p className="m-0 font-semibold text-white">Ask Fixo&apos;s AI →</p>
          <p className="m-0 mt-1 text-sm leading-relaxed text-white/80">
            Paste your code into the chat — get a car-specific diagnosis in
            under 90 seconds. Free to start, no signup wall.
          </p>
        </Link>
        <Link
          href="/obd"
          className="rounded-lg border border-border bg-surface p-5 text-left transition hover:border-border-hover hover:bg-surface-hover"
        >
          <p className="m-0 font-semibold text-text">
            Browse the code library →
          </p>
          <p className="m-0 mt-1 text-sm leading-relaxed text-text-secondary">
            See the codes we have plain-English explainers for. Search by code
            or symptom.
          </p>
        </Link>
      </div>
    </main>
  );
}
