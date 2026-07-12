import Link from "next/link";
import type { ComponentType } from "react";

export function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  message: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="bg-muted/30 rounded-xl p-8 text-center">
      <Icon className="w-8 h-8 text-text-secondary mx-auto mb-3" />
      <p className="text-text-secondary text-sm">{message}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-block mt-3 text-sm text-red-primary hover:text-red-dark font-medium"
        >
          {action.label} &rarr;
        </Link>
      )}
    </div>
  );
}
