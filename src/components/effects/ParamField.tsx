import type { ParamSchema, EffectParamValue } from "@/types/effects";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

interface ParamFieldProps {
  schema: ParamSchema;
  value: EffectParamValue;
  onChange: (value: EffectParamValue) => void;
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

      {schema.type === "color" && (
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

      {schema.type === "string" && (
        <Input value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      )}
    </div>
  );
}
