import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { API_URL } from "@/lib/api";
import { fmtTime } from "@openboat/utils";
import { useMateAuth } from "@/lib/mate-auth-context";
import {
  cacheManifest,
  cacheTrips,
  getCachedTrips,
  syncCheckIns,
  type MateManifest,
  type MateTrip,
} from "@/lib/mate-store";
import { Colors } from "@/constants/Colors";

function statusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "sailed":
      return "Sailed";
    case "cancelled":
      return "Cancelled";
    case "pending_settlement":
      return "Pending";
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "sailed":
      return Colors.success;
    case "cancelled":
      return Colors.error;
    case "pending_settlement":
      return Colors.warning;
    default:
      return Colors.inkSubtle;
  }
}

// ─── TripCard ─────────────────────────────────────────────────────────────────

function TripCard({ trip, onPress }: { trip: MateTrip; onPress: () => void }) {
  const isCancelled = trip.status === "cancelled";
  const checkinPct =
    trip.ticketsSold > 0 ? Math.round((trip.checkedIn / trip.ticketsSold) * 100) : 0;

  return (
    <TouchableOpacity
      style={[c.card, isCancelled && c.cardCancelled]}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={isCancelled}
    >
      <View style={[c.colorBar, { backgroundColor: trip.vessel.color }]} />
      <View style={c.body}>
        <View style={c.topRow}>
          <Text style={c.vesselName}>{trip.vessel.name}</Text>
          <View style={[c.badge, { backgroundColor: statusColor(trip.status) + "22" }]}>
            <Text style={[c.badgeText, { color: statusColor(trip.status) }]}>
              {statusLabel(trip.status)}
            </Text>
          </View>
        </View>
        <Text style={c.productName}>{trip.product.displayName}</Text>
        <Text style={c.time}>
          {fmtTime(trip.startTime)} → {fmtTime(trip.endTime)}
        </Text>
        {!isCancelled && (
          <View style={c.progress}>
            <View style={c.progressTrack}>
              <View
                style={[
                  c.progressFill,
                  { width: `${checkinPct}%` as `${number}%`, backgroundColor: trip.vessel.color },
                ]}
              />
            </View>
            <Text style={c.progressLabel}>
              {trip.checkedIn}/{trip.ticketsSold} checked in
            </Text>
          </View>
        )}
      </View>
      {!isCancelled && <Text style={c.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

// ─── MateTripsScreen ──────────────────────────────────────────────────────────

export default function MateTripsScreen() {
  const { token, staff, logout } = useMateAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<MateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromCache = useCallback(async () => {
    const cached = await getCachedTrips();
    setTrips(cached);
  }, []);

  const syncQueue = useCallback(async () => {
    if (!token) return;
    await syncCheckIns(token, API_URL);
  }, [token]);

  const fetchFromApi = useCallback(async () => {
    if (!token) return;
    try {
      const localDate = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
      const res = await fetch(`${API_URL}/api/mate/trips?date=${localDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as MateTrip[];
        await cacheTrips(data);
        setTrips(data);
        // Refresh manifests in the background so offline cache stays current
        await Promise.allSettled(
          data.map(async (trip) => {
            const mRes = await fetch(`${API_URL}/api/mate/manifest?tripId=${trip.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (mRes.ok) {
              const manifest = (await mRes.json()) as MateManifest;
              await cacheManifest(trip.id, manifest);
            }
          }),
        );
      }
    } catch {
      // offline — use cache
    }
  }, [token]);

  // Initial load from SQLite cache
  useEffect(() => {
    loadFromCache().finally(() => setLoading(false));
  }, [loadFromCache]);

  // On every focus (including returning from manifest): sync queue then refresh counts
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      syncQueue().then(fetchFromApi);
    }, [token, syncQueue, fetchFromApi]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncQueue();
    await fetchFromApi();
    setRefreshing(false);
  }, [syncQueue, fetchFromApi]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  // Auth guard — all hooks must be above this line
  if (!token) return <Redirect href="/(mate)/login" />;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Hi, {staff?.name ?? "Mate"}</Text>
          <Text style={s.date}>{today}</Text>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={Colors.teal} size="large" />
        </View>
      ) : trips.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🚢</Text>
          <Text style={s.emptyTitle}>No trips today</Text>
          <Text style={s.emptyBody}>Pull down to refresh.</Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.teal} />
          }
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionLabel}>
            {trips.length} trip{trips.length !== 1 ? "s" : ""} departing today
          </Text>
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onPress={() =>
                router.push({
                  pathname: "/(mate)/manifest/[tripId]",
                  params: { tripId: trip.id },
                })
              }
            />
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.navy,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  greeting: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.white,
  },
  date: {
    fontSize: 13,
    color: Colors.whiteA75,
    marginTop: 2,
  },
  logoutText: {
    fontSize: 14,
    color: Colors.whiteA85,
    fontWeight: "600",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: Colors.ink, textAlign: "center" },
  emptyBody: { fontSize: 15, color: Colors.inkMuted, textAlign: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.inkSubtle,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
});

const c = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    marginBottom: 12,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardCancelled: { opacity: 0.5 },
  colorBar: { width: 6 },
  body: { flex: 1, padding: 12 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  vesselName: { fontSize: 16, fontWeight: "700", color: Colors.ink },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  productName: { fontSize: 13, color: Colors.inkMuted, fontWeight: "500", marginBottom: 1 },
  time: { fontSize: 13, color: Colors.inkSubtle },
  progress: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 12,
    color: Colors.inkSubtle,
    fontWeight: "600",
    minWidth: 90,
  },
  chevron: {
    fontSize: 22,
    color: Colors.inkSubtle,
    alignSelf: "center",
    paddingRight: 12,
  },
});
