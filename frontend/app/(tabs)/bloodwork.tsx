import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { getLatestBloodwork, uploadBloodworkImage, uploadBloodworkPdf } from "@/src/api";

export default function BloodworkTab() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getLatestBloodwork();
      setData(d && d.markers ? d : null);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  async function uploadImage(fromCamera: boolean) {
    try {
      setError(null);
      let res;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError("Camera permission required."); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setError("Photo library permission required."); return; }
        res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true, mediaTypes: ["images"] });
      }
      if (res.canceled || !res.assets?.[0]?.base64) return;
      setLoading(true);
      const asset = res.assets[0];
      const parsed = await uploadBloodworkImage(asset.base64!, asset.mimeType || "image/jpeg");
      setData(parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function uploadPdf() {
    try {
      setError(null);
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setLoading(true);
      const parsed = await uploadBloodworkPdf(res.assets[0].uri);
      setData(parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e?.message || "PDF upload failed");
    } finally {
      setLoading(false);
    }
  }

  const s = data?.suggestions;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
      >
        <Text style={styles.kicker}>BLOODWORK</Text>
        <Text style={styles.title}>YOUR MARKERS</Text>
        <Text style={styles.sub}>Upload a blood report image or PDF — Claude parses the markers and delivers tailored guidance.</Text>

        {/* Upload actions */}
        <View style={styles.uploadRow}>
          <Pressable style={styles.uploadBtn} onPress={() => uploadImage(true)} disabled={loading} testID="upload-camera">
            <Ionicons name="camera" size={18} color={theme.color.onBrand} />
            <Text style={styles.uploadText}>CAMERA</Text>
          </Pressable>
          <Pressable style={styles.uploadBtn} onPress={() => uploadImage(false)} disabled={loading} testID="upload-gallery">
            <Ionicons name="images-outline" size={18} color={theme.color.onBrand} />
            <Text style={styles.uploadText}>GALLERY</Text>
          </Pressable>
          <Pressable style={styles.uploadBtnGhost} onPress={uploadPdf} disabled={loading} testID="upload-pdf">
            <Ionicons name="document-outline" size={18} color={theme.color.brand} />
            <Text style={styles.uploadTextGhost}>PDF</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={theme.color.brand} />
            <Text style={styles.hint}>Parsing report & preparing tailored advice…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox} testID="bw-error">
            <Ionicons name="alert-circle-outline" size={14} color={theme.color.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Empty state */}
        {!data ? (
          <View style={styles.emptyCard}>
            <Ionicons name="water-outline" size={40} color={theme.color.muted} />
            <Text style={styles.emptyTitle}>NO REPORT UPLOADED</Text>
            <Text style={styles.emptySub}>Until you upload a report we suggest the recommended panel from your plan. Once uploaded we produce personalized supplement + lifestyle advice grounded in your readings.</Text>
          </View>
        ) : null}

        {/* Loaded state */}
        {data && s ? (
          <>
            {s.overall_summary ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="document-text-outline" size={16} color={theme.color.brand} />
                  <Text style={styles.cardKicker}>SUMMARY</Text>
                </View>
                <Text style={styles.body}>{s.overall_summary}</Text>
                {s.retest_in_weeks ? <Text style={styles.footnote}>Recommended retest in {s.retest_in_weeks} weeks</Text> : null}
              </View>
            ) : null}

            {/* Markers */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="analytics-outline" size={16} color={theme.color.brand} />
                <Text style={styles.cardKicker}>MARKERS · {(data.markers || []).length}</Text>
              </View>
              {(data.markers || []).map((m: any, i: number) => {
                const flag = (m.flag || "").toLowerCase();
                const color = flag === "high" ? theme.color.error : flag === "low" ? theme.color.warning : flag === "normal" ? theme.color.success : theme.color.muted;
                return (
                  <View key={i} style={styles.markerRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.markerName}>{m.name}</Text>
                      {m.reference_range ? <Text style={styles.tiny}>range {m.reference_range}</Text> : null}
                    </View>
                    <Text style={styles.markerValue}>{m.value}<Text style={styles.markerUnit}> {m.unit}</Text></Text>
                    <View style={[styles.flagDot, { backgroundColor: color }]} />
                    <Text style={[styles.flagText, { color }]}>{flag.toUpperCase() || "—"}</Text>
                  </View>
                );
              })}
            </View>

            {/* Abnormal findings */}
            {s.abnormal_findings?.length ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="alert-circle-outline" size={16} color={theme.color.warning} />
                  <Text style={styles.cardKicker}>ABNORMAL FINDINGS</Text>
                </View>
                {s.abnormal_findings.map((f: any, i: number) => (
                  <View key={i} style={styles.findingRow}>
                    <Text style={styles.findingMarker}>{f.marker}</Text>
                    <Text style={styles.body}>{f.finding}</Text>
                    <Text style={styles.tiny}>Why it matters: {f.clinical_significance}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Supplement recommendations */}
            {s.supplement_recommendations?.length ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="flask-outline" size={16} color={theme.color.brand} />
                  <Text style={styles.cardKicker}>SUPPLEMENT PLAN</Text>
                </View>
                {s.supplement_recommendations.map((r: any, i: number) => {
                  const p = (r.priority || "").toLowerCase();
                  const c = p === "high" ? theme.color.error : p === "medium" ? theme.color.warning : theme.color.success;
                  return (
                    <View key={i} style={styles.suppRow}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.suppName}>{r.name}</Text>
                        <View style={[styles.pri, { borderColor: c }]}><Text style={[styles.priText, { color: c }]}>{p.toUpperCase()}</Text></View>
                      </View>
                      <Text style={styles.suppDose}>{r.dose} · {r.timing}</Text>
                      <Text style={styles.body}>{r.rationale}</Text>
                      {r.based_on_marker ? <Text style={styles.suppMarker}>Marker: {r.based_on_marker}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Lifestyle */}
            {s.lifestyle_recommendations?.length ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="body-outline" size={16} color={theme.color.brand} />
                  <Text style={styles.cardKicker}>LIFESTYLE</Text>
                </View>
                {s.lifestyle_recommendations.map((l: string, i: number) => (
                  <BulletRow key={i}>{l}</BulletRow>
                ))}
              </View>
            ) : null}

            {/* Dietary */}
            {s.dietary_recommendations?.length ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="restaurant-outline" size={16} color={theme.color.brand} />
                  <Text style={styles.cardKicker}>DIET ADJUSTMENTS</Text>
                </View>
                {s.dietary_recommendations.map((l: string, i: number) => (
                  <BulletRow key={i}>{l}</BulletRow>
                ))}
              </View>
            ) : null}

            {/* Doctor flags */}
            {s.flags_for_doctor?.length ? (
              <View style={[styles.card, { borderColor: theme.color.error }]}>
                <View style={styles.cardHead}>
                  <Ionicons name="medical-outline" size={16} color={theme.color.error} />
                  <Text style={[styles.cardKicker, { color: theme.color.error }]}>DISCUSS WITH DOCTOR</Text>
                </View>
                {s.flags_for_doctor.map((l: string, i: number) => (
                  <BulletRow key={i} color={theme.color.error}>{l}</BulletRow>
                ))}
              </View>
            ) : null}

            <Text style={styles.footnote}>Uploaded {new Date(data.created_at).toLocaleString()}</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function BulletRow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
      <Text style={{ color: color || theme.color.brand, fontSize: 14, lineHeight: 18 }}>•</Text>
      <Text style={{ color: theme.color.onSurface, fontSize: 13, flex: 1, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.surface },
  kicker: { color: theme.color.brand, fontSize: 11, letterSpacing: 3, fontWeight: "700" },
  title: { color: theme.color.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  sub: { color: theme.color.muted, fontSize: 12, marginTop: 4, marginBottom: theme.spacing.lg },

  uploadRow: { flexDirection: "row", gap: 6, marginBottom: theme.spacing.md },
  uploadBtn: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: theme.color.brand, borderRadius: theme.radius.sm, paddingVertical: 12 },
  uploadText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  uploadBtnGhost: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.color.brand, borderRadius: theme.radius.sm, paddingVertical: 12 },
  uploadTextGhost: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  busyBox: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", padding: theme.spacing.md },

  errorBox: { flexDirection: "row", gap: 8, padding: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: "rgba(213,0,0,0.1)", borderWidth: 1, borderColor: "rgba(213,0,0,0.4)", marginBottom: theme.spacing.md, alignItems: "center" },
  errorText: { color: theme.color.error, flex: 1, fontSize: 12 },

  emptyCard: { alignItems: "center", gap: 10, padding: theme.spacing.xl, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTitle: { color: theme.color.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  emptySub: { color: theme.color.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },

  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: theme.spacing.sm },
  cardKicker: { color: theme.color.brand, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  body: { color: theme.color.onSurface, fontSize: 13, lineHeight: 18, marginTop: 4 },
  hint: { color: theme.color.muted, fontSize: 12 },
  footnote: { color: theme.color.muted, fontSize: 10, textAlign: "center", marginTop: 4 },
  tiny: { color: theme.color.muted, fontSize: 10 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  markerRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: theme.color.divider, paddingVertical: 8 },
  markerName: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
  markerValue: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800" },
  markerUnit: { color: theme.color.muted, fontSize: 10, fontWeight: "600" },
  flagDot: { width: 8, height: 8, borderRadius: 4 },
  flagText: { fontSize: 10, fontWeight: "800", letterSpacing: 1, width: 55, textAlign: "right" },

  findingRow: { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm },
  findingMarker: { color: theme.color.warning, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  suppRow: { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm },
  suppName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800" },
  suppDose: { color: theme.color.brand, fontSize: 11, fontWeight: "700", marginTop: 2 },
  suppMarker: { color: theme.color.warning, fontSize: 10, fontWeight: "700", marginTop: 4, letterSpacing: 0.5 },
  pri: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill, borderWidth: 1 },
  priText: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
});
