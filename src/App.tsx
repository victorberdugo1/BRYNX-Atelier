import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <AppShell />
    </TooltipProvider>
  );
}
