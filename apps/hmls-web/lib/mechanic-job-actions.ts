// Pure logic behind the mechanic job card's big Start / Complete button.
// Kept out of the page component so bun can unit-test it (mirrors the
// admin-side order-actions.ts pattern).

import { completionMissingDiagnosis } from "@hmls/shared/order/status";
import { canonicalStatus } from "@/lib/status-display";

export type MechanicJobAction = {
  label: "Start" | "Complete";
  busyLabel: "Starting…" | "Completing…";
  to: "in_progress" | "completed";
};

/** Which big button (if any) the job card shows. Every order on the mechanic
 *  page is already the mechanic's own, so visibility is status-only:
 *  approved → Start, in_progress → Complete, everything else → none. */
export function mechanicJobAction(status: string): MechanicJobAction | null {
  switch (canonicalStatus(status)) {
    case "approved":
      return { label: "Start", busyLabel: "Starting…", to: "in_progress" };
    case "in_progress":
      return { label: "Complete", busyLabel: "Completing…", to: "completed" };
    default:
      return null;
  }
}

/** Run a job action, mirroring the admin complete_job semantics: completing
 *  an order with no confirmed diagnosis soft-prompts for one (cancel backs
 *  out, blank completes without it). Start transitions immediately. */
export async function invokeMechanicJobAction(
  action: MechanicJobAction,
  order: { confirmedDiagnosis?: string | null },
  transition: (
    to: MechanicJobAction["to"],
    confirmedDiagnosis?: string,
  ) => Promise<void>,
  askReason: (opts: {
    title: string;
    description?: string;
  }) => Promise<string | null>,
): Promise<void> {
  if (
    action.to === "completed" &&
    completionMissingDiagnosis("completed", order.confirmedDiagnosis)
  ) {
    const d = await askReason({
      title: "What did it turn out to be?",
      description:
        "Recording the confirmed diagnosis trains the estimate engine. " +
        "Leave blank to complete without it.",
    });
    if (d === null) return; // backed out of completing
    await transition("completed", d.trim() || undefined);
    return;
  }
  await transition(action.to);
}
