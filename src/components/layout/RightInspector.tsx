import { useMemo } from "react";
import { EFFECT_DEFINITIONS } from "@/types/effects";
import { useAppStore } from "@/store/useAppStore";
import { ParamField } from "@/components/effects/ParamField";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export function RightInspector() {
  const activeEffect = useAppStore((s) => s.activeEffect);
  const params = useAppStore((s) => s.paramsByEffect[s.activeEffect]);
  const setParam = useAppStore((s) => s.setParam);
  const resetParams = useAppStore((s) => s.resetParams);

  const def = EFFECT_DEFINITIONS[activeEffect];

  const groups = useMemo(() => {
    const map = new Map<string, typeof def.params>();
    for (const p of def.params) {
      const key = p.group ?? "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [def]);

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-panel">
      <div className="flex h-8 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Inspector</span>
        <Button variant="ghost" size="icon" onClick={() => resetParams(activeEffect)} title="Reset to defaults">
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
      <div className="border-b border-border px-3 pb-2">
        <p className="text-[13px] font-medium">{def.name}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        {groups.map(([group, schemas]) => (
          <div key={group} className="border-b border-border/60 py-1 last:border-b-0">
            <p className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {group}
            </p>
            <div className="divide-y divide-border/40">
              {schemas.map((schema) => (
                <ParamField
                  key={schema.key}
                  schema={schema}
                  value={params[schema.key]}
                  onChange={(v) => setParam(activeEffect, schema.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
