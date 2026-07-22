import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0..1
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, ...props }, ref) => (
    <div ref={ref} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} {...props}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150"
        style={{ width: `${Math.round(clampPct(value) * 100)}%` }}
      />
    </div>
  )
);
Progress.displayName = "Progress";

function clampPct(v: number) {
  return Math.min(1, Math.max(0, v));
}
