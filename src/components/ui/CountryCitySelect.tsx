import { useMemo } from "react";
import { Country, City } from "country-state-city";

interface Props {
  country: string; // ISO2
  city: string;
  onChange: (next: { country: string; city: string }) => void;
  compact?: boolean;
  className?: string;
}

export function CountryCitySelect({ country, city, onChange, compact, className }: Props) {
  const countries = useMemo(() => Country.getAllCountries(), []);
  const cities = useMemo(() => (country ? City.getCitiesOfCountry(country) ?? [] : []), [country]);

  const h = compact ? "h-9" : "h-11";
  const text = compact ? "text-[12px]" : "text-[13px]";

  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ""}`}>
      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Country
        </label>
        <select
          value={country}
          onChange={(e) => onChange({ country: e.target.value, city: "" })}
          className={`${h} ${text} w-full rounded-lg border border-border bg-paper px-2 text-foreground focus:border-brand-green/60 focus:outline-none`}
        >
          <option value="">Select country</option>
          {countries.map((c) => (
            <option key={c.isoCode} value={c.isoCode}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          City
        </label>
        <select
          value={city}
          onChange={(e) => onChange({ country, city: e.target.value })}
          disabled={!country || cities.length === 0}
          className={`${h} ${text} w-full rounded-lg border border-border bg-paper px-2 text-foreground disabled:opacity-50 focus:border-brand-green/60 focus:outline-none`}
        >
          <option value="">{country ? (cities.length ? "Select city" : "No cities") : "Select country first"}</option>
          {cities.map((c) => (
            <option key={`${c.name}-${c.stateCode}`} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function formatLocation(countryCode: string, city: string): string {
  if (!countryCode && !city) return "";
  const c = Country.getCountryByCode(countryCode);
  const name = c?.name ?? countryCode;
  return city ? `${city}, ${name}` : name;
}

export function parseLocation(location: string): { country: string; city: string } {
  if (!location) return { country: "", city: "" };
  const parts = location.split(",").map((s) => s.trim());
  const all = Country.getAllCountries();
  if (parts.length >= 2) {
    const countryName = parts[parts.length - 1];
    const found = all.find((c) => c.name.toLowerCase() === countryName.toLowerCase());
    if (found) return { country: found.isoCode, city: parts.slice(0, -1).join(", ") };
  }
  const oneMatch = all.find((c) => c.name.toLowerCase() === location.toLowerCase());
  if (oneMatch) return { country: oneMatch.isoCode, city: "" };
  return { country: "", city: location };
}
