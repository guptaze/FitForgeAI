import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal, LayoutAnimation, UIManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ImageBackground } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { generatePlan, getLatestPlan, getLatestBloodwork, logWorkout, getWorkoutsToday, type PlanInput } from "@/src/api";
import { storage } from "@/src/utils/storage";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FormState = {
  currentWeight: string; targetWeight: string; height: string; age: string;
  sex: "male" | "female" | "other";
  durationMonths: string; daysPerWeek: string; minutesPerSession: string; trainingWindow: string;
  dietType: "veg" | "eggetarian" | "vegan"; mealPattern: string; cheatDayPolicy: string;
  injuries: string; aestheticGoal: string; focusMuscles: string;
  pace: "slow" | "moderate" | "aggressive"; dailySchedule: string;
};

const initial: FormState = {
  currentWeight: "", targetWeight: "", height: "", age: "", sex: "male",
  durationMonths: "3", daysPerWeek: "4", minutesPerSession: "60", trainingWindow: "",
  dietType: "eggetarian", mealPattern: "", cheatDayPolicy: "",
  injuries: "", aestheticGoal: "", focusMuscles: "", pace: "moderate", dailySchedule: "",
};

const PLAN_CACHE_KEY = "fitforge_latest_plan";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function PlanTab() {
  const [form, setForm] = useState<FormState>(initial);
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("Forging plan… (~30-60s)");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [planCreatedAt, setPlanCreatedAt] = useState<string | null>(null);
  const [bloodwork, setBloodwork] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [workoutLogs, setWorkoutLogs] = useState<any[]>([]);

  const loadPlan = useCallback(async () => {
    const cached = await storage.getItem<string>(PLAN_CACHE_KEY, "");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setPlan(parsed.plan); setPlanCreatedAt(parsed.created_at); return;
      } catch {}
    }
    try {
      const latest = await getLatestPlan();
      if (latest && latest.plan) { setPlan(latest.plan); setPlanCreatedAt(latest.created_at); }
    } catch {}
  }, []);

  const loadWorkouts = useCallback(async () => {
    try { const w = await getWorkoutsToday(); setWorkoutLogs(w.logs || []); } catch {}
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  useFocusEffect(useCallback(() => {
    loadWorkouts();
    getLatestBloodwork().then((b: any) => setBloodwork(b && b.markers ? b : null)).catch(() => {});
  }, [loadWorkouts]));

  const update = (k: keyof FormState) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  const canSubmit = useMemo(() =>
    form.currentWeight && form.targetWeight && form.height && form.age &&
    form.durationMonths && form.daysPerWeek && form.minutesPerSession,
    [form]);

  const onGenerate = useCallback(async () => {
    if (!canSubmit) { setError("Please fill body, timeline, and training fields."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true); setLoadingHint("Forging plan… (~30-60s)"); setError(null);
    try {
      const input: PlanInput = {
        body: { current_weight_kg: parseFloat(form.currentWeight), target_weight_kg: parseFloat(form.targetWeight), height_cm: parseFloat(form.height), age: parseInt(form.age, 10), sex: form.sex },
        duration_months: parseInt(form.durationMonths, 10),
        training: { days_per_week: parseInt(form.daysPerWeek, 10), minutes_per_session: parseInt(form.minutesPerSession, 10), preferred_window: form.trainingWindow || "flexible" },
        diet: { diet_type: form.dietType, meal_pattern: form.mealPattern || "3 meals + 1 snack", cheat_day_policy: form.cheatDayPolicy || "1 flexible meal weekly" },
        injuries: form.injuries || "None reported",
        goals: { aesthetic_goal: form.aestheticGoal || "lean and athletic", focus_muscles: form.focusMuscles.split(",").map(s => s.trim()).filter(Boolean), pace: form.pace },
        daily_schedule: form.dailySchedule || "Standard 9-6 desk schedule",
      };
      const startedAt = Date.now();
      let result: any;
      try {
        result = await generatePlan(input);
      } catch (err: any) {
        setLoadingHint("Almost there… syncing your plan");
        const deadline = Date.now() + 90000;
        let polled: any = null;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 4000));
          try {
            const latest = await getLatestPlan();
            if (latest && latest.created_at && new Date(latest.created_at).getTime() >= startedAt - 2000) { polled = latest; break; }
          } catch {}
        }
        if (!polled) throw err;
        result = polled;
      }
      await storage.setItem(PLAN_CACHE_KEY, JSON.stringify(result));
      setPlan(result.plan); setPlanCreatedAt(result.created_at); setShowForm(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Failed to generate plan.");
    } finally {
      setLoading(false);
    }
  }, [canSubmit, form]);

  // If no plan and not in form -> show form. If plan -> show plan.
  if (!plan || showForm) {
    return (
      <PlanForm
        form={form} setForm={setForm} update={update}
        loading={loading} loadingHint={loadingHint}
        error={error} canSubmit={!!canSubmit}
        onGenerate={onGenerate}
        onCancel={plan ? () => setShowForm(false) : undefined}
      />
    );
  }

  return (
    <PlanDisplay
      plan={plan}
      createdAt={planCreatedAt}
      bloodwork={bloodwork}
      workoutLogs={workoutLogs}
      onRefreshLogs={loadWorkouts}
      onEdit={() => setShowForm(true)}
    />
  );
}

