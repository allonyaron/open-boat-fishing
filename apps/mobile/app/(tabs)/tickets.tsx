import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { API_URL } from "@/lib/api";
import { fmtTime } from "@openboat/utils";
import { Sheet } from "@/components/Sheet";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { tripTypeColor } from "@/lib/trip-helpers";
import {
  type WalletBooking,
  type WalletBookingItem,
  getAllBookings,
  upsertBooking,
} from "@/lib/wallet";

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtCountdown(startIso: string): string {
  const diffMs = new Date(startIso).getTime() - Date.now();
  const hrs = Math.round(diffMs / 3_600_000);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const tripDate = startIso.slice(0, 10);
  const dayWord = tripDate === today ? "TODAY" : tripDate === tomorrow ? "TOMORROW" : fmtDate(tripDate).toUpperCase();
  if (hrs <= 0) return `${dayWord} · BOARDING NOW`;
  if (hrs < 48) return `${dayWord} · IN ${hrs} HOUR${hrs === 1 ? "" : "S"}`;
  return dayWord;
}

// ─── AddBookingSheet ──────────────────────────────────────────────────────────

function AddBookingSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: (b: WalletBooking) => void }) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFind = useCallback(async () => {
    const cleanCode = code.trim().toUpperCase();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanCode || !cleanEmail) {
      setError("Enter your confirmation code and email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/bookings?code=${encodeURIComponent(cleanCode)}&email=${encodeURIComponent(cleanEmail)}`);
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? "Booking not found. Check your code and email.");
        return;
      }
      const booking = await upsertBooking(data as Omit<WalletBooking, "syncedAt">);
      onAdded(booking);
      onClose();
    } catch {
      setError("Could not connect to server. Try again when you have signal.");
    } finally {
      setLoading(false);
    }
  }, [code, email, onAdded, onClose]);

  return (
    <Sheet visible={visible} detent={0.5} onClose={onClose}>
      <View style={add.body}>
        <Text style={add.title}>ADD A BOOKING</Text>
        <Text style={add.subtitle}>Your confirmation code and email are in your booking receipt.</Text>

        <Text style={add.label}>CONFIRMATION CODE</Text>
        <TextInput
          style={add.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="A1B2C3"
          placeholderTextColor={color.disabledBorder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          returnKeyType="next"
        />

        <Text style={add.label}>EMAIL USED AT PURCHASE</Text>
        <TextInput
          style={add.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={color.disabledBorder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="done"
          onSubmitEditing={handleFind}
        />

        {error ? <Text style={add.error}>{error}</Text> : null}

        <TouchableOpacity style={[add.btn, loading && add.btnLoading]} onPress={handleFind} disabled={loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color={color.white} /> : <Text style={add.btnText}>FIND MY TICKETS</Text>}
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}

// ─── TicketsScreen ────────────────────────────────────────────────────────────

type Grouped = { item: WalletBookingItem; booking: WalletBooking };

export default function TicketsScreen() {
  const router = useRouter();
  const [bookings, setBookings] = useState<WalletBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const loadFromCache = useCallback(async () => {
    setBookings(await getAllBookings());
  }, []);

  useEffect(() => {
    loadFromCache().finally(() => setLoading(false));
  }, [loadFromCache]);

  useFocusEffect(
    useCallback(() => {
      loadFromCache();
    }, [loadFromCache]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const stored = await getAllBookings();
      const results = await Promise.allSettled(
        stored.map((b) =>
          fetch(`${API_URL}/api/bookings?code=${b.confirmationCode}&email=${encodeURIComponent(b.customerEmail)}`)
            .then((r) => r.json() as Promise<Omit<WalletBooking, "syncedAt">>)
            .then((data) => upsertBooking(data)),
        ),
      );
      setBookings(results.map((r, i) => (r.status === "fulfilled" ? r.value : stored[i])));
    } catch {
      /* keep showing cached data */
    } finally {
      setRefreshing(false);
    }
  }, []);

  const all: Grouped[] = [];
  for (const booking of bookings) {
    for (const item of booking.items) all.push({ item, booking });
  }
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all
    .filter((g) => g.item.trip.departureDate >= today && g.item.trip.status !== "cancelled")
    .sort((a, b) => a.item.trip.startTime.localeCompare(b.item.trip.startTime));
  const past = all
    .filter((g) => g.item.trip.departureDate < today || g.item.trip.status === "cancelled")
    .sort((a, b) => b.item.trip.startTime.localeCompare(a.item.trip.startTime));

  const [next, ...restUpcoming] = upcoming;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <Text style={s.appBarTitle}>TICKETS</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.addLink}>+ ADD</Text>
        </TouchableOpacity>
      </View>

      <View style={s.segmented}>
        <TouchableOpacity style={[s.segment, tab === "upcoming" && s.segmentActive]} onPress={() => setTab("upcoming")}>
          <Text style={[s.segmentText, tab === "upcoming" && s.segmentTextActive]}>UPCOMING · {upcoming.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.segment, tab === "past" && s.segmentActive]} onPress={() => setTab("past")}>
          <Text style={[s.segmentText, tab === "past" && s.segmentTextActive]}>PAST · {past.length}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={color.hull} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.hull} />}
        >
          {tab === "upcoming" ? (
            upcoming.length === 0 ? (
              <EmptyState onAdd={() => setShowAdd(true)} />
            ) : (
              <>
                {next && <NextTripCard key={next.item.id} g={next} onPress={() => router.push({ pathname: "/boarding/[ticketId]", params: { ticketId: next.item.tickets[0]?.id ?? "" } })} />}
                {restUpcoming.map((g) => (
                  <UpcomingCard key={g.item.id} g={g} onPress={() => router.push({ pathname: "/boarding/[ticketId]", params: { ticketId: g.item.tickets[0]?.id ?? "" } })} />
                ))}
              </>
            )
          ) : past.length === 0 ? (
            <Text style={s.emptyText}>No past trips yet.</Text>
          ) : (
            past.map((g) => <PastRow key={g.item.id} g={g} />)
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <AddBookingSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(booking) => {
          setBookings((prev) => {
            const idx = prev.findIndex((b) => b.id === booking.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = booking;
              return next;
            }
            return [...prev, booking];
          });
        }}
      />
    </SafeAreaView>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={e.wrap}>
      <Text style={e.title}>NO TICKETS YET</Text>
      <Text style={e.body}>After booking, add your confirmation to save boarding passes here. They work offline at the dock.</Text>
      <TouchableOpacity style={e.btn} onPress={onAdd} activeOpacity={0.85}>
        <Text style={e.btnText}>ADD A BOOKING</Text>
      </TouchableOpacity>
    </View>
  );
}

