import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightInspector } from "@/components/layout/RightInspector";
import { CenterViewport } from "@/components/layout/CenterViewport";
import { BottomTimeline } from "@/components/layout/BottomTimeline";
import { CodePanel } from "@/components/layout/CodePanel";
import { ExportPanel } from "@/components/layout/ExportPanel";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { Button } from "@/components/ui/button";
import { useAppStore, type MobileTab } from "@/store/useAppStore";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PanelLeft, PanelRight, Download, Eye, SlidersHorizontal, Code2 } from "lucide-react";
import { cn, clamp } from "@/lib/utils";

const MOBILE_TABS: { id: MobileTab; label: string; icon: typeof Eye }[] = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "parameters", label: "Parameters", icon: SlidersHorizontal },
  { id: "code", label: "Code", icon: Code2 },
  { id: "export", label: "Export", icon: Download },
];

export function AppShell() {
  // Matches Tailwind's `md` breakpoint (used below via `md:flex`/`md:hidden`
  // classes elsewhere in this file). Deciding this in JS — instead of
  // rendering both layouts and CSS-hiding one — means CenterViewport (and
  // therefore ViewportCanvas, its <canvas>, and its WASM/mock renderer
  // attachment) only ever mounts once.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [leftWidth, setLeftWidth] = useState(224);
  const [rightWidth, setRightWidth] = useState(288);
  const [codeHeight, setCodeHeight] = useState(220);

  const leftSidebarOpen = useAppStore((s) => s.leftSidebarOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const mobileTab = useAppStore((s) => s.mobileTab);
  const setMobileTab = useAppStore((s) => s.setMobileTab);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden font-ui text-[13px]">
      <TopBar />

      <div className="flex min-h-0 flex-1 items-center gap-1 border-b border-border bg-panel px-2 py-1 md:hidden">
        <Button variant="ghost" size="icon" onClick={toggleLeftSidebar}>
          <PanelLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="flex-1 text-center text-[11px] text-muted-foreground">Procedural VFX Lab</span>
        <Button variant="ghost" size="icon" onClick={toggleRightPanel}>
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Desktop / tablet docking layout */}
      {isDesktop && (
        <div className="flex min-h-0 flex-1">
          {leftSidebarOpen && (
            <>
              <div style={{ width: leftWidth }} className="shrink-0">
                <LeftSidebar />
              </div>
              <ResizeHandle orientation="vertical" onResize={(d) => setLeftWidth((w) => clamp(w + d, 180, 420))} />
            </>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <CenterViewport />
            </div>
            <ResizeHandle
              orientation="horizontal"
              onResize={(d) => setCodeHeight((h) => clamp(h - d, 120, 480))}
            />
            <div style={{ height: codeHeight }} className="shrink-0 border-t border-border">
              <CodePanel />
            </div>
            <BottomTimeline />
          </div>

          {rightPanelOpen && (
            <>
              <ResizeHandle orientation="vertical" onResize={(d) => setRightWidth((w) => clamp(w - d, 220, 480))} />
              <div style={{ width: rightWidth }} className="shrink-0">
                <RightInspector />
              </div>
            </>
          )}
        </div>
      )}

      {/* Mobile: preview-first tabbed layout */}
      {!isDesktop && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {mobileTab === "preview" && <CenterViewport />}
            {mobileTab === "parameters" && <RightInspector />}
            {mobileTab === "code" && <CodePanel />}
            {mobileTab === "export" && (
              <div className="flex h-full items-center justify-center p-6">
                <ExportPanel
                  trigger={
                    <Button variant="accent" className="gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Open Export
                    </Button>
                  }
                />
              </div>
            )}
          </div>
          {mobileTab === "preview" && <BottomTimeline />}
          <div className="grid grid-cols-4 border-t border-border bg-panel">
            {MOBILE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setMobileTab(t.id)}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[10px]",
                  mobileTab === t.id ? "text-accent" : "text-muted-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
