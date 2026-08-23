"use client";

import { useState } from "react";
import { ROLE_NAMES, roleLabel } from "@/lib/types";

// "auto" isn't a real role_name -- it's the pre-existing "project at her
// own current minutes, scaled for the target team's strength" fallback
// (see project_player()'s docstring). Included here as a selectable lane
// alongside the 4 real roles so a coach can compare "what she'd naturally
// project to" against 1-2 specific roles in the same results view.
const OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto (current minutes, scaled)" },
  ...ROLE_NAMES.map((r) => ({ value: r, label: roleLabel(r) })),
];

const MAX_ROLES = 3;

/**
 * Up to MAX_ROLES checkboxes, all sharing name="role" so FilterForm submits
 * them as repeated query params (?role=starter&role=role_player, same
 * convention as the stat checkboxes on Team Fits) -- the results page then
 * runs one /project call per checked value and renders them side by side,
 * instead of the old single-role dropdown that could only show one
 * projection at a time. Once 3 are checked, the rest disable rather than
 * silently accepting a 4th (which the results page would just ignore) --
 * so the limit is visible, not a surprise after submitting.
 */
export default function RoleCheckboxGroup({ defaultValues }: { defaultValues?: string[] }) {
  const [checked, setChecked] = useState<string[]>(defaultValues && defaultValues.length > 0 ? defaultValues : ["auto"]);

  function toggle(value: string) {
    setChecked((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= MAX_ROLES) return prev;
      return [...prev, value];
    });
  }

  return (
    <div className="field">
      <label>Compare up to {MAX_ROLES} roles</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        {OPTIONS.map((o) => {
          const isChecked = checked.includes(o.value);
          const disabled = !isChecked && checked.length >= MAX_ROLES;
          return (
            <label
              key={o.value}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: "0.88rem",
                minWidth: "auto",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <input
                type="checkbox"
                name="role"
                value={o.value}
                checked={isChecked}
                disabled={disabled}
                onChange={() => toggle(o.value)}
                style={{ minWidth: "auto", width: 16 }}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      <p className="section-note" style={{ marginTop: 6, marginBottom: 0 }}>
        {checked.length}/{MAX_ROLES} selected. Setting exact minutes below overrides this entirely (a coach-set
        number always wins over any role).
      </p>
    </div>
  );
}