// =============== FORM ===============

function PlanForm({
  form, setForm, update, loading, loadingHint, error, canSubmit, onGenerate, onCancel,
}: any) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.hero}>
            <ImageBackground source={{ uri: "https://images.pexels.com/photos/6800730/pexels-photo-6800730.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={["transparent", "rgba(18,18,18,0.7)", theme.color.surface]} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.heroContent}>
              <Text style={styles.heroKicker}>FITFORGE AI</Text>
              <Text style={styles.heroTitle}>FORGE YOUR PLAN</Text>
              <Text style={styles.heroSub}>Personalised strength + fat-loss plan by Claude.</Text>
            </View>
            {onCancel ? (
              <Pressable onPress={onCancel} style={styles.closeBtn} testID="form-close">
                <Ionicons name="close" size={20} color={theme.color.onSurface} />
              </Pressable>
            ) : null}
          </View>

          <SectionCard title="BODY">
            <Row><NumField label="Current weight (kg)" value={form.currentWeight} onChange={update("currentWeight")} testID="input-current-weight" />
              <NumField label="Target weight (kg)" value={form.targetWeight} onChange={update("targetWeight")} testID="input-target-weight" /></Row>
            <Row><NumField label="Height (cm)" value={form.height} onChange={update("height")} testID="input-height" />
              <NumField label="Age" value={form.age} onChange={update("age")} testID="input-age" /></Row>
            <FieldLabel>Sex</FieldLabel>
            <Segment value={form.sex} options={[{label:"Male",value:"male"},{label:"Female",value:"female"},{label:"Other",value:"other"}]}
              onChange={(v) => setForm((s: any) => ({ ...s, sex: v }))} testID="segment-sex" />
          </SectionCard>

          <SectionCard title="TIMELINE">
            <NumField label="Duration (months)" value={form.durationMonths} onChange={update("durationMonths")} testID="input-duration" />
          </SectionCard>

          <SectionCard title="TRAINING">
            <Row><NumField label="Days / week" value={form.daysPerWeek} onChange={update("daysPerWeek")} testID="input-days-week" />
              <NumField label="Minutes / session" value={form.minutesPerSession} onChange={update("minutesPerSession")} testID="input-minutes-session" /></Row>
            <TextField label="Preferred training window" placeholder="e.g. 6-8am" value={form.trainingWindow} onChange={update("trainingWindow")} testID="input-training-window" />
          </SectionCard>

          <SectionCard title="DIET">
            <FieldLabel>Diet type</FieldLabel>
            <Segment value={form.dietType} options={[{label:"Veg",value:"veg"},{label:"Eggetarian",value:"eggetarian"},{label:"Vegan",value:"vegan"}]}
              onChange={(v) => setForm((s: any) => ({ ...s, dietType: v }))} testID="segment-diet" />
            <TextField label="Meal pattern" placeholder="e.g. 3 meals + 1 snack" value={form.mealPattern} onChange={update("mealPattern")} testID="input-meal-pattern" />
            <TextField label="Cheat day policy" value={form.cheatDayPolicy} onChange={update("cheatDayPolicy")} placeholder="e.g. 1 flexible meal weekly" testID="input-cheat-day" />
          </SectionCard>

          <SectionCard title="INJURIES">
            <TextField label="Location, age, status, avoid" value={form.injuries} onChange={update("injuries")} multiline testID="input-injuries" placeholder="e.g. R shoulder impingement, mild, avoid OHP" />
          </SectionCard>

          <SectionCard title="GOALS">
            <TextField label="Aesthetic goal" value={form.aestheticGoal} onChange={update("aestheticGoal")} testID="input-aesthetic-goal" placeholder="lean, muscular, visible abs" />
            <TextField label="Focus muscles (comma separated)" value={form.focusMuscles} onChange={update("focusMuscles")} testID="input-focus-muscles" placeholder="chest, back, glutes" />
            <FieldLabel>Pace</FieldLabel>
            <Segment value={form.pace} options={[{label:"Slow",value:"slow"},{label:"Moderate",value:"moderate"},{label:"Aggressive",value:"aggressive"}]}
              onChange={(v) => setForm((s: any) => ({ ...s, pace: v }))} testID="segment-pace" />
          </SectionCard>

          <SectionCard title="DAILY SCHEDULE">
            <TextField label="Short description of your day" value={form.dailySchedule} onChange={update("dailySchedule")} multiline testID="input-daily-schedule" placeholder="e.g. Wake 6am, desk job 9-6, gym 7pm" />
          </SectionCard>

          {error ? <Text style={styles.errorInline} testID="form-error">{error}</Text> : null}
          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.ctaWrap}>
          <Pressable style={[styles.cta, (!canSubmit || loading) && styles.ctaDisabled]} disabled={loading || !canSubmit} onPress={onGenerate} testID="generate-plan-button">
            {loading ? <ActivityIndicator color={theme.color.onBrand} /> :
              <><Ionicons name="flash" size={18} color={theme.color.onBrand} /><Text style={styles.ctaText}>GENERATE PLAN</Text></>}
          </Pressable>
          {loading ? <Text style={styles.ctaHint}>{loadingHint}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// =============== PLAN DISPLAY ===============

function PlanDisplay({ plan, createdAt, bloodwork, workoutLogs, onRefreshLogs, onEdit }: any) {
  const targets = plan.targets;
  const trainingDays: any[] = plan.training_split?.table || [];
  const todayIndex = new Date().getDay(); // 0=Sun
  const todayName = DAYS[(todayIndex + 6) % 7]; // Mon=0
  const todayDay = trainingDays.find((d) => (d.day || "").toLowerCase().startsWith(todayName.toLowerCase()));

  const [selectedDay, setSelectedDay] = useState<any>(todayDay || null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggle = (k: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedSection((s) => (s === k ? null : k));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>

        {/* Target header */}
        <View style={styles.targetHead} testID="target-header">
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>YOUR TARGET</Text>
            {targets ? (
              <>
                <View style={styles.targetRow}>
                  <View style={styles.targetCol}>
                    <Text style={styles.targetVal}>{targets.start_weight_kg}<Text style={styles.unitSm}>kg</Text></Text>
                    <Text style={styles.targetLabel}>START</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={theme.color.brand} />
                  <View style={styles.targetCol}>
                    <Text style={[styles.targetVal, { color: theme.color.brand }]}>{targets.target_weight_kg}<Text style={styles.unitSm}>kg</Text></Text>
                    <Text style={styles.targetLabel}>GOAL</Text>
                  </View>
                  <View style={styles.targetCol}>
                    <Text style={styles.targetVal}>{targets.duration_months}<Text style={styles.unitSm}>mo</Text></Text>
                    <Text style={styles.targetLabel}>DURATION</Text>
                  </View>
                  <View style={styles.targetCol}>
                    <Text style={styles.targetVal}>{targets.weekly_rate_kg}<Text style={styles.unitSm}>kg/wk</Text></Text>
                    <Text style={styles.targetLabel}>RATE</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.hint}>Regenerate the plan to see targets.</Text>
            )}
          </View>
          <Pressable style={styles.editBtn} onPress={onEdit} testID="edit-plan-button">
            <Ionicons name="create-outline" size={14} color={theme.color.brand} />
            <Text style={styles.editBtnText}>EDIT</Text>
          </Pressable>
        </View>

        {/* Today's Workout */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="barbell" size={18} color={theme.color.brand} />
            <Text style={styles.sectionTitle}>TODAY&apos;S WORKOUT</Text>
          </View>
          {!selectedDay ? (
            <View style={styles.restBlock}>
              <Ionicons name="bed-outline" size={24} color={theme.color.muted} />
              <Text style={styles.restText}>REST DAY</Text>
              <Text style={styles.hint}>Recovery, mobility, and hydration. Pick a day below to preview a workout.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.subheader}>{selectedDay?.day} · {selectedDay?.focus}</Text>
              {(selectedDay?.exercises || []).map((ex: any, i: number) => (
                <ExerciseRow
                  key={i}
                  ex={ex}
                  dayLabel={selectedDay?.day}
                  isLogged={workoutLogs.some(l => l.exercise_name === ex.name && l.day_label === selectedDay?.day)}
                  onLogged={onRefreshLogs}
                />
              ))}
            </>
          )}
          {/* Day switcher */}
          <View style={styles.daySwitcher}>
            <Text style={styles.smallLabel}>Switch day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
              {trainingDays.map((d: any, i: number) => {
                const active = d.day === selectedDay?.day;
                return (
                  <Pressable key={i} onPress={() => setSelectedDay(d)} style={[styles.dayChip, active && styles.dayChipActive]} testID={`day-chip-${i}`}>
                    <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{d.day?.slice(0, 3).toUpperCase()}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Meal Plan */}
        <CollapsibleCard title="MEAL PLAN" icon="restaurant-outline" isOpen={expandedSection === "meal"} onToggle={() => toggle("meal")}>
          <NutritionTiles data={plan.nutrition_framework} />
          {(plan.meal_plan || []).map((m: any, i: number) => <MealBlock key={i} meal={m} />)}
        </CollapsibleCard>

        {/* Supplements */}
        <CollapsibleCard title="SUPPLEMENTS" icon="flask-outline" isOpen={expandedSection === "supp"} onToggle={() => toggle("supp")}
          badge={bloodwork ? "TAILORED" : "GENERIC"}>
          <SupplementsSection stack={plan.supplement_stack || []} bloodwork={bloodwork} />
        </CollapsibleCard>

        {/* Blood Panel */}
        <CollapsibleCard title="BLOOD PANEL" icon="water-outline" isOpen={expandedSection === "blood"} onToggle={() => toggle("blood")}>
          <BloodPanelSection panel={plan.blood_panel} hasBloodwork={!!bloodwork} />
        </CollapsibleCard>

        {/* Monthly Progression */}
        <CollapsibleCard title="MONTHLY PROGRESSION" icon="trending-up-outline" isOpen={expandedSection === "mp"} onToggle={() => toggle("mp")}>
          <MonthlyProgression data={plan.monthly_progression} />
        </CollapsibleCard>

        {/* Weekly rate + Injury */}
        <CollapsibleCard title="RATE VALIDATION" icon="speedometer-outline" isOpen={expandedSection === "rate"} onToggle={() => toggle("rate")}>
          <RateValidation data={plan.weekly_rate_validation} />
        </CollapsibleCard>

        <CollapsibleCard title="INJURY RISK" icon="warning-outline" isOpen={expandedSection === "inj"} onToggle={() => toggle("inj")}>
          <InjuryFlag data={plan.injury_risk_flag} />
        </CollapsibleCard>

        <CollapsibleCard title="RECOVERY & SLEEP" icon="moon-outline" isOpen={expandedSection === "rec"} onToggle={() => toggle("rec")}>
          <Recovery data={plan.recovery_and_sleep} />
        </CollapsibleCard>

        <CollapsibleCard title="SUMMARY" icon="document-text-outline" isOpen={expandedSection === "sum"} onToggle={() => toggle("sum")}>
          <Text style={styles.body}>{typeof plan.summary === "string" ? plan.summary : JSON.stringify(plan.summary)}</Text>
        </CollapsibleCard>

        {createdAt ? <Text style={styles.footnote}>Generated {new Date(createdAt).toLocaleString()}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// =============== EXERCISE ROW ===============

function ExerciseRow({ ex, dayLabel, isLogged, onLogged }: any) {
  const [showLog, setShowLog] = useState(false);
  const [sets, setSets] = useState<string>(String(parseInt(ex.sets, 10) || 3));
  const [reps, setReps] = useState<string>(String(ex.reps || ""));
  const [weight, setWeight] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const query = encodeURIComponent(ex.demo_query || `${ex.name} proper form`);
  const gradient = pickGradient(ex.muscle_group);
  const iconName = pickIcon(ex.muscle_group);

  const submit = async () => {
    setBusy(true);
    try {
      await logWorkout({
        day_label: dayLabel,
        exercise_name: ex.name,
        sets_done: parseInt(sets, 10) || 0,
        reps: reps,
        weight_kg: weight ? parseFloat(weight) : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowLog(false);
      onLogged?.();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.exRow} testID={`exercise-row-${ex.name}`}>
      <View style={styles.exThumbWrap}>
        <LinearGradient colors={gradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name={iconName as any} size={38} color="rgba(255,255,255,0.9)" />
        {isLogged ? (
          <View style={styles.doneOverlay}>
            <Ionicons name="checkmark-circle" size={26} color={theme.color.success} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.exName}>{ex.name}</Text>
        <View style={styles.exMeta}>
          <MetaChip>{ex.sets} × {ex.reps}</MetaChip>
          <MetaChip>{ex.rest} rest</MetaChip>
          {ex.muscle_group ? <MetaChip>{ex.muscle_group}</MetaChip> : null}
        </View>
        {ex.notes ? <Text style={styles.exNotes} numberOfLines={2}>{ex.notes}</Text> : null}
        <View style={styles.exActions}>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(`https://www.youtube.com/results?search_query=${query}`)}
            style={styles.exBtnGhost}
            testID={`ex-demo-${ex.name}`}
          >
            <Ionicons name="play-circle-outline" size={14} color={theme.color.brand} />
            <Text style={styles.exBtnGhostText}>DEMO</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowLog(true)}
            style={[styles.exBtn, isLogged && { backgroundColor: theme.color.success }]}
            testID={`ex-log-${ex.name}`}
          >
            <Ionicons name={isLogged ? "checkmark" : "add"} size={14} color={theme.color.onBrand} />
            <Text style={styles.exBtnText}>{isLogged ? "LOGGED" : "LOG"}</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={showLog} transparent animationType="fade" onRequestClose={() => setShowLog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.modalTitle}>{ex.name}</Text>
              <Pressable onPress={() => setShowLog(false)}><Ionicons name="close" size={22} color={theme.color.muted} /></Pressable>
            </View>
            <Text style={styles.modalSubtitle}>Log completed set</Text>
            <Row><NumField label="Sets" value={sets} onChange={setSets} testID="log-sets" /><TextField label="Reps" value={reps} onChange={setReps} testID="log-reps" /></Row>
            <NumField label="Weight (kg)" value={weight} onChange={setWeight} testID="log-weight" />
            <Pressable style={styles.modalCta} onPress={submit} disabled={busy} testID="log-submit">
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> : <><Ionicons name="checkmark" size={16} color={theme.color.onBrand} /><Text style={styles.ctaText}>SAVE</Text></>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return <View style={styles.metaChip}><Text style={styles.metaChipText}>{children}</Text></View>;
}

function pickIcon(mg?: string): string {
  const m = (mg || "").toLowerCase();
  if (m.includes("chest")) return "body-outline";
  if (m.includes("back")) return "shield-outline";
  if (m.includes("leg")) return "walk-outline";
  if (m.includes("shoulder")) return "triangle-outline";
  if (m.includes("arm")) return "barbell-outline";
  if (m.includes("core")) return "square-outline";
  if (m.includes("cardio")) return "heart-outline";
  return "barbell-outline";
}
function pickGradient(mg?: string): string[] {
  const m = (mg || "").toLowerCase();
  if (m.includes("chest")) return ["#D84315", "#F35900"];
  if (m.includes("back")) return ["#0D47A1", "#1976D2"];
  if (m.includes("leg")) return ["#33691E", "#689F38"];
  if (m.includes("shoulder")) return ["#4A148C", "#7B1FA2"];
  if (m.includes("arm")) return ["#B71C1C", "#E53935"];
  if (m.includes("core")) return ["#004D40", "#00897B"];
  if (m.includes("cardio")) return ["#880E4F", "#E91E63"];
  return ["#2C2C2E", "#555555"];
}

// =============== MEAL / SUPP / BLOOD SECTIONS ===============

function NutritionTiles({ data }: { data: any }) {
  if (!data) return null;
  return (
    <View style={styles.macroRow}>
      <MacroCell label="CAL" value={`${data.daily_calories ?? "-"}`} />
      <MacroCell label="P" value={`${data.protein_g ?? "-"}g`} />
      <MacroCell label="C" value={`${data.carbs_g ?? "-"}g`} />
      <MacroCell label="F" value={`${data.fat_g ?? "-"}g`} />
    </View>
  );
}

function MacroCell({ label, value }: { label: string; value: string }) {
  return <View style={styles.macroCell}><Text style={styles.macroLabel}>{label}</Text><Text style={styles.macroValue}>{value}</Text></View>;
}

function MealBlock({ meal }: { meal: any }) {
  const [selected, setSelected] = useState(0);
  const options = meal.options || [];
  const opt = options[selected];
  return (
    <View style={styles.mealBlock}>
      <View style={styles.mealHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mealName}>{meal.meal}</Text>
          <Text style={styles.mealMeta}>{meal.time_window || ""} · target {meal.target_calories ?? "-"} kcal / {meal.target_protein_g ?? "-"}g P</Text>
        </View>
      </View>
      <View style={styles.mealChips}>
        {options.map((o: any, i: number) => (
          <Pressable key={i} onPress={() => setSelected(i)} style={[styles.mealChip, i === selected && styles.mealChipActive]} testID={`meal-opt-${meal.meal}-${i}`}>
            <Text style={[styles.mealChipText, i === selected && styles.mealChipTextActive]}>{o.name}</Text>
          </Pressable>
        ))}
      </View>
      {opt ? (
        <View style={styles.mealDetail}>
          {opt.description ? <Text style={styles.mealDesc}>{opt.description}</Text> : null}
          <View style={styles.macroRowSmall}>
            <MetaChip>{opt.calories} kcal</MetaChip>
            <MetaChip>P {opt.protein_g}g</MetaChip>
            <MetaChip>C {opt.carbs_g}g</MetaChip>
            <MetaChip>F {opt.fat_g}g</MetaChip>
            {opt.prep_time_min ? <MetaChip>{opt.prep_time_min} min</MetaChip> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SupplementsSection({ stack, bloodwork }: any) {
  const suggestions = bloodwork?.suggestions?.supplement_recommendations;
  if (suggestions && suggestions.length) {
    return (
      <View>
        <View style={styles.tailoredBanner}>
          <Ionicons name="checkmark-circle" size={14} color={theme.color.success} />
          <Text style={styles.tailoredText}>TAILORED FROM YOUR BLOODWORK</Text>
        </View>
        {suggestions.map((s: any, i: number) => (
          <View key={i} style={styles.suppRow}>
            <View style={styles.rowBetween}>
              <Text style={styles.suppName}>{s.name}</Text>
              <View style={[styles.priorityBadge, s.priority === "high" ? styles.priHigh : s.priority === "medium" ? styles.priMed : styles.priLow]}>
                <Text style={styles.priorityText}>{(s.priority || "").toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.suppDose}>{s.dose} · {s.timing}</Text>
            <Text style={styles.exNotes}>{s.rationale}</Text>
            {s.based_on_marker ? <Text style={styles.suppMarker}>marker: {s.based_on_marker}</Text> : null}
          </View>
        ))}
      </View>
    );
  }
  // Generic + gated
  const core = stack.filter((s: any) => !s.requires_bloodwork);
  const gated = stack.filter((s: any) => s.requires_bloodwork);
  return (
    <View>
      {core.length ? <Text style={styles.subheader}>CORE</Text> : null}
      {core.map((s: any, i: number) => (
        <View key={i} style={styles.suppRow}>
          <View style={styles.rowBetween}>
            <Text style={styles.suppName}>{s.name}</Text>
            <Text style={styles.suppDose}>{s.dose}</Text>
          </View>
          {s.timing ? <Text style={styles.exNotes}>Timing: {s.timing}</Text> : null}
          {s.purpose ? <Text style={styles.exNotes}>{s.purpose}</Text> : null}
        </View>
      ))}
      {gated.length ? (
        <>
          <Text style={[styles.subheader, { marginTop: 12 }]}>PENDING BLOODWORK</Text>
          <View style={styles.pendingBanner}>
            <Ionicons name="information-circle-outline" size={14} color={theme.color.warning} />
            <Text style={styles.pendingText}>Upload your blood test report on the Blood tab to unlock tailored recommendations.</Text>
          </View>
          {gated.map((s: any, i: number) => (
            <View key={i} style={[styles.suppRow, { opacity: 0.55 }]}>
              <View style={styles.rowBetween}>
                <Text style={styles.suppName}>{s.name}</Text>
                <Text style={styles.suppDose}>{s.dose}</Text>
              </View>
              {s.purpose ? <Text style={styles.exNotes}>{s.purpose}</Text> : null}
              {s.target_marker ? <Text style={styles.suppMarker}>gated on: {s.target_marker}</Text> : null}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function BloodPanelSection({ panel, hasBloodwork }: any) {
  if (hasBloodwork) {
    return (
      <View>
        <View style={styles.tailoredBanner}>
          <Ionicons name="checkmark-circle" size={14} color={theme.color.success} />
          <Text style={styles.tailoredText}>REPORT ANALYZED — SEE BLOOD TAB</Text>
        </View>
      </View>
    );
  }
  return (
    <View>
      {panel?.why_it_matters ? <Text style={styles.body}>{panel.why_it_matters}</Text> : null}
      {panel?.recommended_tests?.length ? (
        <>
          <Text style={[styles.subheader, { marginTop: 10 }]}>RECOMMENDED TESTS</Text>
          <View style={styles.chipWrap}>
            {panel.recommended_tests.map((t: string, i: number) => <MetaChip key={i}>{t}</MetaChip>)}
          </View>
        </>
      ) : null}
      {panel?.frequency ? <Text style={styles.exNotes}>Frequency: {panel.frequency}</Text> : null}
      {panel?.flags_to_watch?.length ? (
        <>
          <Text style={[styles.subheader, { marginTop: 10 }]}>FLAGS TO WATCH</Text>
          <Text style={styles.body}>{panel.flags_to_watch.join(" · ")}</Text>
        </>
      ) : null}
    </View>
  );
}

function MonthlyProgression({ data }: any) {
  if (!Array.isArray(data)) return null;
  return <View>{data.map((m: any, i: number) => (
    <View key={i} style={styles.monthBlock}>
      <View style={styles.rowBetween}>
        <Text style={styles.dayName}>MONTH {m.month}</Text>
        {m.weight_target_kg != null ? <Text style={styles.monthTarget}>{m.weight_target_kg} kg</Text> : null}
      </View>
      {m.focus ? <Text style={styles.subheader}>{m.focus}</Text> : null}
      {m.volume_notes ? <Text style={styles.exNotes}>Volume: {m.volume_notes}</Text> : null}
      {m.intensity_notes ? <Text style={styles.exNotes}>Intensity: {m.intensity_notes}</Text> : null}
    </View>
  ))}</View>;
}

function RateValidation({ data }: any) {
  if (!data) return null;
  const verdict = (data.verdict || "").toLowerCase();
  const color = verdict === "safe" ? theme.color.success : verdict === "aggressive" ? theme.color.warning : theme.color.error;
  return (
    <View>
      <View style={[styles.verdictPill, { borderColor: color }]}><Text style={[styles.verdictText, { color }]}>{data.verdict?.toUpperCase() || "N/A"}</Text></View>
      {data.target_weekly_loss_kg != null ? <Text style={styles.exNotes}>Target: {data.target_weekly_loss_kg} kg/wk</Text> : null}
      {data.safe_range_kg ? <Text style={styles.exNotes}>Safe range: {data.safe_range_kg} kg/wk</Text> : null}
      {data.explanation ? <Text style={styles.body}>{data.explanation}</Text> : null}
    </View>
  );
}

function InjuryFlag({ data }: any) {
  if (!data) return null;
  const level = (data.level || "").toLowerCase();
  const color = level === "low" ? theme.color.success : level === "moderate" ? theme.color.warning : theme.color.error;
  return (
    <View>
      <View style={[styles.verdictPill, { borderColor: color }]}><Text style={[styles.verdictText, { color }]}>{data.level?.toUpperCase()} RISK</Text></View>
      {data.concerns?.length ? <Text style={styles.exNotes}>{data.concerns.join(" · ")}</Text> : null}
      {data.movements_to_avoid?.length ? <Text style={[styles.exNotes, { color: theme.color.warning }]}>Avoid: {data.movements_to_avoid.join(", ")}</Text> : null}
      {data.substitutions?.map?.((s: any, i: number) => (
        <Text key={i} style={styles.exNotes}>→ Instead of {s.avoid}: {s.use}</Text>
      ))}
    </View>
  );
}

function Recovery({ data }: any) {
  if (!data) return null;
  return (
    <View>
      {data.sleep_target_hours != null ? <Text style={styles.exNotes}>Sleep: {data.sleep_target_hours} hrs</Text> : null}
      {data.recovery_protocols?.length ? <Text style={styles.exNotes}>Protocols: {data.recovery_protocols.join(", ")}</Text> : null}
      {data.deload_frequency ? <Text style={styles.exNotes}>Deload: {data.deload_frequency}</Text> : null}
    </View>
  );
}

// =============== SHARED UI ===============

function CollapsibleCard({ title, icon, isOpen, onToggle, badge, children }: any) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHead} onPress={onToggle} testID={`collapse-${title}`}>
        <Ionicons name={icon} size={16} color={theme.color.brand} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
        <View style={{ flex: 1 }} />
        <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
      </Pressable>
      {isOpen ? <View style={{ marginTop: theme.spacing.md }}>{children}</View> : null}
    </View>
  );
}

function SectionCard({ title, children }: any) {
  return <View style={styles.formCard}><Text style={styles.formCardTitle}>{title}</Text>{children}</View>;
}
function FieldLabel({ children }: any) { return <Text style={styles.fieldLabel}>{children}</Text>; }
function Row({ children }: any) { return <View style={styles.formRow}>{children}</View>; }

function NumField({ label, value, onChange, testID }: any) {
  return (<View style={styles.field}><FieldLabel>{label}</FieldLabel>
    <TextInput style={styles.input} keyboardType="numeric" value={value} onChangeText={onChange} placeholderTextColor={theme.color.muted} testID={testID} /></View>);
}
function TextField({ label, value, onChange, placeholder, multiline, testID }: any) {
  return (<View style={[styles.field, { flex: undefined, width: "100%" }]}><FieldLabel>{label}</FieldLabel>
    <TextInput style={[styles.input, multiline && styles.inputMulti]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.color.muted} multiline={multiline} testID={testID} /></View>);
}
function Segment({ value, options, onChange, testID }: any) {
  return (<View style={styles.segment} testID={testID}>
    {options.map((opt: any) => {
      const active = opt.value === value;
      return (<Pressable key={opt.value} onPress={() => { Haptics.selectionAsync(); onChange(opt.value); }} style={[styles.segmentBtn, active && styles.segmentBtnActive]} testID={`${testID}-${opt.value}`}>
        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text></Pressable>);
    })}</View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.surface },

  hero: { height: 220, marginBottom: theme.spacing.lg, position: "relative", overflow: "hidden" },
  heroContent: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, bottom: theme.spacing.lg },
  heroKicker: { color: theme.color.brand, fontSize: 11, letterSpacing: 3, fontWeight: "700", marginBottom: 6 },
  heroTitle: { color: theme.color.onSurface, fontSize: 34, fontWeight: "900", letterSpacing: 1 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: 6 },
  closeBtn: { position: "absolute", top: 16, right: 16, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, padding: 8 },

  targetHead: {
    flexDirection: "row", alignItems: "flex-start", marginBottom: theme.spacing.md,
  },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: theme.color.brand,
    borderRadius: theme.radius.sm, paddingHorizontal: 8, paddingVertical: 5,
  },
  editBtnText: { color: theme.color.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  targetCol: { alignItems: "center", flex: 1 },
  targetVal: { color: theme.color.onSurface, fontSize: 22, fontWeight: "900" },
  unitSm: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
  targetLabel: { color: theme.color.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1, marginTop: 2 },

  kicker: { color: theme.color.brand, fontSize: 11, letterSpacing: 3, fontWeight: "700" },

  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius.sm, padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: theme.color.onSurface, fontWeight: "800", fontSize: 13, letterSpacing: 1.5 },
  subheader: { color: theme.color.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 6, marginTop: 6 },
  body: { color: theme.color.onSurface, fontSize: 13, lineHeight: 19 },
  hint: { color: theme.color.muted, fontSize: 12, fontStyle: "italic", marginTop: 6 },
  footnote: { color: theme.color.muted, fontSize: 10, textAlign: "center", marginTop: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  smallLabel: { color: theme.color.muted, fontSize: 9, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },

  restBlock: { alignItems: "center", paddingVertical: 20, gap: 6 },
  restText: { color: theme.color.muted, fontSize: 14, fontWeight: "900", letterSpacing: 2 },

  exRow: {
    flexDirection: "row", gap: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.color.divider,
    paddingVertical: theme.spacing.md,
  },
  exThumbWrap: { width: 84, height: 84, borderRadius: theme.radius.sm, overflow: "hidden", backgroundColor: theme.color.surfaceTertiary, justifyContent: "center", alignItems: "center" },
  doneOverlay: { position: "absolute", top: 4, right: 4 },
  exName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800" },
  exMeta: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  exNotes: { color: theme.color.muted, fontSize: 11, fontStyle: "italic", marginTop: 4 },
  exActions: { flexDirection: "row", gap: 6, marginTop: 6 },
  exBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brand, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.sm },
  exBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  exBtnGhost: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: theme.color.brand, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.sm },
  exBtnGhostText: { color: theme.color.brand, fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  metaChip: { backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: theme.color.border },
  metaChipText: { color: theme.color.onSurfaceSecondary, fontSize: 10, fontWeight: "700" },

  daySwitcher: { marginTop: 12, borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: 10, gap: 6 },
  dayChip: { backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  dayChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  dayChipText: { color: theme.color.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  dayChipTextActive: { color: theme.color.onBrand },

  badge: { backgroundColor: theme.color.brandTertiary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.brand, marginLeft: 6 },
  badgeText: { color: theme.color.brand, fontSize: 8, fontWeight: "800", letterSpacing: 1 },

  macroRow: { flexDirection: "row", gap: 6, marginBottom: theme.spacing.md },
  macroRowSmall: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  macroCell: { flex: 1, backgroundColor: theme.color.surfaceTertiary, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, padding: theme.spacing.sm, alignItems: "center" },
  macroLabel: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, marginBottom: 2 },
  macroValue: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },

  mealBlock: { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.md, marginTop: theme.spacing.md },
  mealHeader: { marginBottom: 8 },
  mealName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  mealMeta: { color: theme.color.muted, fontSize: 10, marginTop: 2 },
  mealChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mealChip: { backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.color.border },
  mealChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  mealChipText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  mealChipTextActive: { color: theme.color.onBrand },
  mealDetail: { marginTop: 8, backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.sm, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.color.border },
  mealDesc: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginBottom: 4 },

  suppRow: { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm },
  suppName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  suppDose: { color: theme.color.brand, fontSize: 11, fontWeight: "700" },
  suppMarker: { color: theme.color.warning, fontSize: 10, fontWeight: "700", marginTop: 2, letterSpacing: 0.5 },
  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill },
  priHigh: { backgroundColor: "rgba(213,0,0,0.15)", borderWidth: 1, borderColor: theme.color.error },
  priMed: { backgroundColor: "rgba(255,171,0,0.15)", borderWidth: 1, borderColor: theme.color.warning },
  priLow: { backgroundColor: "rgba(0,200,83,0.15)", borderWidth: 1, borderColor: theme.color.success },
  priorityText: { fontSize: 8, fontWeight: "900", letterSpacing: 1, color: theme.color.onSurface },
  tailoredBanner: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "rgba(0,200,83,0.1)", padding: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(0,200,83,0.3)", marginBottom: 8 },
  tailoredText: { color: theme.color.success, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  pendingBanner: { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(255,171,0,0.08)", padding: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(255,171,0,0.3)", marginBottom: 8 },
  pendingText: { color: theme.color.warning, fontSize: 11, flex: 1, lineHeight: 15 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },

  monthBlock: { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm },
  dayName: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  monthTarget: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },

  verdictPill: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderRadius: theme.radius.pill, marginBottom: theme.spacing.sm },
  verdictText: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },

  // form
  formCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.color.border, padding: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md,
  },
  formCardTitle: { color: theme.color.brand, fontWeight: "800", fontSize: 12, letterSpacing: 2, marginBottom: theme.spacing.md },
  formRow: { flexDirection: "row", gap: theme.spacing.md },
  field: { flex: 1, marginBottom: theme.spacing.md },
  fieldLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase", fontWeight: "600" },
  input: { backgroundColor: theme.color.surfaceTertiary, color: theme.color.onSurface, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, paddingVertical: Platform.OS === "ios" ? 12 : 10, fontSize: 15, borderWidth: 1, borderColor: theme.color.border },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  segment: { flexDirection: "row", backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.sm, padding: 3, borderWidth: 1, borderColor: theme.color.border, marginBottom: theme.spacing.md },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: theme.radius.sm - 2 },
  segmentBtnActive: { backgroundColor: theme.color.brand },
  segmentText: { color: theme.color.onSurfaceTertiary, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  segmentTextActive: { color: theme.color.onBrand },
  errorInline: { color: theme.color.error, marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm, fontSize: 13, fontWeight: "600" },
  ctaWrap: { padding: theme.spacing.lg, backgroundColor: theme.color.surface, borderTopWidth: 1, borderTopColor: theme.color.border },
  cta: { backgroundColor: theme.color.brand, borderRadius: theme.radius.md, paddingVertical: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: theme.color.onBrand, fontWeight: "800", letterSpacing: 1.5, fontSize: 14 },
  ctaHint: { color: theme.color.muted, fontSize: 11, textAlign: "center", marginTop: 6 },

  // modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: theme.spacing.lg },
  modalTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },
  modalSubtitle: { color: theme.color.muted, fontSize: 11, marginBottom: 12 },
  modalCta: { backgroundColor: theme.color.brand, borderRadius: theme.radius.sm, paddingVertical: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 8 },
});
