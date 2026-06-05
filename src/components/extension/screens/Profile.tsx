import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { z } from "zod";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";

const schema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
  email: z.string().trim().email("Invalid email").max(255),
  phone: z.string().trim().min(5, "Too short").max(40),
  linkedin: z.string().trim().url("Must be a URL").max(255).or(z.literal("")),
  portfolio: z.string().trim().url("Must be a URL").max(255).or(z.literal("")),
  location: z.string().trim().min(2, "Required").max(120),
});

type FormValues = z.infer<typeof schema>;

export function Profile({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { state, update } = useAplyerStore();
  const [values, setValues] = useState<FormValues>(
    state.profile ?? { firstName: "", lastName: "", email: "", phone: "", linkedin: "", portfolio: "", location: "" },
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }

  async function submit() {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errs: Partial<Record<keyof FormValues, string>> = {};
      for (const i of parsed.error.issues) errs[i.path[0] as keyof FormValues] = i.message;
      setErrors(errs);
      return;
    }
    setSaving(true);
    await update({ profile: parsed.data });
    setSaving(false);
    onNext();
  }

  return (
    <div className="flex h-full flex-col px-6 pt-2">
      <div className="mb-4">
        <h2 className="text-[20px] font-black tracking-tight">Profile Information</h2>
        <p className="text-[12px] text-muted-foreground">Used to autofill applications. Stored locally only.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="popup-scroll -mx-6 flex-1 space-y-3 overflow-y-auto px-6 pb-1">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First Name" name="firstName" value={values.firstName} onChange={(e) => set("firstName", e.target.value)} error={errors.firstName} />
          <Field label="Last Name" name="lastName" value={values.lastName} onChange={(e) => set("lastName", e.target.value)} error={errors.lastName} />
        </div>
        <Field label="Email" name="email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
        <Field label="Phone" name="phone" value={values.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} />
        <Field label="LinkedIn URL" name="linkedin" placeholder="https://linkedin.com/in/…" value={values.linkedin} onChange={(e) => set("linkedin", e.target.value)} error={errors.linkedin} />
        <Field label="Portfolio URL" name="portfolio" placeholder="https://…" value={values.portfolio} onChange={(e) => set("portfolio", e.target.value)} error={errors.portfolio} />
        <Field label="Current Location" name="location" placeholder="City, Country" value={values.location} onChange={(e) => set("location", e.target.value)} error={errors.location} />
      </motion.div>

      <div className="mt-3 flex items-center gap-2 pb-1">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button className="flex-1" onClick={submit} loading={saving}>Continue <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
