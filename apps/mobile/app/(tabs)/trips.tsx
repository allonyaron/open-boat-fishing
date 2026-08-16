import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { MMKV } from "react-native-mmkv";
import { Colors } from "@/constants/Colors";

const storage = new MMKV();

// ─── Types ───────────────────────────────────────────────────────────────────

type Price = {
  id: string;
  ticketType: string; // "adult" | "child" | "senior"
  priceCents: number;
};

type Trip = {
  id: string;
  departureDate: string; // "YYYY-MM-DD"
  startTime: string; // ISO timestamptz
  endTime: string; // ISO timestamptz
  capacity: number;
  seatsRemaining: number;
  vessel: { id: string; name: string; color: string };
  product: { id: string; category: string; displayName: string; prices: Price[] };
};

type CartKey = string; // "tripId:ticketType"

// ─── API URL ─────────────────────────────────────────────────────────────────
// In dev, auto-detect the Metro host so physical devices resolve the same machine.
// Set EXPO_PUBLIC_API_URL in .env.local to override (required for production EAS builds).

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error("EXPO_PUBLIC_API_URL must be set for production builds");
}

const API_URL = getApiUrl();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ─── MonthCalendar ────────────────────────────────────────────────────────────

function MonthCalendar({
  year,
  month,
  trips,
  selectedDay,
  onSelectDay,
}: {
  year: number;
  month: number; // 0-indexed
  trips: Trip[];
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
}) {
  const firstDow = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];

  // day number → unique vessel colors for that day
  const dotsByDay = new Map<number, string[]>();
  for (const trip of trips) {
    const parts = trip.departureDate.split("-");
    const d = parseInt(parts[2], 10);
    if (!dotsByDay.has(d)) dotsByDay.set(d, []);
    const existing = dotsByDay.get(d)!;
    if (!existing.includes(trip.vessel.color)) existing.push(trip.vessel.color);
  }

  const blanks = Array(firstDow).fill(null);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const cells = [...blanks, ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={cal.grid}>
      {/* Column headers */}
      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
        <View key={`h${i}`} style={cal.cell}>
          <Text style={cal.header}>{d}</Text>
        </View>
      ))}
      {/* Day cells */}
      {cells.map((day, i) => {
        if (!day) return <View key={`b${i}`} style={cal.cell} />;
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const colors = dotsByDay.get(day) ?? [];
        const isSelected = selectedDay === dateStr;
        const isToday = dateStr === todayStr;

        return (
          <TouchableOpacity
            key={dateStr}
            style={cal.cell}
            onPress={() => onSelectDay(dateStr)}
            activeOpacity={0.7}
          >
            <View
              style={[
                cal.dayCircle,
                isSelected && cal.dayCircleSelected,
                isToday && !isSelected && cal.dayCircleToday,
              ]}
            >
              <Text style={[cal.dayNum, isSelected && cal.dayNumSelected]}>{day}</Text>
            </View>
            <View style={cal.dots}>
              {colors.slice(0, 4).map((c, di) => (
                <View key={di} style={[cal.dot, { backgroundColor: c }]} />
              ))}
              {colors.length > 4 && <Text style={cal.dotPlus}>+{colors.length - 4}</Text>}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── TicketSheet ─────────────────────────────────────────────────────────────

function TicketSheet({
  trip,
  cart,
  onAdjust,
  onClose,
}: {
  trip: Trip;
  cart: Record<CartKey, number>;
  onAdjust: (tripId: string, ticketType: string, delta: number) => void;
  onClose: () => void;
}) {
  const translateY = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 500,
      duration: 220,
      useNativeDriver: true,
    }).start(onClose);
  }, [onClose]);

  const tripQty = trip.product.prices.reduce(
    (sum, p) => sum + (cart[`${trip.id}:${p.ticketType}`] ?? 0),
    0,
  );
  const tripTotalCents = trip.product.prices.reduce((sum, p) => {
    const qty = cart[`${trip.id}:${p.ticketType}`] ?? 0;
    return sum + qty * p.priceCents;
  }, 0);
  const isSoldOut = trip.seatsRemaining === 0;

  return (
    <Modal transparent animationType="none" onRequestClose={dismiss}>
      <Pressable style={sh.backdrop} onPress={dismiss} />
      <Animated.View style={[sh.sheet, { transform: [{ translateY }] }]}>
        <View style={sh.handle} />

        {/* Vessel color accent */}
        <View style={[sh.vesselAccent, { backgroundColor: trip.vessel.color }]} />

        <View style={sh.info}>
          <View style={sh.infoRow}>
            <Text style={sh.vesselName}>{trip.vessel.name}</Text>
            {isSoldOut ? (
              <View style={sh.soldOutBadge}>
                <Text style={sh.soldOutText}>SOLD OUT</Text>
              </View>
            ) : (
              <Text style={sh.seatsLeft}>{trip.seatsRemaining} left</Text>
            )}
          </View>
          <Text style={sh.productName}>{trip.product.displayName}</Text>
          <Text style={sh.timeRange}>
            {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)}
          </Text>
        </View>

        <View style={sh.divider} />

        <ScrollView bounces={false}>
          {trip.product.prices.map((price) => {
            const key = `${trip.id}:${price.ticketType}`;
            const qty = cart[key] ?? 0;
            return (
              <View key={price.id} style={sh.priceRow}>
                <View>
                  <Text style={sh.ticketType}>{ticketLabel(price.ticketType)}</Text>
                  <Text style={sh.ticketPrice}>{fmtCents(price.priceCents)}</Text>
                </View>
                <View style={sh.stepper}>
                  <TouchableOpacity
                    style={[sh.stepBtn, qty === 0 && sh.stepBtnDisabled]}
                    onPress={() => onAdjust(trip.id, price.ticketType, -1)}
                    disabled={qty === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[sh.stepBtnText, qty === 0 && sh.stepBtnTextDisabled]}>−</Text>
                  </TouchableOpacity>
                  <Text style={sh.stepQty}>{qty}</Text>
                  <TouchableOpacity
                    style={[sh.stepBtn, isSoldOut && sh.stepBtnDisabled]}
                    onPress={() => onAdjust(trip.id, price.ticketType, 1)}
                    disabled={isSoldOut}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[sh.stepBtnText, isSoldOut && sh.stepBtnTextDisabled]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {tripQty > 0 && (
            <View style={sh.cartSummary}>
              <Text style={sh.cartSummaryText}>
                IN CART: {tripQty}
                {"  "}TOTAL: {fmtCents(tripTotalCents)}
              </Text>
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ─── CartBar ─────────────────────────────────────────────────────────────────

function CartBar({
  cart,
  trips,
  onReserve,
}: {
  cart: Record<CartKey, number>;
  trips: Trip[];
  onReserve: () => void;
}) {
  // Build price lookup across all loaded trips
  const priceMap: Record<CartKey, number> = {};
  for (const trip of trips) {
    for (const p of trip.product.prices) {
      priceMap[`${trip.id}:${p.ticketType}`] = p.priceCents;
    }
  }

  let totalQty = 0;
  let totalCents = 0;
  for (const [key, qty] of Object.entries(cart)) {
    if (qty > 0 && priceMap[key] != null) {
      totalQty += qty;
      totalCents += qty * priceMap[key];
    }
  }

  if (totalQty === 0) return null;

  return (
    <View style={cb.bar}>
      <View style={cb.info}>
        <Text style={cb.qty}>
          {totalQty} ticket{totalQty !== 1 ? "s" : ""}
        </Text>
        <Text style={cb.total}>{fmtCents(totalCents)}</Text>
      </View>
      <TouchableOpacity style={cb.btn} onPress={onReserve} activeOpacity={0.85}>
        <Text style={cb.btnText}>Reserve →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── TripsScreen ─────────────────────────────────────────────────────────────

export default function TripsScreen() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string | null>(now.toISOString().split("T")[0]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [cart, setCart] = useState<Record<CartKey, number>>({});

  // Clear cart after a successful checkout
  useFocusEffect(
    useCallback(() => {
      if (storage.getBoolean("cart_paid")) {
        setCart({});
        storage.delete("cart_paid");
      }
    }, []),
  );

  useEffect(() => {
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
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
  }, [year, month]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  const handleReserve = useCallback(() => {
    const tripIdsInCart = new Set(Object.keys(cart).map((k) => k.split(":")[0]));
    const cartTrips = trips.filter((t) => tripIdsInCart.has(t.id));
    storage.set("pending_checkout", JSON.stringify({ cart, cartTrips }));
    router.push("/checkout");
  }, [cart, trips, router]);

  const handleAdjust = useCallback((tripId: string, ticketType: string, delta: number) => {
    const key: CartKey = `${tripId}:${ticketType}`;
    setCart((prev) => {
      const next = Math.max(0, (prev[key] ?? 0) + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const dayTrips = selectedDay ? trips.filter((t) => t.departureDate === selectedDay) : [];

  const selectedDayLabel = selectedDay
    ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <SafeAreaView style={s.safe}>
      {/* Month nav header */}
      <View style={s.monthNav}>
        <TouchableOpacity
          onPress={prevMonth}
          style={s.navBtn}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={s.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.monthTitle}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <TouchableOpacity
          onPress={nextMonth}
          style={s.navBtn}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={s.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Month grid */}
      <MonthCalendar
        year={year}
        month={month}
        trips={trips}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />

      <View style={s.divider} />

      {/* Day header */}
      {selectedDayLabel && <Text style={s.dayLabel}>{selectedDayLabel}</Text>}

      {/* Trip list */}
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={Colors.teal} size="large" />
        </View>
      ) : error ? (
        <View style={s.centered}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {dayTrips.length === 0 ? (
            <Text style={s.emptyText}>
              {selectedDay ? "No trips scheduled this day." : "Select a day to see trips."}
            </Text>
          ) : (
            dayTrips.map((trip) => {
              const cartQty = trip.product.prices.reduce(
                (sum, p) => sum + (cart[`${trip.id}:${p.ticketType}`] ?? 0),
                0,
              );
              const isSoldOut = trip.seatsRemaining === 0;
              const isLow = !isSoldOut && trip.seatsRemaining <= 5;

              return (
                <TouchableOpacity
                  key={trip.id}
                  style={[s.card, isSoldOut && s.cardSoldOut]}
                  onPress={() => {
                    if (!isSoldOut) setSelectedTrip(trip);
                  }}
                  activeOpacity={isSoldOut ? 1 : 0.78}
                >
                  <View style={[s.colorBar, { backgroundColor: trip.vessel.color }]} />
                  <View style={s.cardBody}>
                    <View style={s.cardTopRow}>
                      <Text style={s.vesselName}>{trip.vessel.name}</Text>
                      {cartQty > 0 && (
                        <View style={s.inCartBadge}>
                          <Text style={s.inCartText}>{cartQty} in cart</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.productName}>{trip.product.displayName}</Text>
                    <Text style={s.timeRange}>
                      {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)}
                    </Text>
                    <View style={s.cardBottomRow}>
                      <View style={s.priceChips}>
                        {trip.product.prices.map((p) => (
                          <Text key={p.id} style={s.priceChip}>
                            {ticketLabel(p.ticketType)} {fmtCents(p.priceCents)}
                          </Text>
                        ))}
                      </View>
                      <Text
                        style={[
                          s.seatsBadge,
                          isSoldOut && s.seatsBadgeSoldOut,
                          isLow && s.seatsBadgeLow,
                        ]}
                      >
                        {isSoldOut
                          ? "SOLD OUT"
                          : isLow
                            ? `${trip.seatsRemaining} left`
                            : `${trip.seatsRemaining} left`}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Bottom sheet */}
      {selectedTrip && (
        <TicketSheet
          trip={selectedTrip}
          cart={cart}
          onAdjust={handleAdjust}
          onClose={() => setSelectedTrip(null)}
        />
      )}

      {/* Cart bar */}
      <CartBar cart={cart} trips={trips} onReserve={handleReserve} />
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navBtn: {
    padding: 4,
  },
  navArrow: {
    fontSize: 28,
    color: Colors.teal,
    lineHeight: 32,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.ink,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.inkMuted,
    paddingHorizontal: 16,
    paddingBottom: 8,
    letterSpacing: 0.2,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    color: Colors.error,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  emptyText: {
    color: Colors.inkSubtle,
    textAlign: "center",
    marginTop: 32,
    fontSize: 15,
  },
  card: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardSoldOut: {
    opacity: 0.55,
  },
  colorBar: {
    width: 5,
  },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 3,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  vesselName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.ink,
  },
  inCartBadge: {
    backgroundColor: Colors.teal,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  inCartText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  productName: {
    fontSize: 13,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  timeRange: {
    fontSize: 13,
    color: Colors.inkSubtle,
    marginTop: 1,
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  priceChips: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
  },
  priceChip: {
    fontSize: 12,
    color: Colors.inkMuted,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  seatsBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.success,
  },
  seatsBadgeLow: {
    color: Colors.warning,
  },
  seatsBadgeSoldOut: {
    color: Colors.error,
  },
});

const cal = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  cell: {
    width: `${100 / 7}%` as unknown as number,
    alignItems: "center",
    paddingVertical: 3,
  },
  header: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.inkSubtle,
    letterSpacing: 0.5,
    paddingBottom: 4,
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: {
    backgroundColor: Colors.teal,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: Colors.teal,
  },
  dayNum: {
    fontSize: 14,
    color: Colors.ink,
    fontWeight: "500",
  },
  dayNumSelected: {
    color: "#fff",
    fontWeight: "700",
  },
  dots: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
    height: 6,
    alignItems: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  dotPlus: {
    fontSize: 8,
    color: Colors.inkSubtle,
  },
});

const sh = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: 32,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
  },
  vesselAccent: {
    height: 4,
    borderRadius: 2,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  info: {
    paddingHorizontal: 20,
    gap: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  vesselName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.ink,
  },
  seatsLeft: {
    fontSize: 13,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  soldOutBadge: {
    backgroundColor: Colors.error,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  soldOutText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  productName: {
    fontSize: 14,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  timeRange: {
    fontSize: 13,
    color: Colors.inkSubtle,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
    marginVertical: 14,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ticketType: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.ink,
  },
  ticketPrice: {
    fontSize: 14,
    color: Colors.inkMuted,
    marginTop: 2,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  stepBtnText: {
    fontSize: 20,
    color: Colors.ink,
    lineHeight: 24,
    fontWeight: "500",
  },
  stepBtnTextDisabled: {
    color: Colors.inkSubtle,
  },
  stepQty: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.ink,
    width: 28,
    textAlign: "center",
  },
  cartSummary: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cartSummaryText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.teal,
    textAlign: "center",
    letterSpacing: 0.5,
  },
});

const cb = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  info: {
    gap: 2,
  },
  qty: {
    fontSize: 13,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  total: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.ink,
  },
  btn: {
    backgroundColor: Colors.teal,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
