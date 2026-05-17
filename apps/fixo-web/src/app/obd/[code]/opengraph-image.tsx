// Per-OBD-code Open Graph image.
//
// Next.js calls this file at build time for every generateStaticParams
// permutation, producing a static PNG that Twitter/Slack/Discord/etc
// embed when someone shares /obd/<code>. Without this, social shares
// of code pages fall back to the root opengraph-image.tsx — generic
// branding, no code-specific content, easy to miss as you scroll.
//
// Image content (1200x630):
//   - Top-left: Fixo wordmark + "OBD-II CODE LIBRARY" rail
//   - Center: huge code (P0420), verdict tier-colored badge, headline
//   - Bottom: fixo.ink + "Free to start · Mechanic reviewed"
//
// Font handling: the root image uses ./_fonts/ relative to its file.
// Our depth is /obd/[code], so we reach back via ../../_fonts/. The
// new URL(..., import.meta.url) must be a string literal for webpack
// to resolve at build time.

import { ImageResponse } from "next/og";
import { OBD_SEO_CODES, OBD_SEO_CODES_LIST } from "@/data/obd-seed";

export const runtime = "edge";
export const alt = "Fixo OBD-II code explainer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateImageMetadata() {
  return OBD_SEO_CODES_LIST.map((entry) => ({
    id: entry.code,
    alt: `${entry.code} — ${entry.headline}`,
    contentType: "image/png",
    size,
  }));
}

const GEIST_REGULAR_URL = new URL(
  "../../_fonts/Geist-Regular.ttf",
  import.meta.url,
);
const GEIST_BOLD_URL = new URL("../../_fonts/Geist-Bold.ttf", import.meta.url);
const GEIST_BLACK_URL = new URL(
  "../../_fonts/Geist-Black.ttf",
  import.meta.url,
);

async function fetchFont(url: URL): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${url}`);
  return res.arrayBuffer();
}

// Color tokens shared with the on-page tier badge so the OG card
// visually matches what users see when they click through.
const TIER_COLORS: Record<string, { bg: string; text: string; label: string }> =
  {
    ok_to_drive: {
      bg: "rgba(16, 185, 129, 0.18)",
      text: "#34d399",
      label: "SAFE TO DRIVE",
    },
    drive_cautiously: {
      bg: "rgba(245, 158, 11, 0.18)",
      text: "#fbbf24",
      label: "DRIVE CAUTIOUSLY",
    },
    do_not_drive: {
      bg: "rgba(239, 68, 68, 0.20)",
      text: "#f87171",
      label: "DON'T DRIVE",
    },
  };

export default async function Image({ params }: { params: { code: string } }) {
  const entry = OBD_SEO_CODES[params.code];
  // Defensive: generateImageMetadata limits this to OBD_SEO_CODES_LIST
  // entries, so this branch shouldn't fire in production. Belt-and-
  // suspenders fallback if Next.js ever pre-renders a code we removed.
  if (!entry) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", background: "#0a0a0a" }} />,
      size,
    );
  }

  const tier = TIER_COLORS[entry.driveSafetyTier];

  const [regular, bold, black] = await Promise.all([
    fetchFont(GEIST_REGULAR_URL),
    fetchFont(GEIST_BOLD_URL),
    fetchFont(GEIST_BLACK_URL),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0a0a0a",
        color: "#fafafa",
        padding: "64px 72px",
        fontFamily: "Geist",
      }}
    >
      {/* Top: brand + section rail */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#3b82f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            F
          </div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>
            Fixo<span style={{ color: "#3b82f6" }}>.</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "ui-monospace, monospace",
            fontSize: 14,
            color: "rgba(250, 250, 250, 0.55)",
            letterSpacing: "0.18em",
            fontWeight: 700,
          }}
        >
          OBD-II CODE LIBRARY
        </div>
      </div>

      {/* Center: the code + verdict + headline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "ui-monospace, monospace",
              fontSize: 128,
              fontWeight: 800,
              color: "#fafafa",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {entry.code}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.15em",
              padding: "10px 18px",
              borderRadius: 999,
              background: tier.bg,
              color: tier.text,
            }}
          >
            {tier.label}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            color: "#fafafa",
            maxWidth: 1050,
          }}
        >
          {entry.headline}
        </div>
      </div>

      {/* Bottom: trust + url */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "ui-monospace, monospace",
          fontSize: 16,
          color: "rgba(250, 250, 250, 0.55)",
          letterSpacing: "0.08em",
        }}
      >
        <div style={{ display: "flex" }}>
          REVIEWED BY MOBILE MECHANICS · FREE TO START
        </div>
        <div style={{ display: "flex", color: "#3b82f6" }}>
          fixo.ink/obd/{entry.code}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
        { name: "Geist", data: black, weight: 800, style: "normal" },
      ],
    },
  );
}
