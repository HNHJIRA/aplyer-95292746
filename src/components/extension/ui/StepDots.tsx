import { cn } from "@/lib/utils";

export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1 rounded-full transition-all duration-300",
            i === current ? "w-6 bg-brand-green" : i < current ? "w-3 bg-brand-green/50" : "w-3 bg-white/10",
          )}
        />
      ))}
    </div>
  );
}
