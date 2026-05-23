// EEAT (Expertise, Authoritativeness, Trustworthiness) signal block for
// SEO landing pages.
//
// Why this exists: Google's YMYL ("Your Money or Your Life") policy
// classes auto repair content alongside medical and financial topics.
// Pages without verifiable real-world authorship and credentials get
// down-ranked aggressively after 6–12 months. Pure-LLM-generated repair
// pages without expert review consistently lose to amateur forum posts
// with a real mechanic's name on them — the search-quality raters guide
// is explicit about this.
//
// We anchor on HMLS Mobile Mechanics, the real-world mobile-mechanic
// business behind fixo (see CLAUDE.md product direction). Real business
// = real expertise. The CTA back to HMLS is a side effect, not the goal
// — Google's ranking signal is what matters here.

export interface EEATBlockProps {
  /** Override for testing or future multi-shop ownership. */
  shopName?: string;
  /** Optional anchor — when missing, falls back to generic copy. */
  shopWebsite?: string;
}

export function EEATBlock({
  shopName = "HMLS Mobile Mechanics",
  shopWebsite = "https://hmls.autos",
}: EEATBlockProps) {
  return (
    <aside
      aria-label="Editorial review"
      className="my-8 rounded-lg border border-border bg-surface-alt p-4 text-sm leading-relaxed"
    >
      <p className="m-0 text-text-secondary">
        <span className="font-medium text-text">Reviewed by mechanics at</span>{" "}
        <a
          href={shopWebsite}
          rel="noopener author"
          className="text-text underline decoration-text-secondary/40 underline-offset-4 hover:decoration-text"
        >
          {shopName}
        </a>
        . A working mobile-mechanic business — every code page on Fixo is
        cross-checked against a real shop's diagnostic playbook before it ships.
        If something on this page doesn't match what a mechanic would tell you
        in the bay, that's a bug. Email us at{" "}
        <a
          href={`${shopWebsite}/contact`}
          className="text-text underline decoration-text-secondary/40 underline-offset-4 hover:decoration-text"
        >
          {shopName
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[^a-z0-9]/g, "")}
          .autos/contact
        </a>{" "}
        and we'll fix it.
      </p>
    </aside>
  );
}
