import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { dollars, lineFares, seatsInLine, totalSeats as countSeats } from "@openboat/utils";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { useAppCart } from "@/lib/cart-store";
import { shownQuote, useQuote } from "@/lib/quote";
import { fmtDuration, fmtTimeRange, tripTypeColor, tripTypeLabel } from "@/lib/trip-helpers";

export default function CartScreen() {
  const router = useRouter();
  // The same cart the Trips tab edits, every month included (P8-4).
  const { lines, updatedOnRestore } = useAppCart();
  const quote = useQuote(lines);
  const { quote: shown, updating } = shownQuote(quote);
  const totalSeats = countSeats(lines);
  const quoteLine = (tripId: string) => shown?.lines.find((l) => l.tripId === tripId);
  const fareTotal = (tripId: string, ticketType: string) => {
    const fare = quoteLine(tripId)?.fares.find((f) => f.ticketType === ticketType);
    return fare ? dollars(fare.listCents) : "…";
  };
  const discountCents = shown?.discountCents ?? 0;
  const total = shown ? dollars(shown.totalCents) : quote.status === "error" ? "—" : "…";

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
        {updatedOnRestore && lines.length > 0 && (
          <Text style={s.notice}>Your cart was updated to current prices and seats.</Text>
        )}
        {lines.length === 0 ? (
          <Text style={s.emptyText}>No seats selected.</Text>
        ) : (
          lines.map((line) => {
            const { trip } = line;
            const fares = lineFares(line);
            return (
            <View key={trip.id} style={s.tripCard}>
              <View style={[s.tripBar, { backgroundColor: tripTypeColor(trip.product.category) }]} />
              <View style={s.tripBody}>
                <Text style={s.tripKicker}>{tripTypeLabel(trip.product.category)}</Text>
                <Text style={s.tripName}>{trip.product.displayName}</Text>
                <Text style={s.tripMeta}>
                  {trip.departureDate} · {fmtTimeRange(trip.startTime, trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)}
                </Text>
                {fares.map((f) => (
                  <View key={f.ticketType} style={s.ticketRow}>
                    <Text style={s.ticketLabel}>
                      {f.quantity} × {f.ticketType.charAt(0).toUpperCase() + f.ticketType.slice(1)}
                    </Text>
                    <Text style={[s.ticketPrice, updating && s.updating]}>{fareTotal(trip.id, f.ticketType)}</Text>
                  </View>
                ))}
                <View style={s.tripFooterRow}>
                  <Text style={[s.subtotal, updating && s.updating]}>
                    {seatsInLine(line)} SEAT{seatsInLine(line) === 1 ? "" : "S"} ·{" "}
                    {quoteLine(trip.id) ? dollars(quoteLine(trip.id)!.listCents) : "…"}
                  </Text>
                  <TouchableOpacity onPress={() => router.push("/(tabs)/trips")}>
                    <Text style={s.editLink}>EDIT SEATS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            );
          })
        )}

        <TouchableOpacity style={s.addTripBtn} onPress={() => router.push("/(tabs)/trips")}>
          <Text style={s.addTripText}>+ ADD ANOTHER TRIP</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        {discountCents > 0 && (
          <View style={s.discountRow}>
            <Text style={s.discountText}>GROUP DISCOUNT</Text>
            <Text style={[s.discountText, updating && s.updating]}>−{dollars(discountCents)}</Text>
          </View>
        )}
        <View style={s.totalBar}>
          <View>
            <Text style={s.totalLabel}>TOTAL DUE TODAY · {totalSeats} SEAT{totalSeats === 1 ? "" : "S"}</Text>
          </View>
          <Text style={[s.totalValue, updating && s.updating]}>{total}</Text>
        </View>
        {quote.status === "error" && <Text style={s.quoteError}>{quote.message}</Text>}
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
  notice: { fontFamily: font.sans, fontSize: 13, color: color.ink2, marginBottom: space.sm },
  updating: { opacity: 0.5 },
  discountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter,
    paddingVertical: 8,
    backgroundColor: color.white,
  },
  discountText: { fontFamily: font.monoSemibold, fontSize: 12, letterSpacing: ls(12, tracking.label), color: color.greenOpen },
  quoteError: { fontFamily: font.sansSemibold, fontSize: 13, color: color.orangeInk, paddingHorizontal: space.gutter, paddingTop: 6 },
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
