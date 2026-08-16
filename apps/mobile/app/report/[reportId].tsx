import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { API_URL } from "@/lib/api";
import { Colors } from "@/constants/Colors";

type FishCount = { species: string; count: number };

type Report = {
  id: string;
  catchSummary: string | null;
  fishCounts: FishCount[];
  photoUrls: string[];
  createdAt: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  vesselName: string;
  vesselColor: string;
  productName: string;
};

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ReportDetailScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/reports/${reportId}`)
      .then((res) => (res.ok ? (res.json() as Promise<Report>) : null))
      .then((data) => setReport(data))
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={Colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={s.safe}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.centered}>
          <Text style={s.errorText}>Report not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity style={s.back} onPress={() => router.back()}>
        <Text style={s.backText}>← Fishing Reports</Text>
      </TouchableOpacity>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Vessel + trip info */}
        <View style={s.header}>
          <View style={[s.colorBar, { backgroundColor: report.vesselColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.vesselName}>{report.vesselName}</Text>
            <Text style={s.productName}>{report.productName}</Text>
            <Text style={s.date}>{fmtDate(report.departureDate)}</Text>
            <Text style={s.time}>
              {fmtTime(report.startTime)} – {fmtTime(report.endTime)}
            </Text>
          </View>
        </View>

        {/* Fish counts */}
        {report.fishCounts.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Today&apos;s Catch</Text>
            <View style={s.fishGrid}>
              {report.fishCounts.map((fc, i) => (
                <View key={i} style={s.fishCard}>
                  <Text style={s.fishCount}>{fc.count}</Text>
                  <Text style={s.fishSpecies}>{fc.species}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Catch summary */}
        {report.catchSummary ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Captain&apos;s Report</Text>
            <Text style={s.summary}>{report.catchSummary}</Text>
          </View>
        ) : null}

        {/* Photos */}
        {report.photoUrls.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Photos</Text>
            <View style={s.photoGrid}>
              {report.photoUrls.map((url, i) => (
                <Image key={i} source={{ uri: url }} style={s.photo} />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { paddingHorizontal: 16, paddingVertical: 12 },
  backText: { color: Colors.teal, fontSize: 15, fontWeight: "600" },
  errorText: { color: Colors.inkSubtle, fontSize: 16 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 16,
  },
  colorBar: { width: 4, borderRadius: 2, alignSelf: "stretch" },
  vesselName: { fontSize: 18, fontWeight: "700", color: Colors.ink },
  productName: { fontSize: 14, color: Colors.inkMuted, marginTop: 2 },
  date: { fontSize: 13, color: Colors.inkSubtle, marginTop: 4 },
  time: { fontSize: 13, color: Colors.inkSubtle },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  fishGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  fishCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    minWidth: 80,
  },
  fishCount: { fontSize: 28, fontWeight: "800", color: Colors.ink },
  fishSpecies: { fontSize: 12, color: Colors.inkMuted, marginTop: 2, textAlign: "center" },
  summary: {
    fontSize: 15,
    color: Colors.ink,
    lineHeight: 22,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photo: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: Colors.border,
  },
});
