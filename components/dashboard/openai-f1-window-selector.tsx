"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  OPENAI_F1_WINDOW_OPTIONS,
  parseOpenAiF1Window,
  type OpenAiF1Window,
} from "@/lib/f1-openai-window";
import { cn } from "@/lib/utils";

export function OpenAiF1WindowSelector({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = parseOpenAiF1Window(searchParams.get("openaiWindow") ?? undefined);

  return (
    <label className={cn("flex flex-col gap-1 text-sm text-slate-700", className)}>
      <span className="font-medium text-slate-600">ChatGPT & Codex window</span>
      <select
        className={cn(
          "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 min-w-[12rem]",
          "shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1",
        )}
        value={value}
        onChange={(e) => {
          const next = e.target.value as OpenAiF1Window;
          const params = new URLSearchParams(searchParams.toString());
          if (next === "follow") {
            params.delete("openaiWindow");
          } else {
            params.set("openaiWindow", next);
          }
          const q = params.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        {OPENAI_F1_WINDOW_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
