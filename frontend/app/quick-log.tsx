import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { AudioModule, useAudioRecorder, RecordingPresets } from "expo-audio";

import { theme } from "@/src/theme";
import { uploadMorningCheckin, uploadFoodVoice, uploadFoodImage } from "@/src/api";

type Mode = "checkin" | "food" | null;

export default function QuickLog() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recording) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])).start();
    } else { pulse.setValue(1); }
  }, [recording, pulse]);

  async function startRec(m: Exclude<Mode, null>) {
    try {
      setError(null); setResult(null);
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError(perm.canAskAgain === false ? "Microphone access denied. Enable it in Settings." : "Microphone permission required.");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setMode(m);
      setRecording(true);
    } catch (e: any) {
      setError(e?.message || "Failed to start recording");
    }
  }

  async function stopAndUpload() {
    if (!mode) return;
    const target = mode;
    setRecording(false);
    setBusy(target === "checkin" ? "Analyzing check-in…" : "Estimating calories…");
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error("No recording URI");
      const r = target === "checkin" ? await uploadMorningCheckin(uri) : await uploadFoodVoice(uri);
      setResult({ kind: target, data: r });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelRec() {
    setRecording(false);
    try { await audioRecorder.stop(); } catch {}
    setMode(null);
  }

  async function pickImage(fromCamera: boolean) {
    try {
      setError(null); setResult(null);
      let res;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError("Camera permission required"); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setError("Gallery permission required"); return; }
        res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true, mediaTypes: ["images"] });
      }
      if (res.canceled || !res.assets?.[0]?.base64) return;
      setBusy("Analyzing photo…");
      const asset = res.assets[0];
      const r = await uploadFoodImage(asset.base64!, asset.mimeType || "image/jpeg");
      setResult({ kind: "food-photo", data: r });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Photo analysis failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} testID="modal-dismiss" />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <Text style={styles.title}>QUICK LOG</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="close-modal">
            <Ionicons name="close" size={24} color={theme.color.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {recording || busy ? (
          <View style={styles.center}>
            {recording ? (
              <>
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <View style={styles.recBtn}>
                    <Ionicons name="mic" size={36} color={theme.color.onBrand} />
                  </View>
                </Animated.View>
                <Text style={styles.recHint}>{mode === "checkin" ? "SPEAK: WEIGHT, BOWEL, SLEEP" : "DESCRIBE WHAT YOU ATE"}</Text>
                <Pressable onPress={stopAndUpload} style={styles.stopBtn} testID="stop-record">
                  <Ionicons name="stop" size={18} color={theme.color.onBrand} />
                  <Text style={styles.stopText}>TAP TO STOP</Text>
                </Pressable>
                <Pressable onPress={cancelRec}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={theme.color.brand} />
                <Text style={styles.recHint}>{busy}</Text>
              </>
            )}
          </View>
        ) : result ? (
          <ResultView result={result} onDismiss={() => { setResult(null); setMode(null); }} onDone={() => router.back()} />
        ) : (
          <View style={{ gap: 10 }}>
            <ActionCard
              icon="sunny-outline" title="MORNING CHECK-IN"
              subtitle="Weight · bowel movement · sleep quality"
              onPress={() => startRec("checkin")}
              testID="opt-checkin"
              color={theme.color.brand}
            />
            <ActionCard
              icon="mic-outline" title="FOOD — VOICE"
              subtitle="Describe what you ate — calories & macros"
              onPress={() => startRec("food")}
              testID="opt-food-voice"
              color={theme.color.brand}
            />
            <ActionCard
              icon="camera-outline" title="FOOD — CAMERA"
              subtitle="Snap the plate — Claude vision analyzes it"
              onPress={() => pickImage(true)}
              testID="opt-food-camera"
              color={theme.color.brand}
            />
            <ActionCard
              icon="images-outline" title="FOOD — GALLERY"
              subtitle="Upload an existing food photo"
              onPress={() => pickImage(false)}
              testID="opt-food-gallery"
              color={theme.color.muted}
            />
          </View>
        )}

        {error ? (
          <View style={styles.errorBox} testID="quicklog-error">
            <Ionicons name="alert-circle-outline" size={14} color={theme.color.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function ActionCard({ icon, title, subtitle, onPress, testID, color }: any) {
  return (
    <Pressable onPress={onPress} style={styles.actionCard} testID={testID}>
      <View style={[styles.actionIcon, { borderColor: color }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
    </Pressable>
  );
}

function ResultView({ result, onDismiss, onDone }: any) {
  const d = result.data;
  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={styles.successBanner}>
        <Ionicons name="checkmark-circle" size={18} color={theme.color.success} />
        <Text style={styles.successText}>LOGGED SUCCESSFULLY</Text>
      </View>
      <View style={styles.resultCard}>
        {d.food_items?.length ? <Text style={styles.resItems}>{d.food_items.join(", ")}</Text> : null}
        {d.transcript ? <Text style={styles.transcript}>&quot;{d.transcript}&quot;</Text> : null}
        <View style={styles.chipRow}>
          {d.estimated_calories != null ? <Chip label="CAL" value={`${d.estimated_calories}`} /> : null}
          {d.protein_g != null ? <Chip label="P" value={`${d.protein_g}g`} /> : null}
          {d.carbs_g != null ? <Chip label="C" value={`${d.carbs_g}g`} /> : null}
          {d.fat_g != null ? <Chip label="F" value={`${d.fat_g}g`} /> : null}
          {d.weight_kg != null ? <Chip label="WEIGHT" value={`${d.weight_kg} kg`} /> : null}
          {d.sleep_quality ? <Chip label="SLEEP" value={d.sleep_quality} /> : null}
          {d.bowel_movement ? <Chip label="BOWEL" value={d.bowel_movement} /> : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={styles.secBtn} onPress={onDismiss}>
          <Text style={styles.secText}>LOG ANOTHER</Text>
        </Pressable>
        <Pressable style={styles.priBtn} onPress={onDone} testID="quicklog-done">
          <Text style={styles.priText}>DONE</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return <View style={styles.chip}><Text style={styles.chipLabel}>{label}</Text><Text style={styles.chipValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: theme.spacing.lg, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: theme.color.border,
    maxHeight: "88%",
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: theme.spacing.md },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.md },
  title: { color: theme.color.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2 },

  center: { alignItems: "center", padding: theme.spacing.xl, gap: 16 },
  recBtn: { width: 100, height: 100, borderRadius: 50, backgroundColor: theme.color.error, justifyContent: "center", alignItems: "center" },
  recHint: { color: theme.color.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textAlign: "center" },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.sm },
  stopText: { color: theme.color.onBrand, fontWeight: "800", letterSpacing: 1.5, fontSize: 12 },
  cancelText: { color: theme.color.muted, fontSize: 11 },

  actionCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius.sm, padding: theme.spacing.md,
  },
  actionIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  actionTitle: { color: theme.color.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  actionSub: { color: theme.color.muted, fontSize: 11, marginTop: 2 },

  errorBox: { flexDirection: "row", gap: 8, padding: 10, borderRadius: theme.radius.sm, backgroundColor: "rgba(213,0,0,0.1)", borderWidth: 1, borderColor: "rgba(213,0,0,0.4)", marginTop: theme.spacing.md, alignItems: "center" },
  errorText: { color: theme.color.error, flex: 1, fontSize: 12 },

  successBanner: { flexDirection: "row", gap: 8, backgroundColor: "rgba(0,200,83,0.1)", borderRadius: theme.radius.sm, padding: 12, borderWidth: 1, borderColor: "rgba(0,200,83,0.4)", alignItems: "center" },
  successText: { color: theme.color.success, fontWeight: "800", letterSpacing: 1, fontSize: 12 },

  resultCard: { backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, padding: theme.spacing.md, gap: 6 },
  resItems: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  transcript: { color: theme.color.muted, fontStyle: "italic", fontSize: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, gap: 4 },
  chipLabel: { color: theme.color.brand, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  chipValue: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },

  secBtn: { flex: 1, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, paddingVertical: 12, alignItems: "center" },
  secText: { color: theme.color.onSurfaceSecondary, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  priBtn: { flex: 1, backgroundColor: theme.color.brand, borderRadius: theme.radius.sm, paddingVertical: 12, alignItems: "center" },
  priText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 11, letterSpacing: 1.5 },
});
