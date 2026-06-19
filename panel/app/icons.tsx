// Minimal line-icon set (stroke = currentColor). Keyed by name for the nav.
const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Icon({ name }: { name: string }) {
  switch (name) {
    case "projects":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "sql":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <path d="m8 9-3 3 3 3" />
          <path d="m16 9 3 3-3 3" />
        </svg>
      );
    case "tables":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18M9 4v16" />
        </svg>
      );
    case "backups":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 11a3 3 0 0 0 0-6M20.5 20a5.5 5.5 0 0 0-4-5.3" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "key":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <circle cx="8" cy="14" r="4" />
          <path d="m10.5 11.5 8-8M16 4l3 3M14 6l2.5 2.5" />
        </svg>
      );
    case "services":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <rect x="3" y="4" width="18" height="6" rx="2" />
          <rect x="3" y="14" width="18" height="6" rx="2" />
          <path d="M7 7h.01M7 17h.01" />
        </svg>
      );
    case "logs":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      );
    case "logout":
      return (
        <svg viewBox="0 0 24 24" {...P}>
          <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 12h9M16 9l3 3-3 3" />
        </svg>
      );
    default:
      return null;
  }
}

export function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" className="brand-mark" fill="none">
      <defs>
        <linearGradient id="hold-g" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#5ad1e8" />
          <stop offset="1" stopColor="#8b7cf6" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5 4.5 5.6v5.2c0 4.7 3.2 8.9 7.5 10.2 4.3-1.3 7.5-5.5 7.5-10.2V5.6L12 2.5Z"
        stroke="url(#hold-g)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m8.6 12 2.3 2.3L15.6 9.6"
        stroke="url(#hold-g)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
