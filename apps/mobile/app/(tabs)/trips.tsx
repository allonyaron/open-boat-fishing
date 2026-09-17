import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MMKV } from "react-native-mmkv";
import { API_URL } from "@/lib/api";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { DayBelt, weekDatesFor } from "@/components/DayBelt";
import { DateSheet } from "@/components/DateSheet";
import { TripSheet } from "@/components/TripSheet";
import { SeatPill } from "@/components/SeatPill";
import {
  type Cart,
  type Trip,
  cartKey,
  cartQtyForTrip,
  dollars,
  fmtDuration,
  fmtTimeRange,
  tripTypeColor,
  tripTypeLabel,
} from "@/lib/trip-helpers";

const storage = new MMKV();
const OPERATOR_NAME = process.env.EXPO_PUBLIC_OPERATOR_NAME ?? "CAPTREE FISHING";

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function fmtDayHead(dateStr: string, today: string): string {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  return dateStr === today ? `${dow} ${mon} ${day} · TODAY` : `${dow} ${mon} ${day}`;
}

export default function TripsScreen() {
  const router = useRouter();
  const today = todayStr();
  const now = new Date();

  const [monthYear, setMonthYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth()); // 0-indexed
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(today);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [cart, setCart] = useState<Cart>({});

  useFocusEffect(
    useCallback(() => {
      if (storage.getBoolean("cart_paid")) {
        setCart({});
        storage.delete("cart_paid");
      }
    }, []),
  );

  useEffect(() => {
    const monthStr = `${monthYear}-${String(monthIdx + 1).padStart(2, "0")}`;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/trips?month=${monthStr}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTrips(data as Trip[]);
        else setError((data as { error?: string }).error ?? "Failed to load trips");
      })
      .catch(() => setError("Could not connect to server.\nMake sure the web app is running."))
      .finally(() => setLoading(false));
  }, [monthYear, monthIdx]);

  const tripCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of trips) map[t.departureDate] = (map[t.departureDate] ?? 0) + 1;
    return map;
  }, [trips]);

  const weekDates = useMemo(() => weekDatesFor(selectedDate), [selectedDate]);
  const dayTrips = useMemo(
    () => trips.filter((t) => t.departureDate === selectedDate),
    [trips, selectedDate],
  );

  function shiftMonth(delta: 1 | -1) {
    let y = monthYear;
    let m = monthIdx + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonthYear(y);
    setMonthIdx(m);
  }

  function selectDateAcrossMonths(dateStr: string) {
    const [y, m] = dateStr.split("-").map(Number);
    if (y !== monthYear || m - 1 !== monthIdx) {
      setMonthYear(y);
      setMonthIdx(m - 1);
    }
    setSelectedDate(dateStr);
  }

  function handleSwipeWeek(direction: 1 | -1) {
    const base = new Date(selectedDate + "T12:00:00Z");
    base.setUTCDate(base.getUTCDate() + direction * 7);
    selectDateAcrossMonths(base.toISOString().slice(0, 10));
  }

  const handleAdjust = useCallback((tripId: string, ticketType: string, delta: number) => {
    setCart((prev) => {
      const key = cartKey(tripId, ticketType);
      const next = Math.max(0, (prev[key] ?? 0) + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const cartTripIds = useMemo(
    () => new Set(Object.keys(cart).filter((k) => cart[k] > 0).map((k) => k.split(":")[0])),
    [cart],
  );

  const handleHold = useCallback(() => {
    const cartTrips = trips.filter((t) => cartTripIds.has(t.id));
    storage.set("pending_checkout", JSON.stringify({ cart, cartTrips }));
    setActiveTrip(null);
    if (cartTripIds.size > 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push("/cart" as any);
    } else {
      router.push("/checkout");
    }
  }, [cart, trips, cartTripIds, router]);

  const cartTotalQty = Object.values(cart).reduce((s, q) => s + q, 0);
  const cartTotalCents = trips.reduce((sum, t) => {
    return (
      sum +
      t.product.prices.reduce((s, p) => s + (cart[cartKey(t.id, p.ticketType)] ?? 0) * p.priceCents, 0)
    );
  }, 0);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <Text style={s.appBarTitle}>{OPERATOR_NAME.toUpperCase()}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <View style={s.titleBlock}>
          <View>
            <Text style={s.kicker}>{selectedDate === today ? "TODAY" : ""}</Text>
            <Text style={s.title}>SAILING {selectedDate === today ? "TODAY" : "THIS DAY"}</Text>
          </View>
          <TouchableOpacity style={s.datesBtn} onPress={() => setDateSheetOpen(true)}>
            <Text style={s.datesBtnText}>DATES ›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.beltWrap}>
          <DayBelt
            weekDates={weekDates}
            tripCountByDate={tripCountByDate}
            selectedDate={selectedDate}
            todayStr={today}
            onSelectDate={setSelectedDate}
            onSwipeWeek={handleSwipeWeek}
          />
        </View>

        <View style={s.dayHeadRow}>
          <Text style={s.dayHeadLabel}>{fmtDayHead(selectedDate, today)}</Text>
          <Text style={s.dayHeadCount}>
            {dayTrips.length} {dayTrips.length === 1 ? "SAILING" : "SAILINGS"}
          </Text>
        </View>

        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={color.hull} size="large" />
          </View>
        ) : error ? (
          <View style={s.centered}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : dayTrips.length === 0 ? (
          <Text style={s.emptyText}>No sailings on that day.</Text>
        ) : (
          <View style={s.cardList}>
            {dayTrips.map((trip) => {
              const soldOut = trip.seatsRemaining === 0;
              const qty = cartQtyForTrip(cart, trip);
              return (
                <TouchableOpacity
                  key={trip.id}
                  style={[s.card, soldOut && s.cardSoldOut]}
                  disabled={soldOut}
                  activeOpacity={0.85}
                  onPress={() => setActiveTrip(trip)}
                >
                  <View
                    style={[
                      s.cardBar,
                      { backgroundColor: soldOut ? color.disabledBorder : tripTypeColor(trip.product.category) },
                    ]}
                  />
                  <View style={s.cardBody}>
                    <View style={s.cardTopRow}>
                      <Text style={[s.cardTime, soldOut && s.mutedText]}>
                        {fmtTimeRange(trip.startTime, trip.endTime).split(" – ")[0]}
                      </Text>
                      <Text style={[s.cardFare, soldOut && s.mutedText]}>
                        {trip.product.prices[0] ? dollars(trip.product.prices[0].priceCents) : "—"}
                      </Text>
                    </View>
                    <Text style={[s.cardName, soldOut && s.mutedText]}>{trip.product.displayName}</Text>
                    <View style={s.cardMetaRow}>
                      <Text style={s.cardMeta}>
                        {tripTypeLabel(trip.product.category)} · {fmtDuration(trip.startTime, trip.endTime)}
                      </Text>
                      {!soldOut && <SeatPill seatsRemaining={trip.seatsRemaining} />}
                      {soldOut && <Text style={s.soldOutLabel}>SOLD OUT</Text>}
                      {qty > 0 && <Text style={s.inCartLabel}>{qty} IN CART</Text>}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {cartTotalQty > 0 && !activeTrip && (
        <TouchableOpacity
          style={s.resumeBar}
          activeOpacity={0.9}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPress={() => router.push("/cart" as any)}
        >
          <Text style={s.resumeText}>
            {cartTotalQty} SEAT{cartTotalQty === 1 ? "" : "S"} · {dollars(cartTotalCents)}
          </Text>
          <Text style={s.resumeCta}>REVIEW →</Text>
        </TouchableOpacity>
      )}

      <DateSheet
        visible={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        year={monthYear}
        month={monthIdx}
        tripCountByDate={tripCountByDate}
        todayStr={today}
        onPrevMonth={() => shiftMonth(-1)}
        onNextMonth={() => shiftMonth(1)}
        onCommit={(date) => {
          selectDateAcrossMonths(date);
          setDateSheetOpen(false);
        }}
      />

      <TripSheet
        trip={activeTrip}
        visible={!!activeTrip}
        cart={cart}
        onAdjust={handleAdjust}
        onClose={() => setActiveTrip(null)}
        onHold={handleHold}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 54,
    backgroundColor: color.hull,
    justifyContent: "center",
    paddingHorizontal: space.gutter,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  appBarTitle: {
    fontFamily: font.sansBold,
    fontSize: 15,
    letterSpacing: ls(15, 0.05),
    color: color.white,
  },
  scroll: { paddingBottom: 24 },
  titleBlock: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter,
    paddingTop: 18,
    paddingBottom: 12,
  },
  kicker: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.orangeInk,
  },
  title: {
    fontFamily: font.sansBold,
    fontSize: 28,
    letterSpacing: -0.5,
    color: color.hull,
    marginTop: 2,
  },
  datesBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color.hull,
  },
  datesBtnText: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.hull,
  },
  beltWrap: { paddingHorizontal: space.gutter, paddingBottom: 8 },
  dayHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.gutter,
    paddingTop: 12,
    paddingBottom: 8,
  },
  dayHeadLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kickerWide),
    color: color.ink2,
  },
  dayHeadCount: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.ink3,
  },
  centered: { paddingVertical: 40, alignItems: "center" },
  errorText: { color: color.orangePress, textAlign: "center", fontFamily: font.sans },
  emptyText: {
    fontFamily: font.sans,
    fontSize: 15,
    color: color.ink3,
    paddingHorizontal: space.gutter,
    paddingVertical: 24,
  },
  cardList: { paddingHorizontal: space.gutter, gap: 10 },
  card: {
    flexDirection: "row",
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.rule,
  },
  cardSoldOut: { backgroundColor: color.emptyFill },
  cardBar: { width: 6 },
  cardBody: { flex: 1, padding: 14, gap: 6 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTime: { fontFamily: font.monoSemibold, fontSize: 15, color: color.hull },
  cardFare: { fontFamily: font.sansBold, fontSize: 20, color: color.hull },
  cardName: { fontFamily: font.sansSemibold, fontSize: 16, color: color.hull },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  cardMeta: { fontFamily: font.mono, fontSize: 11, color: color.ink3 },
  mutedText: { color: color.disabledBorder },
  soldOutLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.data),
    color: color.ink3,
  },
  inCartLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.data),
    color: color.orange,
  },
  resumeBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: color.hull,
    paddingHorizontal: space.gutter,
    paddingVertical: 14,
  },
  resumeText: { fontFamily: font.monoBold, fontSize: 14, color: color.white },
  resumeCta: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.orangeLight,
  },
});
