/** Validate a ?next= value. Only same-origin relative paths survive —
 *  open-redirect guard. Returns null when the value must be ignored. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // WHATWG URL parsing strips \t\n\r from the WHOLE string before resolving,
  // so "/\t/evil.example" would become protocol-relative "//evil.example".
  // Reject them outright — prefix checks alone can't see through the strip.
  if (/[\t\n\r]/.test(raw)) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw === "/login" || raw.startsWith("/login?")) return null;
  return raw;
}

/** Where a user lands after login when no explicit destination was asked. */
export function roleHomePath(roles: {
  isAdmin: boolean;
  isMechanic: boolean;
}): string {
  if (roles.isAdmin) return "/admin";
  if (roles.isMechanic) return "/mechanic";
  return "/chat";
}
