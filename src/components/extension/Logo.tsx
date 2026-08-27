interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  tagline?: boolean;
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Aplyer">
      <defs>
        <linearGradient id="aplyer-ring" x1="0" y1="44" x2="88" y2="44">
          <stop offset="0%" stopColor="#E5373A" />
          <stop offset="50%" stopColor="#E5373A" />
          <stop offset="50%" stopColor="#1DB954" />
          <stop offset="100%" stopColor="#1DB954" />
        </linearGradient>
      </defs>
      <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#aplyer-ring)" strokeWidth="2" />
      <line x1="22" y1="28" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
      <line x1="22" y1="60" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
      <line x1="44" y1="44" x2="56" y2="56" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
      <line x1="56" y1="56" x2="72" y2="28" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
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
            <span className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-red">
              Stop Skipping Jobs
            </span>
          )}
        </div>
      )}
    </div>
  );
}
