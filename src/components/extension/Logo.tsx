interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  tagline?: boolean;
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Aplyer">
      <defs>
        <linearGradient id="aplyer-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E5373A" />
          <stop offset="50%" stopColor="#E5373A" />
          <stop offset="50.01%" stopColor="#1DB954" />
          <stop offset="100%" stopColor="#1DB954" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="#0D1829" stroke="url(#aplyer-ring)" strokeWidth="3.5" />
      {/* X (red) */}
      <path d="M32 32 L58 64" stroke="#E5373A" strokeWidth="7" strokeLinecap="round" />
      <path d="M44 38 L36 48" stroke="#E5373A" strokeWidth="7" strokeLinecap="round" />
      {/* Check (green) */}
      <path d="M50 58 L60 70 L78 40" stroke="#1DB954" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Logo({ size = 36, showWordmark = true, tagline = false }: LogoProps) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="text-[20px] font-bold tracking-tight text-brand-green">Aplyer.ai</span>
          {tagline && (
            <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-red">
              Stop Skipping Jobs
            </span>
          )}
        </div>
      )}
    </div>
  );
}