function NextTripCard({ g, onPress }: { g: Grouped; onPress: () => void }) {
  const { trip } = g.item;
  const ticket = g.item.tickets[0];
  return (
    <TouchableOpacity style={n.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={n.countdown}>{fmtCountdown(trip.startTime)}</Text>
      <Text style={n.name}>{trip.product.displayName}</Text>
      <View style={n.metaRow}>
        <Text style={n.meta}>{g.booking.confirmationCode} · {trip.vessel.name}</Text>
      </View>
      <View style={n.bottomRow}>
        {ticket && <QRCode value={ticket.qrPayload} size={34} color={color.hull} backgroundColor={color.white} />}
        <Text style={n.showLink}>SHOW BOARDING PASS →</Text>
      </View>
    </TouchableOpacity>
  );
}

function UpcomingCard({ g, onPress }: { g: Grouped; onPress: () => void }) {
  const { trip } = g.item;
  return (
    <TouchableOpacity style={u.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[u.bar, { backgroundColor: tripTypeColor(trip.product.category, trip.vessel.color) }]} />
      <View style={u.body}>
        <Text style={u.date}>{fmtDate(trip.departureDate)} · {fmtTime(trip.startTime)}</Text>
        <Text style={u.name}>{trip.product.displayName}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PastRow({ g }: { g: Grouped }) {
  const { trip } = g.item;
  const cancelled = trip.status === "cancelled";
  return (
    <View style={p.row}>
      <View style={{ flex: 1 }}>
        <Text style={[p.name, cancelled && p.nameStruck]}>{trip.product.displayName}</Text>
        <Text style={p.date}>{fmtDate(trip.departureDate)}</Text>
      </View>
      <TouchableOpacity>
        <Text style={p.bookAgain}>BOOK AGAIN</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.hull,
    paddingHorizontal: space.gutter,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  appBarTitle: { fontFamily: font.monoSemibold, fontSize: 13, letterSpacing: ls(13, tracking.kicker), color: color.white },
  addLink: { fontFamily: font.monoSemibold, fontSize: 12, letterSpacing: ls(12, tracking.data), color: color.orangeLight },
  segmented: { flexDirection: "row", padding: space.gutter, gap: 1, backgroundColor: color.rule },
  segment: { flex: 1, backgroundColor: color.white, paddingVertical: 10, alignItems: "center" },
  segmentActive: { backgroundColor: color.hull },
  segmentText: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.data), color: color.hull },
  segmentTextActive: { color: color.white },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: space.gutter, gap: 10 },
  emptyText: { fontFamily: font.sans, fontSize: 15, color: color.ink3, textAlign: "center", paddingTop: 40 },
});

