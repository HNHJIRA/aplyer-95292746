import { supabase } from "@/integrations/supabase/client";
import { APP_WEB_URL } from "@/lib/extension/runtime";

export const AB_DEMO_QUESTION =
  "In 2–3 sentences, tell me why you're interested in this role and what you'd bring to the team.";

export const AB_DEMO_GENERIC =
  "I am very interested in this role because it aligns with my skills and experience. I am a hard worker, a team player, and passionate about learning. I would bring dedication, strong communication, and a proven track record of delivering results to your team.";

async function callVoiceCardApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");

  const res = await fetch(`${APP_WEB_URL.replace(/\/$/, "")}/api/public/extension/voicecard`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

export function getVoiceCardStateApi() {
  return callVoiceCardApi("state");
}

export function startVoiceCardGenerationApi() {
  return callVoiceCardApi("start");
}

export function retryVoiceCardApi() {
  return callVoiceCardApi("retry");
}

export function setResumeOnlyApi(resumeOnly: boolean) {
  return callVoiceCardApi("set_resume_only", { resumeOnly });
}

export function generateAbDemoApi() {
  return callVoiceCardApi<{ question: string; generic: string; withVoice: string }>("generate_ab_demo");
}

export function completeAbDemoApi() {
  return callVoiceCardApi("complete_ab_demo");
}