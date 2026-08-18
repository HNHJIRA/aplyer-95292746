import { motion } from "framer-motion";

interface Props {
  value: number; // 0 - 100
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
}

export function ProgressRing({ value, size = 120, stroke = 10, label, sublabel }: Props) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (v / 100) * c;
  const color = v >= 75 ? "#1DB954" : v >= 50 ? "#E5B73A" : "#E5373A";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 8px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-[32px] font-black leading-none tracking-tight text-foreground"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {Math.round(v)}
        </motion.span>
        {label && <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>}
        {sublabel && <span className="text-[12px] text-dim">{sublabel}</span>}
      </div>
    </div>
  );
}
