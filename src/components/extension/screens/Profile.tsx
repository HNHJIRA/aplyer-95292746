import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { z } from "zod";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import { CountryCitySelect, formatLocation, parseLocation } from "@/components/ui/CountryCitySelect";
import { syncProfileToBackend } from "@/lib/extension/sync";

const schema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
  email: z.string().trim().email("Invalid email").max(255),
  phone: z.string().trim().min(5, "Too short").max(40),
  linkedin: z.string().trim().url("Must be a URL").max(255).or(z.literal("")),
  portfolio: z.string().trim().url("Must be a URL").max(255).or(z.literal("")),
  location: z.string().trim().min(2, "Pick country").max(160),
});

type FormValues = z.infer<typeof schema>;

export function Profile({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { state, update } = useAplyerStore();
  const initial: FormValues = state.profile ?? {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    linkedin: "",
    portfolio: "",
    location: "",
  };
  const [values, setValues] = useState<FormValues>(initial);
  const [loc, setLoc] = useState(parseLocation(initial.location));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }

  async function submit() {
    const merged = { ...values, location: formatLocation(loc.country, loc.city) };
    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      const errs: Partial<Record<keyof FormValues, string>> = {};
      for (const i of parsed.error.issues) errs[i.path[0] as keyof FormValues] = i.message;
      setErrors(errs);
      return;
    }
    setSaving(true);
    await update({ profile: parsed.data });
    try { await syncProfileToBackend(parsed.data); } catch (e) { console.warn("[aplyer] profile sync", e); }
    setSaving(false);
    onNext();
  }

  return (
    <div className="flex h-full flex-col px-5 pt-2">
      <div className="mb-2">
        <h2 className="text-[18px] font-black tracking-tight">Profile Information</h2>
        <p className="text-[11px] text-muted-foreground">Used to autofill applications.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex-1 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="First Name" name="firstName" value={values.firstName} onChange={(e) => set("firstName", e.target.value)} error={errors.firstName} />
          <Field label="Last Name" name="lastName" value={values.lastName} onChange={(e) => set("lastName", e.target.value)} error={errors.lastName} />
        </div>
        <Field label="Email" name="email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
        <Field label="Phone" name="phone" value={values.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} />
        <CountryCitySelect compact country={loc.country} city={loc.city} onChange={setLoc} />
        {errors.location && <p className="text-[10px] text-brand-red">{errors.location}</p>}
        <Field label="LinkedIn URL" name="linkedin" placeholder="https://linkedin.com/in/…" value={values.linkedin} onChange={(e) => set("linkedin", e.target.value)} error={errors.linkedin} />
        <Field label="Portfolio URL" name="portfolio" placeholder="https://…" value={values.portfolio} onChange={(e) => set("portfolio", e.target.value)} error={errors.portfolio} />
      </motion.div>

      <div className="mt-2 flex items-center gap-2 pb-1">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button className="flex-1" onClick={submit} loading={saving}>Continue <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
