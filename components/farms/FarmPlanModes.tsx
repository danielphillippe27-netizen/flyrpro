"use client";
import type { ReactNode } from "react";
import type { FarmAddress, FarmTouch, FarmTouchAddress } from "@/types/database";
import { FarmAnnualCoveragePlan } from "./FarmAnnualCoveragePlan";

export type FarmPlanMode = "touchpoints" | "annual";

export function FarmPlanModes({ farmId, addresses, touches, outcomes, onAddContact, children, mode }: {
  farmId: string;
  addresses: FarmAddress[];
  touches: FarmTouch[];
  outcomes: FarmTouchAddress[];
  onAddContact: (home: FarmAddress) => void;
  children: ReactNode;
  mode: FarmPlanMode;
}) {
  return mode === "annual" ? (
    <FarmAnnualCoveragePlan key={farmId} farmId={farmId} addresses={addresses} touches={touches} outcomes={outcomes} onAddContact={onAddContact} />
  ) : <div className="space-y-4">{children}</div>;
}
