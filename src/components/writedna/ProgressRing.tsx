import { motion } from "framer-motion";

interface Props {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
}

export function ProgressRing({
  value,
  size = 140,
  stroke = 10,
  color = "#4ade80",
  trackColor = "hsl(var(--border))",
  label,
  sublabel,
}: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke={trackColor} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={color}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <motion.div
          key={clamped}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-black tracking-tight"
          style={{ fontSize: size * 0.24, lineHeight: 1, color }}
        >
          {clamped}%
        </motion.div>
        {label && (
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
        )}
        {sublabel && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">{sublabel}</div>
        )}
      </div>
    </div>
  );
}
