"use client";
import { useEffect, useState, type ReactNode } from "react";
import type {
  FarmAddress,
  FarmTouch,
  FarmTouchAddress,
} from "@/types/database";
import { FarmAnnualCoveragePlan } from "./FarmAnnualCoveragePlan";

export function FarmPlanModes({
  farmId,
  addresses,
  touches,
  outcomes,
  onAddContact,
  children,
}: {
  farmId: string;
  addresses: FarmAddress[];
  touches: FarmTouch[];
  outcomes: FarmTouchAddress[];
  onAddContact: (home: FarmAddress) => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"touchpoints" | "annual">("touchpoints");
  const [annualOpened, setAnnualOpened] = useState(false);
  useEffect(() => {
    try {
      const annual =
        localStorage.getItem(`wolfgrid:farm-plan-mode:${farmId}`) === "annual";
      setMode(annual ? "annual" : "touchpoints");
      setAnnualOpened(annual);
    } catch {
      setMode("touchpoints");
    }
  }, [farmId]);
  function choose(value: typeof mode) {
    setMode(value);
    if (value === "annual") setAnnualOpened(true);
    try {
      localStorage.setItem(`wolfgrid:farm-plan-mode:${farmId}`, value);
    } catch {
      /* The plan itself is saved on the farm, even if browser preferences are unavailable. */
    }
  }
  return (
    <div className="space-y-5">
      <div
        className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        role="group"
        aria-label="Farm planning mode"
      >
        {(
          [
            { value: "touchpoints", label: "Touchpoint plan" },
            { value: "annual", label: "Annual farm coverage" },
          ] as const
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={mode === item.value}
            onClick={() => choose(item.value)}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-ring ${mode === item.value ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div hidden={mode !== "touchpoints"} className="space-y-4">
        {children}
      </div>
      {(annualOpened || mode === "annual") && (
        <div hidden={mode !== "annual"}>
          <FarmAnnualCoveragePlan
            key={farmId}
            farmId={farmId}
            addresses={addresses}
            touches={touches}
            outcomes={outcomes}
            onAddContact={onAddContact}
          />
        </div>
      )}
    </div>
  );
}
