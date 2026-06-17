"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Shared invest-dialog row: protocol name + live APR + checkbox + amount input.
// Used by both the org pool invest dialog and the employee vault invest dialog.
export function ProtocolRow({
  name,
  apy,
  checked,
  onChecked,
  amount,
  onAmount,
}: {
  name: string;
  apy: number | undefined;
  checked: boolean;
  onChecked: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChecked(v === true)}
      />
      <div className="flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          Live APR: {apy == null ? "…" : `${apy.toFixed(2)}%`}
        </p>
      </div>
      <Input
        type="number"
        inputMode="decimal"
        className="w-32"
        placeholder="USDC"
        value={amount}
        disabled={!checked}
        onChange={(e) => onAmount(e.target.value)}
      />
    </div>
  );
}

export default ProtocolRow;
