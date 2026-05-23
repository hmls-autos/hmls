"use client";

// Client-side search + filter for the /obd hub.
//
// Why client-side: the OBD_SEO_CODES_LIST is bounded (5 entries today,
// 30 if the推广 plan validates). Filtering 30 strings in the browser is
// trivially fast and avoids a server roundtrip per keystroke. SSG-friendly.
//
// UX: input above the card grid. Empty input = show all cards. Typing
// matches against code prefix OR substring of the description /
// headline. Zero matches = a friendly "code not in our library yet"
// CTA back to /chat with the user's typed code prepended.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ObdSeoEntry } from "@/data/obd-seed";

interface ObdCodeSearchProps {
  codes: readonly ObdSeoEntry[];
}

const TIER_LABEL: Record<string, { label: string; classes: string }> = {
  ok_to_drive: {
    label: "Safe to drive",
    classes: "text-emerald-700 dark:text-emerald-400",
  },
  drive_cautiously: {
    label: "Drive cautiously",
    classes: "text-amber-700 dark:text-amber-400",
  },
  do_not_drive: {
    label: "Don't drive",
    classes: "text-red-700 dark:text-red-400",
  },
};

function normalize(s: string): string {
  return s.trim().toUpperCase();
}

export function ObdCodeSearch({ codes }: ObdCodeSearchProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return codes;
    return codes.filter((entry) => {
      // Match if the query starts the code (P04 → P0420), or appears
      // anywhere in the system/headline/description.
      const haystack = [
        entry.code,
        entry.system,
        entry.headline,
        entry.description,
      ]
        .join(" ")
        .toUpperCase();
      return haystack.includes(q);
    });
  }, [codes, query]);

  const trimmed = query.trim();
  const queryLooksLikeCode = /^[PpBbCcUu]\d{3,4}$/i.test(trimmed);

  return (
    <div>
      <label htmlFor="obd-search" className="sr-only">
        Search OBD-II codes
      </label>
      <input
        id="obd-search"
        type="search"
        autoComplete="off"
        inputMode="search"
        placeholder="Enter your code (e.g. P0420) or a symptom"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-text-secondary focus:border-border-hover focus:outline-none focus:ring-2 focus:ring-red-primary/30"
      />

      {filtered.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {filtered.map((entry) => {
            const tier = TIER_LABEL[entry.driveSafetyTier];
            return (
              <li key={entry.code}>
                <Link
                  href={`/obd/${entry.code}`}
                  className="block rounded-lg border border-border bg-surface p-5 transition hover:border-border-hover hover:bg-surface-hover"
                >
                  <p className="m-0 font-mono text-xs uppercase tracking-widest text-text-secondary">
                    {entry.code} · {entry.system}
                  </p>
                  <h2 className="mt-1 mb-2 text-lg font-semibold leading-snug text-text">
                    {entry.headline}
                  </h2>
                  <p
                    className={`m-0 text-xs font-semibold uppercase tracking-wider ${tier.classes}`}
                  >
                    {tier.label}
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-relaxed text-text-secondary">
                    {entry.oneLineVerdict}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-border bg-surface-alt p-6 text-center">
          <h2 className="m-0 mb-2 text-base font-semibold text-text">
            We don&apos;t have a page for{" "}
            <span className="font-mono">{trimmed || "that code"}</span> yet.
          </h2>
          <p className="m-0 mb-4 text-sm text-text-secondary">
            {queryLooksLikeCode
              ? "Paste it into Fixo's AI for a car-specific diagnosis in under 90 seconds."
              : "Try a code (e.g. P0420) or describe the symptom — Fixo's AI handles any standard OBD-II code."}
          </p>
          <Link
            href={`/chat?utm_source=seo&utm_campaign=obd_hub_fallback${
              queryLooksLikeCode ? `&q=${encodeURIComponent(trimmed)}` : ""
            }`}
            className="inline-flex items-center justify-center rounded-md bg-red-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary focus-visible:ring-offset-2"
          >
            Diagnose with AI →
          </Link>
        </div>
      )}
    </div>
  );
}
