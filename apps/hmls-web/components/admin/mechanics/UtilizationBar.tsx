import { cn } from "@/lib/utils";

interface Props {
  percent: number | null;
  className?: string;
}

function colorClasses(percent: number): string {
  if (percent < 40) return "bg-muted-foreground/40";
  if (percent < 80) return "bg-foreground/70";
  if (percent < 95) return "bg-amber-500";
  return "bg-red-500";
}

export function UtilizationBar({ percent, className }: Props) {
  if (percent == null) {
    return (
      <div className={cn("flex items-center gap-2 text-xs", className)}>
        <div className="h-2 flex-1 rounded-full bg-muted" />
        <span className="text-muted-foreground">No hours set</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(percent, 100));
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", colorClasses(percent))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-medium tabular-nums text-foreground w-10 text-right">
        {percent}%
      </span>
    </div>
  );
}
