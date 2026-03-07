"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import { AGENT_URL } from "@/lib/config";

export interface EstimateCardData {
  success: boolean;
  estimateId?: number;
  vehicle: string;
  items: Array<{ name: string; description?: string; price: number }>;
  subtotal: number;
  priceRange: string;
  expiresAt?: string;
  shareUrl?: string;
  downloadUrl?: string;
  note?: string;
}

interface EstimateCardProps {
  data: EstimateCardData;
}

export function EstimateCard({ data }: EstimateCardProps) {
  const pdfUrl = data.shareUrl ? `${AGENT_URL}${data.shareUrl}` : null;
  const downloadLink = data.downloadUrl
    ? `${AGENT_URL}${data.downloadUrl}`
    : pdfUrl;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-primary text-white text-xs shrink-0">
          <FileText className="w-3.5 h-3.5" />
        </div>
        <span className="font-semibold text-text text-sm">
          Estimate {data.estimateId ? `#${data.estimateId}` : ""}
        </span>
        <span className="text-xs text-text-secondary ml-1">{data.vehicle}</span>
        {data.note && (
          <span className="ml-auto text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
            Not saved
          </span>
        )}
      </div>

      {/* Line items */}
      <div className="px-4 py-3 space-y-1.5">
        {data.items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            className="flex justify-between text-sm"
          >
            <div className="flex-1 min-w-0">
              <span className="text-text">{item.name}</span>
              {item.description && (
                <span className="text-text-secondary text-xs ml-1 truncate">
                  — {item.description}
                </span>
              )}
            </div>
            <span className="font-medium text-text ml-3 tabular-nums">
              ${item.price.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-4 py-3 border-t border-border bg-surface-alt">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Subtotal</span>
          <span className="font-semibold text-text tabular-nums">
            ${data.subtotal.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-text-secondary">Estimated Range</span>
          <span className="font-semibold text-text">{data.priceRange}</span>
        </div>
        {data.expiresAt && (
          <p className="text-xs text-text-secondary mt-2">
            Valid until{" "}
            {new Date(data.expiresAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      {/* Actions */}
      {pdfUrl && (
        <div className="px-4 py-2.5 border-t border-border flex items-center gap-3">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-red-primary hover:opacity-80 transition-opacity flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View PDF
          </a>
          {downloadLink && (
            <a
              href={downloadLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-red-primary hover:opacity-80 transition-opacity flex items-center gap-1 ml-auto"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
        </div>
      )}
    </div>
  );
}
