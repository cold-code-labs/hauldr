export type NavItem = {
  label: string;
  href: string;
  icon: string; // key into the icon set
  ready?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/** The control-plane surface, grouped. `ready` items are live; the rest
 *  render an honest "planned" state until their slice ships. */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Projects", href: "/", icon: "projects", ready: true }],
  },
  {
    label: "Data",
    items: [
      { label: "SQL Editor", href: "/sql", icon: "sql" },
      { label: "Table Editor", href: "/tables", icon: "tables" },
      { label: "Backups", href: "/backups", icon: "backups" },
    ],
  },
  {
    label: "Auth & Access",
    items: [
      { label: "Auth & Users", href: "/auth", icon: "users" },
      { label: "RLS Policies", href: "/rls", icon: "shield" },
      { label: "API & Keys", href: "/keys", icon: "key" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Services", href: "/services", icon: "services" },
      { label: "Logs", href: "/logs", icon: "logs" },
      { label: "Settings", href: "/settings", icon: "settings" },
    ],
  },
];

const READY = new Set(NAV.flatMap((g) => g.items).filter((i) => i.ready).map((i) => i.href));
const TITLES = Object.fromEntries(
  NAV.flatMap((g) => g.items).map((i) => [i.href.replace(/^\//, ""), i.label]),
);

export function sectionTitle(slug: string): string | null {
  return TITLES[slug] ?? null;
}
export function isReady(href: string): boolean {
  return READY.has(href);
}
