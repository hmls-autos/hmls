// apps/api/src/types/user-context.ts

import type { ContactMethod } from "@hmls/shared/api/contracts/orders";

export interface UserContext {
  id: number;
  name: string;
  email: string;
  phone: string;
  /** Stored profile default — lets the agent confirm instead of re-asking. */
  preferredContact?: ContactMethod | null;
}

export function formatUserContext(user: UserContext): string {
  const lines = [
    `## Current Customer`,
    `- Name: ${user.name}`,
    `- Email: ${user.email}`,
    `- Phone: ${user.phone}`,
    `- Customer ID: ${user.id}`,
  ];
  if (user.preferredContact) {
    lines.push(`- Preferred contact: ${user.preferredContact}`);
  }

  return lines.join("\n");
}
