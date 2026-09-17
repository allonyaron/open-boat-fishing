import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { InlineStepper } from "@/components/InlineStepper";
import { SeatPill } from "@/components/SeatPill";
import { color, font, ls, tracking } from "@/constants/nativeTokens";
import {
  type Cart,
  type Trip,
  cartKey,
  cartQtyForTrip,
  cartTotalCentsForTrip,
  dollars,
  fmtDuration,
  fmtTimeRange,
  getDisplayPrices,
  tripTypeLabel,
} from "@/lib/trip-helpers";

export function TripSheet({
  trip,
  visible,
  cart,
  onAdjust,
  onClose,
  onHold,
}: {
  trip: Trip | null;
  visible: boolean;
  cart: Cart;
  onAdjust: (tripId: string, ticketType: string, delta: number) => void;
  onClose: () => void;
  onHold: () => void;
}) {
  if (!trip) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;

  const displayPrices = getDisplayPrices(trip.product.prices);
  const qty = cartQtyForTrip(cart, trip);
  const totalCents = cartTotalCentsForTrip(cart, trip);
  const hasSeats = qty > 0;

  return (
    <Sheet visible={visible} detent={0.62} onClose={onClose}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>
              {tripTypeLabel(trip.product.category)} · {trip.vessel.name.toUpperCase()}
            </Text>
            <Text style={s.name}>{trip.product.displayName}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={s.metaBlock}>
          <Text style={s.metaLine}>
            {fmtTimeRange(trip.startTime, trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)}
          </Text>
          <Text style={s.metaLineMuted}>{trip.vessel.name}</Text>
        </View>

        <View style={s.seatRow}>
          <View style={s.seatPillField}>
            <SeatPill seatsRemaining={trip.seatsRemaining} />
          </View>
          <Text style={s.reassurance}>NOTHING IS CHARGED YET</Text>
        </View>

        <View style={s.fareRows}>
          {displayPrices.map((price) => {
            const key = cartKey(trip.id, price.ticketType);
            const rowQty = cart[key] ?? 0;
            const otherQty = displayPrices
              .filter((p) => p.ticketType !== price.ticketType)
              .reduce((sum, p) => sum + (cart[cartKey(trip.id, p.ticketType)] ?? 0), 0);
            const atMax = rowQty >= trip.seatsRemaining - otherQty;
            const label = price.displayLabel.charAt(0).toUpperCase() + price.displayLabel.slice(1);
            return (
              <View key={price.ticketType} style={s.fareRow}>
                <View>
                  <Text style={s.fareLabel}>{label}</Text>
                  <Text style={s.farePrice}>{dollars(price.priceCents)}</Text>
                </View>
                <InlineStepper
                  value={rowQty}
                  onDec={() => onAdjust(trip.id, price.ticketType, -1)}
                  onInc={() => onAdjust(trip.id, price.ticketType, 1)}
                  atMax={atMax}
                  decLabel={`Remove ${label}`}
                  incLabel={`Add ${label}`}
                />
              </View>
            );
          })}
        </View>

        <View style={s.totalBar}>
          <Text style={s.totalLabel}>TOTAL</Text>
          <Text style={s.totalValue}>{dollars(totalCents)}</Text>
        </View>
        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.holdBtn, !hasSeats && s.holdBtnDisabled]}
          disabled={!hasSeats}
          onPress={onHold}
          activeOpacity={0.85}
        >
          <Text style={[s.holdText, !hasSeats && s.holdTextDisabled]}>
            {hasSeats ? `Continue with ${qty} seat${qty === 1 ? "" : "s"} · ${dollars(totalCents)}` : "Pick a seat to continue"}
          </Text>
        </TouchableOpacity>
        {hasSeats && (
          <Text style={s.holdNote}>SEATS AREN&rsquo;T HELD UNTIL YOU PAY</Text>
        )}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  kicker: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.orangeInk,
  },
  name: {
    fontFamily: font.sansBold,
    fontSize: 24,
    color: color.hull,
    marginTop: 4,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.deck3,
  },
  closeX: { fontSize: 18, color: color.hull },
  metaBlock: { paddingHorizontal: 16, paddingTop: 10, gap: 2 },
  metaLine: { fontFamily: font.mono, fontSize: 13, color: color.hull },
  metaLineMuted: { fontFamily: font.mono, fontSize: 13, color: color.ink3 },
  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  seatPillField: {
    backgroundColor: color.orangeOnOrange,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reassurance: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
  },
  fareRows: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  fareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fareLabel: { fontFamily: font.sansBold, fontSize: 15, color: color.hull },
  farePrice: { fontFamily: font.mono, fontSize: 13, color: color.ink3, marginTop: 2 },
  totalBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: color.hull,
    marginTop: 16,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  totalLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.inkOnDark3,
  },
  totalValue: { fontFamily: font.monoBold, fontSize: 20, color: color.white },
  footer: { padding: 16, gap: 8 },
  holdBtn: {
    minHeight: 58,
    backgroundColor: color.orange,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  holdBtnDisabled: { backgroundColor: color.disabledFill },
  holdText: {
    fontFamily: font.sansBold,
    fontSize: 16,
    letterSpacing: ls(16, tracking.data),
    color: color.white,
    textAlign: "center",
  },
  holdTextDisabled: { color: color.ink2 },
  holdNote: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
    textAlign: "center",
  },
});
