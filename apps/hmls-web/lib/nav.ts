/**
 * Active state for a link inside a section nav — exact match for the section
 * root (so it doesn't stay highlighted on sub-pages), prefix match for child
 * links. Use for sidebar / sub-nav link highlighting.
 */
export function isSectionNavActive(
  pathname: string,
  href: string,
  sectionRoot: string,
): boolean {
  return href === sectionRoot ? pathname === href : pathname.startsWith(href);
}
