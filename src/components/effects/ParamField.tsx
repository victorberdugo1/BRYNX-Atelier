import { useRef } from "react";
import type { ParamSchema, EffectParamValue } from "@/types/effects";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

interface ParamFieldProps {
  schema: ParamSchema;
  value: EffectParamValue;
  onChange: (value: EffectParamValue) => void;
}

// Splits "#RRGGBB" or "#RRGGBBAA" into its RGB part (always 6 digits, for the
// native <input type="color"> which has no alpha support) and 0-255 alpha
// (defaults to fully opaque if the string has no alpha digits yet).
function splitRgbA(hex: string): { rgb: string; alpha: number } {
  const clean = hex.replace(/^#/, "");
  const rgb = `#${(clean.slice(0, 6) || "000000").padEnd(6, "0")}`;
  const alphaHex = clean.slice(6, 8);
  const alpha = alphaHex.length === 2 ? parseInt(alphaHex, 16) : 255;
  return { rgb, alpha: Number.isNaN(alpha) ? 255 : alpha };
}

function composeRgbA(rgb: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, "0");
  return `${rgb}${a}`.toUpperCase();
}

// Dedicated component (not inlined) so it can hold its own hook state: it
// remembers the last non-zero alpha the user picked, so toggling the
// "Background" switch back on after turning it off restores that value
// instead of jumping to some arbitrary default.
function ColorAlphaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { rgb, alpha } = splitRgbA(value);
  const lastAlphaRef = useRef(alpha > 0 ? alpha : 255);
  if (alpha > 0) lastAlphaRef.current = alpha;

  const hasBackground = alpha > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={rgb}
          onChange={(e) => onChange(composeRgbA(e.target.value, alpha))}
          className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono uppercase" />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Background</span>
        <Switch
          checked={hasBackground}
          onCheckedChange={(checked) => onChange(composeRgbA(rgb, checked ? lastAlphaRef.current : 0))}
        />
      </div>

      {hasBackground && (
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] text-muted-foreground">Alpha</span>
          <Slider
            min={0}
            max={255}
            step={1}
            value={[alpha]}
            onValueChange={([a]) => onChange(composeRgbA(rgb, a))}
          />
          <span className="w-9 shrink-0 text-right font-mono text-[10px] text-foreground/80 tabular-nums">
            {Math.round((alpha / 255) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

export function ParamField({ schema, value, onChange }: ParamFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-muted-foreground">{schema.label}</label>
        {(schema.type === "float" || schema.type === "int") && (
          <span className="font-mono text-[10px] text-foreground/80 tabular-nums">
            {schema.type === "int" ? Math.round(Number(value)) : Number(value).toFixed(2)}
          </span>
        )}
      </div>

      {(schema.type === "float" || schema.type === "int") && (
        <Slider
          min={schema.min ?? 0}
          max={schema.max ?? 1}
          step={schema.step ?? (schema.type === "int" ? 1 : 0.01)}
          value={[Number(value)]}
          onValueChange={([v]) => onChange(schema.type === "int" ? Math.round(v) : v)}
        />
      )}

      {schema.type === "bool" && (
        <div className="flex justify-end">
          <Switch checked={Boolean(value)} onCheckedChange={(v) => onChange(v)} />
        </div>
      )}

      {schema.type === "color" && !schema.alpha && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
          />
          <Input
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono uppercase"
          />
        </div>
      )}

      {schema.type === "color" && schema.alpha && (
        <ColorAlphaField value={String(value)} onChange={(v) => onChange(v)} />
      )}

      {schema.type === "string" && (
        <Input value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      )}
    </div>
  );
}
