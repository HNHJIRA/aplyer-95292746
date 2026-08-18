import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const inputId = id || rest.name;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          "h-10 w-full rounded-lg border border-border bg-field px-3 text-[15px] text-foreground placeholder:text-dim",
          "focus:border-brand-green/60 focus:outline-none focus:ring-2 focus:ring-brand-green/20",
          error && "border-brand-red/60 focus:border-brand-red focus:ring-brand-red/20",
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="text-[13px] text-brand-red">{error}</span>
      ) : hint ? (
        <span className="text-[13px] text-dim">{hint}</span>
      ) : null}
    </div>
  );
});
