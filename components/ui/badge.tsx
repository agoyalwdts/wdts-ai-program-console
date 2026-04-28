import * as React from "react";
import { cn } from "@/lib/utils";

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "danger"
  | "violet"
  | "blue"
  | "slate";

const VARIANTS: Record<Variant, string> = {
  default: "bg-slate-900 text-white border-transparent",
  secondary: "bg-slate-100 text-slate-700 border-transparent",
  outline: "border-slate-300 text-slate-700 bg-white",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  violet: "bg-violet-100 text-violet-700 border-violet-200",
  blue: "bg-sky-100 text-sky-700 border-sky-200",
  slate: "bg-slate-200 text-slate-700 border-slate-300",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
