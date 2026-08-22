import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "secondary" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-green text-white hover:bg-brand-green-2 active:scale-[0.98] shadow-[0_8px_24px_-12px_rgba(29,185,84,0.6)]",
  secondary:
    "bg-field text-foreground hover:bg-field-2 border border-border",
  outline:
    "bg-transparent text-foreground border border-border hover:bg-field",
  ghost: "bg-transparent text-sub hover:text-foreground hover:bg-field",
  danger: "bg-brand-red text-white hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[14px]",
  md: "h-10 px-4 text-[15px]",
  lg: "h-12 px-5 text-[16px]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
});
