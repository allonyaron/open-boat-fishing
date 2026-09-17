import React, { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { MMKV } from "react-native-mmkv";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import {
  type Cart,
  type Trip,
  cartKey,
  dollars,
  fmtDuration,
  fmtTimeRange,
  tripTypeColor,
  tripTypeLabel,
} from "@/lib/trip-helpers";

const storage = new MMKV();

type Pending = { cart: Cart; cartTrips: Trip[] };

export default function CartScreen() {
  const router = useRouter();
  const [pending] = useState<Pending>(() => {
    const raw = storage.getString("pending_checkout");
    if (!raw) return { cart: {}, cartTrips: [] };
    try {
      return JSON.parse(raw) as Pending;
    } catch {
      return { cart: {}, cartTrips: [] };
    }
  });

  const lines = useMemo(() => {
    return pending.cartTrips
      .map((trip) => {
        const tickets = trip.product.prices
          .map((p) => ({ price: p, qty: pending.cart[cartKey(trip.id, p.ticketType)] ?? 0 }))
          .filter((t) => t.qty > 0);
        const seatCount = tickets.reduce((s, t) => s + t.qty, 0);
        const subtotal = tickets.reduce((s, t) => s + t.qty * t.price.priceCents, 0);
        return { trip, tickets, seatCount, subtotal };
      })
      .filter((l) => l.seatCount > 0);
  }, [pending]);

  const totalSeats = lines.reduce((s, l) => s + l.seatCount, 0);
  const totalCents = lines.reduce((s, l) => s + l.subtotal, 0);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.cancel}>CANCEL</Text>
        </TouchableOpacity>
        <Text style={s.appBarTitle}>YOUR SEATS</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {lines.length === 0 ? (
          <Text style={s.emptyText}>No seats selected.</Text>
        ) : (
          lines.map(({ trip, tickets, subtotal }) => (
            <View key={trip.id} style={s.tripCard}>
              <View style={[s.tripBar, { backgroundColor: tripTypeColor(trip.product.category) }]} />
              <View style={s.tripBody}>
                <Text style={s.tripKicker}>{tripTypeLabel(trip.product.category)}</Text>
                <Text style={s.tripName}>{trip.product.displayName}</Text>
                <Text style={s.tripMeta}>
                  {trip.departureDate} · {fmtTimeRange(trip.startTime, trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)}
                </Text>
                {tickets.map((t) => (
                  <View key={t.price.ticketType} style={s.ticketRow}>
                    <Text style={s.ticketLabel}>
                      {t.qty} × {t.price.ticketType}
                    </Text>
                    <Text style={s.ticketPrice}>{dollars(t.qty * t.price.priceCents)}</Text>
                  </View>
                ))}
                <View style={s.tripFooterRow}>
                  <Text style={s.subtotal}>Subtotal: {dollars(subtotal)}</Text>
                  <TouchableOpacity onPress={() => router.push("/(tabs)/trips")}>
                    <Text style={s.editLink}>EDIT SEATS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity style={s.addTripBtn} onPress={() => router.push("/(tabs)/trips")}>
          <Text style={s.addTripText}>+ ADD ANOTHER TRIP</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        <View style={s.totalBar}>
          <View>
            <Text style={s.totalLabel}>TOTAL DUE TODAY · {totalSeats} SEAT{totalSeats === 1 ? "" : "S"}</Text>
          </View>
          <Text style={s.totalValue}>{dollars(totalCents)}</Text>
        </View>
        <TouchableOpacity
          style={s.payBtn}
          activeOpacity={0.85}
          disabled={lines.length === 0}
          onPress={() => router.push("/checkout")}
        >
          <Text style={s.payBtnText}>CONTINUE TO PAYMENT</Text>
        </TouchableOpacity>
        <Text style={s.trustLine}>FREE CANCELLATION TO 24H · WEATHER REFUNDS AUTOMATIC</Text>
        <Text style={s.trustLine}>NO ACCOUNT NEEDED</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.hull,
    paddingHorizontal: space.gutter,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  cancel: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.label),
    color: color.inkOnDark3,
    width: 60,
  },
  appBarTitle: {
    fontFamily: font.monoSemibold,
    fontSize: 13,
    letterSpacing: ls(13, tracking.kicker),
    color: color.white,
  },
  scroll: { padding: space.gutter, gap: 12, paddingBottom: 24 },
  emptyText: { fontFamily: font.sans, fontSize: 15, color: color.ink3, textAlign: "center", paddingTop: 40 },
  tripCard: { flexDirection: "row", backgroundColor: color.white, borderWidth: 1, borderColor: color.rule },
  tripBar: { width: 6 },
  tripBody: { flex: 1, padding: space.md, gap: 4 },
  tripKicker: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.kicker),
    color: color.orangeInk,
  },
  tripName: { fontFamily: font.sansBold, fontSize: 17, color: color.hull },
  tripMeta: { fontFamily: font.mono, fontSize: 12, color: color.ink3, marginBottom: 4 },
  ticketRow: { flexDirection: "row", justifyContent: "space-between" },
  ticketLabel: { fontFamily: font.sans, fontSize: 14, color: color.hull },
  ticketPrice: { fontFamily: font.mono, fontSize: 13, color: color.ink2 },
  tripFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: color.ruleSoft,
  },
  subtotal: { fontFamily: font.monoSemibold, fontSize: 13, color: color.hull },
  editLink: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.data),
    color: color.orangeInk,
  },
  addTripBtn: {
    borderWidth: 1,
    borderColor: color.disabledBorder,
    paddingVertical: 16,
    alignItems: "center",
  },
  addTripText: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.ink2,
  },
  footer: {
    padding: space.gutter,
    borderTopWidth: 1,
    borderTopColor: color.rule,
    backgroundColor: color.white,
    gap: 10,
  },
  totalBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: color.hull,
    padding: space.md,
  },
  totalLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.inkOnDark3,
  },
  totalValue: { fontFamily: font.monoBold, fontSize: 28, color: color.white },
  payBtn: {
    minHeight: 58,
    backgroundColor: color.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  payBtnText: {
    fontFamily: font.sansBold,
    fontSize: 15,
    letterSpacing: ls(15, tracking.data),
    color: color.white,
  },
  trustLine: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
    textAlign: "center",
  },
});
