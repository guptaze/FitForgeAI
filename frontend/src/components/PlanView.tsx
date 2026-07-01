import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, LayoutAnimation, Platform, UIManager } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { theme } from "@/src/theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  plan: any;
  createdAt: string | null;
  onRegenerate: () => void;
};

const SECTION_META: { key: string; title: string; icon: any }[] = [
  { key: "summary", title: "SUMMARY", icon: "document-text-outline" },
  { key: "training_split", title: "TRAINING SPLIT", icon: "barbell-outline" },
  { key: "monthly_progression", title: "MONTHLY PROGRESSION", icon: "trending-up-outline" },
  { key: "nutrition_framework", title: "NUTRITION FRAMEWORK", icon: "nutrition-outline" },
  { key: "supplement_stack", title: "SUPPLEMENT STACK", icon: "flask-outline" },
  { key: "blood_panel", title: "BLOOD PANEL", icon: "medical-outline" },
  { key: "weekly_rate_validation", title: "WEEKLY RATE VALIDATION", icon: "speedometer-outline" },
  { key: "injury_risk_flag", title: "INJURY RISK FLAG", icon: "warning-outline" },
  { key: "recovery_and_sleep", title: "RECOVERY & SLEEP", icon: "moon-outline" },
];

export default function PlanView({ plan, createdAt, onRegenerate }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    summary: true,
    training_split: true,
  });

  const toggle = (k: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen((s) => ({ ...s, [k]: !s[k] }));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>FITFORGE PLAN</Text>
          <Text style={styles.title}>YOUR BLUEPRINT</Text>
          {createdAt ? (
            <Text style={styles.meta}>Generated {new Date(createdAt).toLocaleString()}</Text>
          ) : null}
        </View>
        <Pressable style={styles.regenBtn} onPress={onRegenerate} testID="regenerate-button">
          <Ionicons name="refresh" size={16} color={theme.color.brand} />
          <Text style={styles.regenText}>NEW</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        {SECTION_META.map((meta) => {
          const value = plan[meta.key];
          if (!value) return null;
          const isOpen = !!open[meta.key];
          return (
            <View key={meta.key} style={styles.section} testID={`section-${meta.key}`}>
              <Pressable style={styles.sectionHeader} onPress={() => toggle(meta.key)} testID={`toggle-${meta.key}`}>
                <Ionicons name={meta.icon} size={18} color={theme.color.brand} />
                <Text style={styles.sectionTitle}>{meta.title}</Text>
                <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={20} color={theme.color.muted} />
              </Pressable>
              {isOpen ? <View style={styles.sectionBody}>{renderSection(meta.key, value)}</View> : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

// -------- Renderers --------

function renderSection(key: string, val: any) {
  if (key === "summary") return <Paragraph text={typeof val === "string" ? val : JSON.stringify(val)} />;
  if (key === "training_split") return <TrainingSplit data={val} />;
  if (key === "monthly_progression") return <MonthlyProgression data={val} />;
  if (key === "nutrition_framework") return <NutritionFramework data={val} />;
  if (key === "supplement_stack") return <SupplementStack data={val} />;
  if (key === "blood_panel") return <BloodPanel data={val} />;
  if (key === "weekly_rate_validation") return <RateValidation data={val} />;
  if (key === "injury_risk_flag") return <InjuryFlag data={val} />;
  if (key === "recovery_and_sleep") return <Recovery data={val} />;
  return <Paragraph text={JSON.stringify(val, null, 2)} />;
}

function Paragraph({ text }: { text: string }) {
  return <Text style={styles.body}>{text}</Text>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

function TrainingSplit({ data }: { data: any }) {
  const rows = Array.isArray(data?.table) ? data.table : [];
  return (
    <View>
      {data?.structure ? <Text style={styles.subheader}>{data.structure}</Text> : null}
      {rows.map((r: any, i: number) => (
        <View key={i} style={styles.dayBlock}>
          <View style={styles.dayHeader}>
            <Text style={styles.dayName}>{r.day}</Text>
            <Text style={styles.dayFocus}>{r.focus}</Text>
          </View>
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 3 }]}>EXERCISE</Text>
              <Text style={[styles.th, { flex: 1, textAlign: "center" }]}>SETS</Text>
              <Text style={[styles.th, { flex: 1.2, textAlign: "center" }]}>REPS</Text>
              <Text style={[styles.th, { flex: 1.2, textAlign: "center" }]}>REST</Text>
            </View>
            {(r.exercises || []).map((ex: any, j: number) => (
              <View key={j} style={[styles.tr, j % 2 === 1 && styles.trAlt]}>
                <View style={{ flex: 3 }}>
                  <Text style={styles.td}>{ex.name}</Text>
                  {ex.notes ? <Text style={styles.tdNotes}>{ex.notes}</Text> : null}
                </View>
                <Text style={[styles.td, { flex: 1, textAlign: "center" }]}>{ex.sets}</Text>
                <Text style={[styles.td, { flex: 1.2, textAlign: "center" }]}>{ex.reps}</Text>
                <Text style={[styles.td, { flex: 1.2, textAlign: "center" }]}>{ex.rest}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function MonthlyProgression({ data }: { data: any }) {
  const arr = Array.isArray(data) ? data : [];
  return (
    <View>
      {arr.map((m: any, i: number) => (
        <View key={i} style={styles.monthBlock}>
          <View style={styles.monthHead}>
            <Text style={styles.monthTag}>MONTH {m.month}</Text>
            {m.weight_target_kg != null ? (
              <Text style={styles.monthTarget}>{m.weight_target_kg} kg target</Text>
            ) : null}
          </View>
          {m.focus ? <Text style={styles.subheader}>{m.focus}</Text> : null}
          {m.volume_notes ? <Row label="VOLUME" value={m.volume_notes} /> : null}
          {m.intensity_notes ? <Row label="INTENSITY" value={m.intensity_notes} /> : null}
        </View>
      ))}
    </View>
  );
}

function NutritionFramework({ data }: { data: any }) {
  return (
    <View>
      <View style={styles.macroRow}>
        <MacroCell label="CAL" value={`${data.daily_calories ?? "-"}`} />
        <MacroCell label="PROTEIN" value={`${data.protein_g ?? "-"}g`} />
        <MacroCell label="CARBS" value={`${data.carbs_g ?? "-"}g`} />
        <MacroCell label="FAT" value={`${data.fat_g ?? "-"}g`} />
      </View>
      {data.meal_structure ? <Row label="MEALS" value={data.meal_structure} /> : null}
      {data.cheat_day_rule ? <Row label="CHEAT DAY" value={data.cheat_day_rule} /> : null}
      {data.hydration_l != null ? <Row label="HYDRATION" value={`${data.hydration_l} L / day`} /> : null}
    </View>
  );
}

function MacroCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{value}</Text>
    </View>
  );
}

function SupplementStack({ data }: { data: any }) {
  const arr = Array.isArray(data) ? data : [];
  return (
    <View>
      {arr.map((s: any, i: number) => (
        <View key={i} style={styles.suppRow}>
          <View style={styles.suppHead}>
            <Text style={styles.suppName}>{s.name}</Text>
            <Text style={styles.suppDose}>{s.dose}</Text>
          </View>
          {s.timing ? <Text style={styles.tdNotes}>Timing: {s.timing}</Text> : null}
          {s.purpose ? <Text style={styles.tdNotes}>{s.purpose}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function BloodPanel({ data }: { data: any }) {
  return (
    <View>
      {data.recommended_tests?.length ? (
        <Row label="TESTS" value={data.recommended_tests.join(", ")} />
      ) : null}
      {data.frequency ? <Row label="FREQUENCY" value={data.frequency} /> : null}
      {data.flags_to_watch?.length ? (
        <Row label="FLAGS" value={data.flags_to_watch.join(", ")} />
      ) : null}
    </View>
  );
}

function RateValidation({ data }: { data: any }) {
  const verdict = (data.verdict || "").toLowerCase();
  const color =
    verdict === "safe" ? theme.color.success : verdict === "aggressive" ? theme.color.warning : theme.color.error;
  return (
    <View>
      <View style={[styles.verdictPill, { borderColor: color }]}>
        <Text style={[styles.verdictText, { color }]}>{data.verdict?.toUpperCase() || "N/A"}</Text>
      </View>
      {data.target_weekly_loss_kg != null ? (
        <Row label="TARGET" value={`${data.target_weekly_loss_kg} kg / week`} />
      ) : null}
      {data.safe_range_kg ? <Row label="SAFE RANGE" value={`${data.safe_range_kg} kg/wk`} /> : null}
      {data.explanation ? <Paragraph text={data.explanation} /> : null}
    </View>
  );
}

function InjuryFlag({ data }: { data: any }) {
  const level = (data.level || "").toLowerCase();
  const color =
    level === "low" ? theme.color.success : level === "moderate" ? theme.color.warning : theme.color.error;
  return (
    <View>
      <View style={[styles.verdictPill, { borderColor: color }]}>
        <Text style={[styles.verdictText, { color }]}>{data.level?.toUpperCase() || "N/A"} RISK</Text>
      </View>
      {data.concerns?.length ? <Row label="CONCERNS" value={data.concerns.join("; ")} /> : null}
      {data.movements_to_avoid?.length ? <Row label="AVOID" value={data.movements_to_avoid.join(", ")} /> : null}
      {data.substitutions?.map?.((sub: any, i: number) => (
        <Row key={i} label={`→ ${sub.avoid}`} value={sub.use} />
      ))}
    </View>
  );
}

function Recovery({ data }: { data: any }) {
  return (
    <View>
      {data.sleep_target_hours != null ? <Row label="SLEEP" value={`${data.sleep_target_hours} hrs`} /> : null}
      {data.recovery_protocols?.length ? (
        <Row label="PROTOCOLS" value={data.recovery_protocols.join(", ")} />
      ) : null}
      {data.deload_frequency ? <Row label="DELOAD" value={data.deload_frequency} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  kicker: { color: theme.color.brand, fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "900", letterSpacing: 1 },
  meta: { color: theme.color.muted, fontSize: 11, marginTop: 2 },
  regenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: theme.color.brand,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  regenText: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  section: {
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    marginBottom: theme.spacing.md,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  sectionTitle: {
    flex: 1,
    color: theme.color.onSurface,
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 1.5,
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: theme.color.divider,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  subheader: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: theme.spacing.sm,
  },
  body: { color: theme.color.onSurface, fontSize: 14, lineHeight: 20 },

  kvRow: { flexDirection: "row", marginBottom: 6, gap: theme.spacing.sm },
  kvLabel: { color: theme.color.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1, width: 92, paddingTop: 2 },
  kvValue: { color: theme.color.onSurface, fontSize: 13, flex: 1, lineHeight: 18 },

  dayBlock: { marginBottom: theme.spacing.lg },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: theme.spacing.sm },
  dayName: { color: theme.color.brand, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  dayFocus: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },

  table: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  trHead: {
    flexDirection: "row",
    backgroundColor: theme.color.surfaceTertiary,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  th: { color: theme.color.onSurfaceTertiary, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8, alignItems: "center" },
  trAlt: { backgroundColor: theme.color.surfaceTertiary },
  td: { color: theme.color.onSurface, fontSize: 12, fontWeight: "500" },
  tdNotes: { color: theme.color.muted, fontSize: 10, marginTop: 2, fontStyle: "italic" },

  monthBlock: { marginBottom: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  monthHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  monthTag: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  monthTarget: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },

  macroRow: { flexDirection: "row", gap: 6, marginBottom: theme.spacing.md },
  macroCell: {
    flex: 1,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    alignItems: "center",
  },
  macroLabel: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, marginBottom: 2 },
  macroValue: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },

  suppRow: {
    borderTopWidth: 1,
    borderTopColor: theme.color.divider,
    paddingTop: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  suppHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  suppName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  suppDose: { color: theme.color.brand, fontSize: 12, fontWeight: "700" },

  verdictPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderRadius: theme.radius.pill,
    marginBottom: theme.spacing.md,
  },
  verdictText: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
});
