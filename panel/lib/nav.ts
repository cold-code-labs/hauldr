export type NavItem = {
  label: string;
  /** For org nav: an absolute href. For project nav: the section slug ("" = overview). */
  href: string;
  icon: string;
  ready?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/** Organization-level nav — what you see when no project is selected. */
export const ORG_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: "dashboard", ready: true },
      { label: "Projects", href: "/projects", icon: "projects", ready: true },
    ],
  },
];

/** Project-scoped nav — shown once a project is selected. `href` is the section
 *  slug; the sidebar prefixes it with /project/<name>. "" is the overview. */
export const PROJECT_NAV: NavGroup[] = [
  {
    label: "Project",
    items: [{ label: "Overview", href: "", icon: "overview", ready: true }],
  },
  {
    label: "Data",
    items: [
      { label: "SQL Editor", href: "sql", icon: "sql" },
      { label: "Table Editor", href: "tables", icon: "tables" },
      { label: "Backups", href: "backups", icon: "backups" },
    ],
  },
  {
    label: "Auth & Access",
    items: [
      { label: "Auth & Users", href: "auth", icon: "users" },
      { label: "RLS Policies", href: "rls", icon: "shield" },
      { label: "API & Keys", href: "keys", icon: "key" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Services", href: "services", icon: "services", ready: true },
      { label: "Logs", href: "logs", icon: "logs" },
      { label: "Settings", href: "settings", icon: "settings" },
    ],
  },
];

const SECTIONS = Object.fromEntries(
  PROJECT_NAV.flatMap((g) => g.items)
    .filter((i) => i.href)
    .map((i) => [i.href, i]),
);

/** Title for a project section slug, or null if it isn't one. */
export function sectionTitle(slug: string): string | null {
  return SECTIONS[slug]?.label ?? null;
}

/** Whether a project section is live (vs. a planned "soon" stub). */
export function sectionReady(slug: string): boolean {
  return !!SECTIONS[slug]?.ready;
}
