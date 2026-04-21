export interface StatusConfig {
  label: string;
  color: string;
}

export const BOOKING_STATUS: Record<string, StatusConfig> = {
  requested: {
    label: "Requested",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  confirmed: {
    label: "Confirmed",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  in_progress: {
    label: "In Progress",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  completed: {
    label: "Completed",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  cancelled: {
    label: "Cancelled",
    color:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  },
};

export const ORDER_STATUS: Record<string, StatusConfig> = {
  draft: {
    label: "Draft",
    color:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  estimated: {
    label: "Estimated",
    color:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  },
  approved: {
    label: "Approved",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  declined: {
    label: "Declined",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  revised: {
    label: "Revised",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  scheduled: {
    label: "Scheduled",
    color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  },
  in_progress: {
    label: "In Progress",
    color:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  completed: {
    label: "Completed",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  cancelled: {
    label: "Cancelled",
    color:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  },
};

/** Portal-facing order status labels (slightly different from admin). */
export const PORTAL_ORDER_STATUS: Record<string, StatusConfig> = {
  ...ORDER_STATUS,
  draft: {
    label: "Preparing",
    color:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  estimated: {
    label: "Estimate Ready",
    color:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  },
  revised: {
    label: "Updated Estimate",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
};

export const QUOTE_STATUS: Record<string, StatusConfig> = {
  draft: {
    label: "Draft",
    color:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  sent: {
    label: "Sent",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  accepted: {
    label: "Accepted",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  paid: {
    label: "Paid",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  declined: {
    label: "Declined",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  expired: {
    label: "Expired",
    color:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  },
};

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ["estimated", "cancelled"],
  estimated: ["approved", "declined", "cancelled"],
  declined: ["revised"],
  revised: ["estimated", "cancelled"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Statuses where order items and notes are editable by admin. */
export const EDITABLE_STATUSES = ["draft", "revised"];

/* ── Progress bar step model ──────────────────────────────────────────── */

export const ORDER_MAIN_STEPS = [
  "draft",
  "estimated",
  "approved",
  "scheduled",
  "in_progress",
  "completed",
] as const;

export type OrderMainStep = (typeof ORDER_MAIN_STEPS)[number];

export const ORDER_STEP_LABELS_ADMIN: Record<string, string> = {
  draft: "Draft",
  estimated: "Estimated",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
};

export const ORDER_STEP_LABELS_PORTAL: Record<string, string> = {
  draft: "Preparing",
  estimated: "Estimate Ready",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Complete",
};

export const ORDER_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
]);

export const ORDER_BRANCH_STATUSES: ReadonlySet<string> = new Set([
  "declined",
  "revised",
]);

export type OrderStepState = "completed" | "current" | "pending";

export function getOrderStepState(
  stepStatus: string,
  currentStatus: string,
): OrderStepState {
  const currentIdx = ORDER_MAIN_STEPS.indexOf(currentStatus as OrderMainStep);
  const stepIdx = ORDER_MAIN_STEPS.indexOf(stepStatus as OrderMainStep);

  if (currentIdx === -1) {
    // Branch: declined/revised sit between estimated and approved.
    if (currentStatus === "declined" || currentStatus === "revised") {
      const effectiveIdx = ORDER_MAIN_STEPS.indexOf("estimated");
      return stepIdx <= effectiveIdx ? "completed" : "pending";
    }
    // cancelled — unknown progress, show only start as completed.
    return stepIdx === 0 ? "completed" : "pending";
  }

  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}