const e = StyleSheet.create({
  wrap: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 16 },
  title: { fontFamily: font.sansBold, fontSize: 18, color: color.hull },
  body: { fontFamily: font.sans, fontSize: 14, color: color.ink2, textAlign: "center", lineHeight: 20 },
  btn: { marginTop: 8, backgroundColor: color.orange, paddingHorizontal: 24, paddingVertical: 14 },
  btnText: { fontFamily: font.sansBold, fontSize: 13, letterSpacing: ls(13, tracking.data), color: color.white },
});

const n = StyleSheet.create({
  card: { backgroundColor: color.hull, padding: space.lg, gap: 6 },
  countdown: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.kickerWide), color: color.orangeLight },
  name: { fontFamily: font.sansBold, fontSize: 20, color: color.white },
  metaRow: {},
  meta: { fontFamily: font.mono, fontSize: 12, color: color.inkOnDark3 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.hullLine },
  showLink: { fontFamily: font.monoSemibold, fontSize: 12, letterSpacing: ls(12, tracking.data), color: color.white },
});

const u = StyleSheet.create({
  card: { flexDirection: "row", backgroundColor: color.white, borderWidth: 1, borderColor: color.rule },
  bar: { width: 8 },
  body: { flex: 1, padding: 14, gap: 2 },
  date: { fontFamily: font.mono, fontSize: 12, color: color.ink3 },
  name: { fontFamily: font.sansSemibold, fontSize: 15, color: color.hull },
});

const p = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.ruleSoft },
  name: { fontFamily: font.sansSemibold, fontSize: 14, color: color.hull },
  nameStruck: { textDecorationLine: "line-through", color: color.ink3 },
  date: { fontFamily: font.mono, fontSize: 11, color: color.ink3, marginTop: 2 },
  bookAgain: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.data), color: color.orangeInk },
});

const add = StyleSheet.create({
  body: { paddingHorizontal: space.gutter, gap: 8 },
  title: { fontFamily: font.sansBold, fontSize: 18, color: color.hull },
  subtitle: { fontFamily: font.sans, fontSize: 13, color: color.ink2, marginBottom: 8, lineHeight: 18 },
  label: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.label), color: color.ink3, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: color.disabledBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.sans,
    fontSize: 16,
    color: color.hull,
    marginTop: 6,
  },
  error: { fontFamily: font.sansSemibold, fontSize: 13, color: color.orangeInk, marginTop: 10 },
  btn: { marginTop: 16, backgroundColor: color.orange, paddingVertical: 16, alignItems: "center" },
  btnLoading: { opacity: 0.8 },
  btnText: { fontFamily: font.sansBold, fontSize: 14, letterSpacing: ls(14, tracking.data), color: color.white },
});
