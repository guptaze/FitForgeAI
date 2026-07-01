const RAW = process.env.EXPO_PUBLIC_BACKEND_URL || "";
export const BACKEND_URL = RAW.replace(/\/$/, "");
export const API = `${BACKEND_URL}/api`;

export type PlanInput = {
  body: { current_weight_kg: number; target_weight_kg: number; height_cm: number; age: number; sex: string };
  duration_months: number;
  training: { days_per_week: number; minutes_per_session: number; preferred_window: string };
  diet: { diet_type: string; meal_pattern: string; cheat_day_policy: string };
  injuries: string;
  goals: { aesthetic_goal: string; focus_muscles: string[]; pace: string };
  daily_schedule: string;
};

async function json<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export const generatePlan = (input: PlanInput) =>
  json(`${API}/plan/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });

export const getLatestPlan = () => json(`${API}/plan/latest`).catch(() => null);
export const getLogsToday = () => json(`${API}/logs/today`);
export const getOverview = () => json(`${API}/overview`);

async function uploadAudio(endpoint: string, uri: string): Promise<any> {
  const form = new FormData();
  const name = uri.split("/").pop() || "audio.m4a";
  // @ts-ignore RN FormData file
  form.append("file", { uri, name, type: "audio/m4a" });
  const res = await fetch(`${API}${endpoint}`, { method: "POST", body: form as any });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export const uploadMorningCheckin = (uri: string) => uploadAudio("/checkin/morning", uri);
export const uploadFoodVoice = (uri: string) => uploadAudio("/food/log-voice", uri);

export const uploadFoodImage = (base64: string, mime = "image/jpeg") =>
  json(`${API}/food/log-image`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: base64, mime_type: mime }),
  });

export const deleteFood = (id: string) =>
  fetch(`${API}/food/${id}`, { method: "DELETE" });

export const syncHealth = (sample: any) =>
  json(`${API}/health/sync`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sample),
  });

export const logWorkout = (payload: {
  day_label?: string; exercise_name: string; sets_done: number; reps: string; weight_kg?: number; notes?: string;
}) =>
  json(`${API}/workouts/log`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });

export const getWorkoutsToday = () => json(`${API}/workouts/today`);
export const deleteWorkout = (id: string) => fetch(`${API}/workouts/${id}`, { method: "DELETE" });

export const uploadBloodworkImage = (base64: string, mime = "image/jpeg") =>
  json(`${API}/bloodwork/upload-image`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: base64, mime_type: mime }),
  });

export async function uploadBloodworkPdf(uri: string): Promise<any> {
  const form = new FormData();
  const name = uri.split("/").pop() || "report.pdf";
  // @ts-ignore
  form.append("file", { uri, name, type: "application/pdf" });
  const res = await fetch(`${API}/bloodwork/upload-pdf`, { method: "POST", body: form as any });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export const getLatestBloodwork = () => json(`${API}/bloodwork/latest`).catch(() => ({}));
