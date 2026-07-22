import { Search, Settings, Sparkles, BookOpen, Users, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export function TopBar() {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-tight">VFX Lab</span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      <nav className="flex items-center gap-1">
        <Button variant="ghost" size="sm">Effects</Button>
        <Button variant="ghost" size="sm" className="gap-1">
          <Store className="h-3 w-3" /> Marketplace
        </Button>
        <Button variant="ghost" size="sm" className="gap-1">
          <BookOpen className="h-3 w-3" /> Documentation
        </Button>
        <Button variant="ghost" size="sm" className="gap-1">
          <Users className="h-3 w-3" /> Community
        </Button>
      </nav>

      <div className="mx-auto flex w-full max-w-sm items-center gap-2">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search effects, shaders, presets…" className="pl-6" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon">
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-accent to-accent-dim" />
      </div>
    </header>
  );
}
