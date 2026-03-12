"use client";

const TOOL_LABELS: Record<string, string> = {
  analyze_photo: "Analyzing photo...",
  analyze_audio: "Analyzing audio...",
  lookup_obd_code: "Looking up OBD code...",
  search_tsb: "Searching technical bulletins...",
  get_repair_estimate: "Estimating repair costs...",
};

export function ToolIndicator({ tool }: { tool: string }) {
  const label = TOOL_LABELS[tool] || `Running ${tool}...`;

  return (
    <div className="flex justify-start">
      <div className="bg-surface-alt rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-text-secondary flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        {label}
      </div>
    </div>
  );
}
