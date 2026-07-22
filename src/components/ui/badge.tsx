import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide", {
  variants: {
    variant: {
      default: "bg-panel-raised text-muted-foreground border border-border",
      accent: "bg-accent/15 text-accent border border-accent/30",
      success: "bg-success/15 text-success border border-success/30",
      warning: "bg-warning/15 text-warning border border-warning/30",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
