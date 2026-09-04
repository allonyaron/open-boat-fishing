import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import * as Brightness from "expo-brightness";
import QRCode from "react-native-qrcode-svg";
import { fmtTime } from "@openboat/utils";
import { Colors } from "@/constants/Colors";
import {
  type WalletBooking,
  type WalletBookingItem,
  type WalletTicket,
  getTicketById,
} from "@/lib/wallet";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDateLong(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Postgres `time` columns come back as "HH:MM:SS" strings.
function fmtTimeStr(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ─── DetailRow ────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

// ─── BoardingPassScreen ───────────────────────────────────────────────────────

export default function BoardingPassScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const navigation = useNavigation();
  const prevBrightnessRef = useRef<number | null>(null);

  const [data, setData] = useState<{
    booking: WalletBooking;
    item: WalletBookingItem;
    ticket: WalletTicket;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!ticketId) return;
    getTicketById(ticketId).then((result) => {
      if (result) setData(result);
      else setNotFound(true);
    });
  }, [ticketId]);

  // Boost screen brightness to max on mount, restore on unmount.
  useEffect(() => {
    Brightness.requestPermissionsAsync().then(({ granted }) => {
      if (!granted) return;
      Brightness.getBrightnessAsync().then((current) => {
        prevBrightnessRef.current = current;
        Brightness.setBrightnessAsync(1.0);
      });
    });
    return () => {
      if (prevBrightnessRef.current !== null) {
        Brightness.setBrightnessAsync(prevBrightnessRef.current);
        prevBrightnessRef.current = null;
      }
    };
  }, []);

  // Also restore on blur so swipe-to-dismiss on iOS doesn't leave brightness stuck.
  useEffect(() => {
    return navigation.addListener("blur", () => {
      if (prevBrightnessRef.current !== null) {
        Brightness.setBrightnessAsync(prevBrightnessRef.current);
        prevBrightnessRef.current = null;
      }
    });
  }, [navigation]);

  if (notFound) {
    return (
      <SafeAreaView style={s.centered}>
        <Text style={s.errorTitle}>Ticket Not Found</Text>
        <Text style={s.errorBody}>
          This ticket isn't in your wallet. Add the booking from the Tickets tab.
        </Text>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={s.centered}>
        <ActivityIndicator color={Colors.teal} size="large" />
      </SafeAreaView>
    );
  }

  const { booking, item, ticket } = data;
  const { trip } = item;
  const isCancelled = trip.status === "cancelled" || ticket.voided;

  const whatToBring = trip.product.whatToBring ?? [];
  const { operator } = booking;

  const arriveNote = operator?.arriveMinutesBefore != null
    ? operator.arriveMinutesBefore >= 60
      ? `Arrive ${operator.arriveMinutesBefore / 60} hour${operator.arriveMinutesBefore === 60 ? "" : "s"} early`
      : `Arrive ${operator.arriveMinutesBefore} minutes early`
    : null;

  function openDirections() {
    const url = operator?.dockMapsUrl ?? (operator?.dockAddress
      ? `https://maps.google.com/?q=${encodeURIComponent(operator.dockAddress)}`
      : null);
    if (url) Linking.openURL(url);
  }

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Vessel color header */}
      <View style={[s.header, { backgroundColor: trip.vessel.color }]}>
        <Text style={s.headerVessel}>{trip.vessel.name}</Text>
        <Text style={s.headerProduct}>{trip.product.displayName}</Text>
      </View>

      {/* Cancelled banner */}
      {isCancelled && (
        <View style={s.cancelBanner}>
          <Text style={s.cancelBannerText}>
            {ticket.voided ? "TICKET CANCELLED" : "TRIP CANCELLED"}
          </Text>
        </View>
      )}

      {/* QR code */}
      <View style={[s.qrContainer, isCancelled && s.qrContainerCancelled]}>
        {isCancelled ? (
          <View style={s.qrVoid}>
            <Text style={s.qrVoidText}>✕</Text>
          </View>
        ) : (
          <QRCode value={ticket.qrPayload} size={220} color="#000000" backgroundColor="#FFFFFF" />
        )}
      </View>

      {/* Ticket type badge */}
      <View style={s.typeBadge}>
        <Text style={s.typeBadgeText}>
          BOARDING PASS · {ticketLabel(ticket.ticketType).toUpperCase()}
        </Text>
      </View>

      {/* Trip details */}
      <View style={s.detailsCard}>
        <DetailRow label="Date" value={fmtDateLong(trip.departureDate)} />
        <DetailRow label="Departs" value={fmtTime(trip.startTime)} />
        <DetailRow label="Returns" value={fmtTime(trip.endTime)} />
        {trip.boardingTime ? (
          <DetailRow label="Boarding" value={fmtTimeStr(trip.boardingTime)} />
        ) : null}
        <DetailRow label="Vessel" value={trip.vessel.name} />
        <DetailRow label="Purchased By" value={booking.customerName} />
        <DetailRow label="Confirmation" value={booking.confirmationCode} />
      </View>

      {/* Getting there */}
      {(operator?.dockAddress || operator?.dockMapsUrl || arriveNote) && (
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>GETTING THERE</Text>
          {operator?.dockAddress ? (
            <Text style={s.infoBody}>{operator.dockAddress}</Text>
          ) : null}
          {arriveNote ? (
            <Text style={s.arriveNote}>{arriveNote}</Text>
          ) : null}
          {(operator?.dockMapsUrl || operator?.dockAddress) ? (
            <TouchableOpacity style={s.directionsBtn} onPress={openDirections} activeOpacity={0.8}>
              <Text style={s.directionsBtnText}>Get Directions →</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* What to bring */}
      {whatToBring.length > 0 && (
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>WHAT TO BRING</Text>
          {whatToBring.map((item, i) => (
            <View key={i} style={s.bringRow}>
              <Text style={s.bringCheck}>✓</Text>
              <Text style={s.bringItem}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Ticket ID — scan fallback */}
      <Text style={s.ticketId} numberOfLines={1} ellipsizeMode="middle">
        {ticket.id}
      </Text>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
  },
  content: {
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: Colors.surfaceAlt,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.ink,
    textAlign: "center",
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 15,
    color: Colors.inkMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  header: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  headerVessel: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.white,
    marginBottom: 4,
  },
  headerProduct: {
    fontSize: 15,
    color: Colors.whiteA85,
    fontWeight: "500",
  },
  cancelBanner: {
    backgroundColor: Colors.error,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelBannerText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 4,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  qrContainerCancelled: {
    opacity: 0.4,
  },
  qrVoid: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
  },
  qrVoidText: {
    fontSize: 80,
    color: Colors.error,
    fontWeight: "200",
  },
  typeBadge: {
    alignItems: "center",
    marginTop: 16,
    marginBottom: 4,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 1.2,
  },
  detailsCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  detailValue: {
    fontSize: 14,
    color: Colors.ink,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 16,
  },
  ticketId: {
    fontSize: 11,
    color: Colors.inkSubtle,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    marginTop: 20,
    marginHorizontal: 20,
    letterSpacing: 0.3,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 1,
    marginBottom: 10,
  },
  infoBody: {
    fontSize: 14,
    color: Colors.ink,
    marginBottom: 6,
    lineHeight: 20,
  },
  arriveNote: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.gold,
    marginBottom: 10,
  },
  directionsBtn: {
    marginTop: 4,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  directionsBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.ink,
  },
  bringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  bringCheck: {
    fontSize: 13,
    color: Colors.gold,
    fontWeight: "700",
    width: 16,
  },
  bringItem: {
    fontSize: 14,
    color: Colors.ink,
  },
});
