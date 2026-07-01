import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { getOverview } from "@/src/api";

export default function HomeTab() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const d = await getOverview();
      setData(d);
    } catch (e) {
      console.log("overview error", e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const today = data?.today || { food_entries: [], totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } };
  const yday = data?.yesterday || { totals: { calories: 0 } };
  const checkin = data?.morning_checkin;
  const weight = data?.latest_weight;
  const target = data?.nutrition_targets;
  const health = data?.health;
  const isMockHealth = !health;
  const bodyTargets = data?.targets;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
      >
        <Text style={styles.kicker}>OVERVIEW</Text>
        <Text style={styles.title}>GOOD {greeting()}</Text>
        <Text style={styles.date}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>

        {/* Weight */}
        <View style={styles.card} testID="weight-card">
          <View style={styles.cardHead}>
            <Ionicons name="scale-outline" size={16} color={theme.color.brand} />
            <Text style={styles.cardKicker}>WEIGHT</Text>
          </View>
          {weight ? (
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.bigNum}>{weight}<Text style={styles.unit}> kg</Text></Text>
                <Text style={styles.smallLabel}>latest</Text>
              </View>
              {bodyTargets ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.midNum}>{bodyTargets.target_weight_kg}<Text style={styles.unit}> kg</Text></Text>
                  <Text style={styles.smallLabel}>target</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>Log a morning check-in to record your weight.</Text>
          )}
          {weight && bodyTargets ? (
            <View style={{ marginTop: 10 }}>
              <Progress current={weight} start={bodyTargets.start_weight_kg} target={bodyTargets.target_weight_kg} />
            </View>
          ) : null}
        </View>

        {/* Calories - Today vs Yesterday */}
        <View style={styles.card} testID="calories-card">
          <View style={styles.cardHead}>
            <Ionicons name="flame-outline" size={16} color={theme.color.brand} />
            <Text style={styles.cardKicker}>CALORIES</Text>
          </View>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.bigNum}>{today.totals.calories}</Text>
              <Text style={styles.smallLabel}>today so far</Text>
            </View>
            {target ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.midNum}>{target.daily_calories}</Text>
                <Text style={styles.smallLabel}>target</Text>
              </View>
            ) : null}
          </View>
          {target ? (
            <View style={styles.progressWrap}>
              <View style={[styles.progressFill, { width: `${Math.min(100, (today.totals.calories / Math.max(target.daily_calories, 1)) * 100)}%` }]} />
            </View>
          ) : null}
          <View style={styles.dividerRow}>
            <View style={styles.divCol}>
              <Text style={styles.smallLabel}>Yesterday</Text>
              <Text style={styles.subNum}>{yday.totals.calories} kcal</Text>
            </View>
            <View style={styles.vLine} />
            <View style={styles.divCol}>
              <Text style={styles.smallLabel}>Protein</Text>
              <Text style={styles.subNum}>{Math.round(today.totals.protein_g)}{target ? ` / ${target.protein_g}` : ""} g</Text>
            </View>
          </View>
        </View>

        {/* Morning check-in */}
        <View style={styles.card} testID="checkin-card">
          <View style={styles.cardHead}>
            <Ionicons name="sunny-outline" size={16} color={theme.color.brand} />
            <Text style={styles.cardKicker}>MORNING CHECK-IN</Text>
          </View>
          {checkin ? (
            <View style={styles.metricGrid}>
              <MetricTile label="Weight" value={checkin.weight_kg ? `${checkin.weight_kg} kg` : "—"} />
              <MetricTile label="Sleep" value={checkin.sleep_quality || "—"} />
              <MetricTile label="Bowel" value={checkin.bowel_movement || "—"} />
            </View>
          ) : (
            <Pressable onPress={() => router.push("/quick-log")} style={styles.ctaSmall} testID="checkin-cta">
              <Ionicons name="mic" size={14} color={theme.color.brand} />
              <Text style={styles.ctaSmallText}>RECORD MORNING CHECK-IN</Text>
            </Pressable>
          )}
        </View>

        {/* Apple Health */}
        <View style={styles.card} testID="health-card">
          <View style={styles.cardHead}>
            <Ionicons name="heart-outline" size={16} color={theme.color.brand} />
            <Text style={styles.cardKicker}>APPLE HEALTH</Text>
            <View style={{ flex: 1 }} />
            {isMockHealth ? (
              <View style={styles.mockBadge}><Text style={styles.mockBadgeText}>MOCKED</Text></View>
            ) : (
              <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
            )}
          </View>
          <View style={styles.metricGrid}>
            <MetricTile label="Steps" value={fmt(health?.steps, 8241)} />
            <MetricTile label="Active kcal" value={`${Math.round(health?.active_energy_kcal ?? 412)}`} />
            <MetricTile label="Sleep" value={`${health?.sleep_hours ?? 7.2}h`} />
            <MetricTile label="Avg HR" value={`${Math.round(health?.avg_hr ?? 72)}`} />
            <MetricTile label="Rest HR" value={`${Math.round(health?.resting_hr ?? 58)}`} />
            <MetricTile label="Workouts" value={`${health?.workouts ?? 0}`} />
          </View>
          {isMockHealth ? (
            <Text style={styles.footnote}>Real HealthKit data syncs after building the app on iPhone.</Text>
          ) : null}
        </View>

        {/* Food Log */}
        <View style={styles.card} testID="food-log-card">
          <View style={styles.cardHead}>
            <Ionicons name="restaurant-outline" size={16} color={theme.color.brand} />
            <Text style={styles.cardKicker}>TODAY&apos;S FOOD LOG</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.push("/quick-log")} testID="add-food-btn">
              <Ionicons name="add-circle" size={22} color={theme.color.brand} />
            </Pressable>
          </View>
          {today.food_entries.length === 0 ? (
            <Text style={styles.hint}>Tap the + button to log food via voice or photo.</Text>
          ) : (
            today.food_entries.map((f: any) => (
              <View key={f.id} style={styles.foodRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.foodItems} numberOfLines={2}>{(f.food_items || []).join(", ") || f.transcript || "—"}</Text>
                  <Text style={styles.foodMeta}>
                    {new Date(f.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {f.source}
                    {f.protein_g != null ? ` · P${Math.round(f.protein_g)} C${Math.round(f.carbs_g)} F${Math.round(f.fat_g)}` : ""}
                  </Text>
                </View>
                <Text style={styles.foodCal}>{f.estimated_calories} kcal</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "MORNING";
  if (h < 17) return "AFTERNOON";
  return "EVENING";
}

function fmt(v: any, fallback: any) {
  if (v == null) return typeof fallback === "number" ? fallback.toLocaleString() : String(fallback);
  return typeof v === "number" ? v.toLocaleString() : String(v);
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Progress({ current, start, target }: { current: number; start?: number; target: number }) {
  const from = start ?? current + 1;
  const total = Math.abs(from - target) || 1;
  const done = Math.abs(from - current);
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <View>
      <View style={styles.progressWrap}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.tiny}>{from} kg start</Text>
        <Text style={styles.tiny}>{Math.round(pct)}% to goal</Text>
        <Text style={styles.tiny}>{target} kg</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.surface },
  kicker: { color: theme.color.brand, fontSize: 11, letterSpacing: 3, fontWeight: "700" },
  title: { color: theme.color.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  date: { color: theme.color.muted, fontSize: 12, marginTop: 4, marginBottom: theme.spacing.lg },

  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius.sm, padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: theme.spacing.sm },
  cardKicker: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 2 },

  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  bigNum: { color: theme.color.onSurface, fontSize: 34, fontWeight: "900", lineHeight: 38 },
  midNum: { color: theme.color.muted, fontSize: 22, fontWeight: "800" },
  subNum: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  unit: { color: theme.color.muted, fontSize: 14, fontWeight: "700" },
  smallLabel: { color: theme.color.muted, fontSize: 9, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  tiny: { color: theme.color.muted, fontSize: 9, fontWeight: "600" },

  progressWrap: {
    height: 6, backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 3, overflow: "hidden", marginVertical: 6,
  },
  progressFill: { height: "100%", backgroundColor: theme.color.brand },

  dividerRow: {
    flexDirection: "row", marginTop: theme.spacing.md, gap: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.sm,
  },
  divCol: { flex: 1 },
  vLine: { width: 1, backgroundColor: theme.color.divider },

  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metricTile: {
    flexBasis: "31%", flexGrow: 1,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.color.border,
  },
  metricLabel: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  metricValue: { color: theme.color.onSurface, fontSize: 15, fontWeight: "800", marginTop: 2 },

  hint: { color: theme.color.muted, fontSize: 12, fontStyle: "italic" },
  footnote: { color: theme.color.muted, fontSize: 10, marginTop: 8, textAlign: "center" },

  mockBadge: {
    backgroundColor: theme.color.brandTertiary,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.brand,
  },
  mockBadgeText: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  liveBadge: {
    backgroundColor: "rgba(0,200,83,0.15)",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.success,
  },
  liveBadgeText: { color: theme.color.success, fontSize: 9, fontWeight: "800", letterSpacing: 1 },

  ctaSmall: {
    borderWidth: 1, borderColor: theme.color.brand,
    borderRadius: theme.radius.sm, paddingVertical: 12,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6,
  },
  ctaSmallText: { color: theme.color.brand, fontWeight: "800", letterSpacing: 1, fontSize: 12 },

  foodRow: {
    flexDirection: "row", alignItems: "flex-start",
    borderTopWidth: 1, borderTopColor: theme.color.divider,
    paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm,
  },
  foodItems: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  foodMeta: { color: theme.color.muted, fontSize: 10, marginTop: 2 },
  foodCal: { color: theme.color.brand, fontSize: 14, fontWeight: "800" },
});
