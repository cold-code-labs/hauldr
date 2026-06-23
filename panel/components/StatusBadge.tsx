/** Shared status pill — one definition (was duplicated in 3 views). Uses the
 *  Yggdrasil shell `ygg-badge` (tone + dot via color-mix), matching how the rest
 *  of the fleet renders status, instead of the shadcn Badge tone variants whose
 *  `/15` background tint doesn't resolve against CSS-variable colours. */
export function StatusBadge({ status }: { status: string }) {
  const m =
    status === "live"
      ? { tone: "ok", label: "Live" }
      : status === "error"
        ? { tone: "err", label: "Error" }
        : { tone: "warn", label: "Provisioning" };
  return (
    <span className="ygg-badge" data-tone={m.tone}>
      {m.label}
    </span>
  );
}
