import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Colors } from "@/constants/Colors";

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error("EXPO_PUBLIC_API_URL must be set for production builds");
}
const API_URL = getApiUrl();

type FishCount = { species: string; count: number };

type ReportItem = {
  id: string;
  catchSummary: string | null;
  fishCounts: FishCount[];
  photoUrls: string[];
  createdAt: string;
  departureDate: string;
  startTime: string;
  vesselName: string;
  vesselColor: string;
  productName: string;
};

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function ReportCard({ report, onPress }: { report: ReportItem; onPress: () => void }) {
  return (
    <TouchableOpacity style={c.card} onPress={onPress} activeOpacity={0.8}>
      <View style={c.cardHeader}>
        <View style={[c.dot, { backgroundColor: report.vesselColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={c.vesselName}>{report.vesselName}</Text>
          <Text style={c.date}>{fmtDate(report.departureDate)}</Text>
        </View>
        {report.photoUrls.length > 0 && (
          <Image source={{ uri: report.photoUrls[0] }} style={c.thumb} />
        )}
      </View>

      {report.catchSummary ? (
        <Text style={c.summary} numberOfLines={2}>
          {report.catchSummary}
        </Text>
      ) : null}

      {report.fishCounts.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={c.chips}>
          {report.fishCounts.map((fc, i) => (
            <View key={i} style={c.chip}>
              <Text style={c.chipText}>
                {fc.count} {fc.species}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </TouchableOpacity>
  );
}

export default function ReportsScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchReports = useCallback(async (cursor?: string) => {
    try {
      const url = cursor
        ? `${API_URL}/api/reports?cursor=${encodeURIComponent(cursor)}`
        : `${API_URL}/api/reports`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { items: ReportItem[]; nextCursor: string | null };
      if (cursor) {
        setReports((prev) => [...prev, ...data.items]);
      } else {
        setReports(data.items);
      }
      setNextCursor(data.nextCursor);
    } catch {
      // Network error — show cached data if available
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchReports().finally(() => setLoading(false));
    }, [fetchReports]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReports();
    setRefreshing(false);
  }, [fetchReports]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchReports(nextCursor);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, fetchReports]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={Colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        data={reports}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <ReportCard
            report={item}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() =>
              router.push({ pathname: "/report/[reportId]" as any, params: { reportId: item.id } })
            }
          />
        )}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.teal} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🎣</Text>
            <Text style={s.emptyTitle}>No reports yet</Text>
            <Text style={s.emptyBody}>Check back after your next trip!</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={s.footer}>
              <ActivityIndicator color={Colors.teal} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 12 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 80,
    gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: Colors.ink, textAlign: "center" },
  emptyBody: { fontSize: 15, color: Colors.inkMuted, textAlign: "center" },
  footer: { paddingVertical: 16, alignItems: "center" },
});

const c = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  vesselName: { fontSize: 15, fontWeight: "700", color: Colors.ink },
  date: { fontSize: 12, color: Colors.inkSubtle, marginTop: 1 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.border,
  },
  summary: {
    fontSize: 14,
    color: Colors.inkMuted,
    lineHeight: 20,
  },
  chips: { marginTop: 2 },
  chip: {
    backgroundColor: Colors.teal + "18",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.teal,
  },
});
