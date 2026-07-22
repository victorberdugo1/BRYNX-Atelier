import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/store/useAppStore";
import { generateRaylibCode, generateReadme, generateShaderSnippet } from "@/codegen/generateRaylibCode";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useMemo } from "react";

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 top-2 z-10"
        onClick={() => navigator.clipboard.writeText(code)}
        title="Copy"
      >
        <Copy className="h-3 w-3" />
      </Button>
      <pre className="h-full w-full overflow-auto whitespace-pre p-3 font-mono text-[11.5px] leading-5 text-foreground/90">
        <code className="block min-h-full">{code}</code>
      </pre>
    </div>
  );
}

export function CodePanel() {
  const codeTab = useAppStore((s) => s.codeTab);
  const setCodeTab = useAppStore((s) => s.setCodeTab);
  const activeEffect = useAppStore((s) => s.activeEffect);
  const params = useAppStore((s) => s.paramsByEffect[s.activeEffect]);

  const code = useMemo(() => generateRaylibCode(activeEffect, params), [activeEffect, params]);
  const shader = useMemo(() => generateShaderSnippet(activeEffect), [activeEffect]);
  const json = useMemo(() => JSON.stringify({ effect: activeEffect, params }, null, 2), [activeEffect, params]);
  const readme = useMemo(() => generateReadme(activeEffect), [activeEffect]);

  const activeCode = codeTab === "shader" ? shader : codeTab === "json" ? json : codeTab === "readme" ? readme : code;

  return (
    <div className="flex h-full flex-col bg-panel">
      <Tabs value={codeTab} onValueChange={(v) => setCodeTab(v as typeof codeTab)} className="flex h-full min-h-0 flex-col">
        <TabsList className="shrink-0">
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="shader">Shader</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
          <TabsTrigger value="readme">README</TabsTrigger>
        </TabsList>
        <div className="mt-0 flex min-h-0 flex-1 flex-col">
          <CodeBlock code={activeCode} />
        </div>
      </Tabs>
    </div>
  );
}
