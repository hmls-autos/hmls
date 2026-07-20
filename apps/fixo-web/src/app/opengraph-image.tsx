import { ImageResponse } from "next/og";
import { geistBlack, geistBold, geistRegular } from "./_fonts/geist";

// No `runtime = "edge"`: OpenNext runs the whole app in workerd node-compat and
// does not support Next's edge runtime. OpenNext serves this param-less
// metadata route through the DYNAMIC handler on workerd (not the prerendered
// PNG), so the Geist fonts are base64-embedded (./_fonts/geist) rather than
// read from disk — node:fs is unimplemented on workerd. See
// docs/cloudflare-migration.md Phase 2.
export const alt =
  "Fixo — AI car diagnosis in 30 seconds from a photo, sound, or OBD-II code";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const [regular, bold, black] = [geistRegular, geistBold, geistBlack];

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
        padding: "72px 80px",
        fontFamily: "Geist",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Faint OBD code rain in background — keeps brand consistent */}
      {[
        "P0420",
        "P0171",
        "P0300",
        "P0442",
        "P0128",
        "B1234",
        "C0035",
        "U0100",
        "P0455",
        "P0401",
      ].map((code, i) => (
        <span
          key={code}
          style={{
            position: "absolute",
            top: `${10 + (i % 4) * 25}%`,
            left: `${5 + (i % 5) * 20}%`,
            fontFamily: "ui-monospace, monospace",
            fontSize: 18,
            fontWeight: 700,
            color: "rgba(99, 153, 255, 0.10)",
          }}
        >
          {code}
        </span>
      ))}

      {/* Wordmark */}
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

      {/* Headline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 16,
            color: "#3b82f6",
            letterSpacing: "0.18em",
            fontWeight: 700,
          }}
        >
          AI VEHICLE DIAGNOSTICS
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
            color: "#fafafa",
            maxWidth: 950,
          }}
        >
          Walk into the shop already knowing the answer.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "rgba(250, 250, 250, 0.65)",
            maxWidth: 900,
          }}
        >
          Photo, sound, or OBD-II code in. Real diagnosis with cost estimate out
          — in 30 seconds.
        </div>
      </div>

      {/* Footer trust line */}
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
        <div style={{ display: "flex" }}>FREE TO START · NO CREDIT CARD</div>
        <div style={{ display: "flex", color: "#3b82f6" }}>fixo.ink</div>
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
