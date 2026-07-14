import type { KeyAccountFieldRow } from "@/components/crm/cockpit/focus/focus-types";

// Shared "Key account fields" card (SDR Cockpit §6) — renders a workspace's custom
// account fields identically in the dossier and the record peeks. Returns null
// when the account has no custom fields, so callers can drop it cleanly.
export function KeyAccountFields({ fields }: { fields: KeyAccountFieldRow[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-co-border bg-co-sunken-2 p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">Key account fields</span>
        <span className="rounded-full bg-[#eaf3ff] px-2 py-0.5 text-[10px] font-bold text-co-blue-dark">
          Workspace fields
        </span>
      </div>
      <div>
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[118px_1fr] gap-3 border-b border-co-divider py-1.5 last:border-0"
          >
            <span className="text-[11px] font-bold text-co-muted">{field.label}</span>
            <span className="text-[12.5px] font-semibold text-co-ink">{field.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-co-muted-2">
        Field set is configured per workspace — the same component renders any industry&apos;s custom fields.
      </p>
    </div>
  );
}
