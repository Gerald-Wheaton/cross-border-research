import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-2xl border bg-white/80 px-4 py-2 text-sm outline-none transition placeholder:text-stone-400 focus-visible:ring-4 focus-visible:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
