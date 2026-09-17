import React, { useEffect, useRef, useState } from "react";
import { Linking, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Brightness from "expo-brightness";
import QRCode from "react-native-qrcode-svg";
import { fmtTime } from "@openboat/utils";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { type WalletBooking, type WalletBookingItem, type WalletTicket, getTicketById } from "@/lib/wallet";

function fmtDateLong(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmtTimeStr(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Minutes from now until an ISO timestamp — negative once past. */
function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function boardingBannerText(minsUntilBoard: number | null): string {
  if (minsUntilBoard == null) return "";
  if (minsUntilBoard > 60 * 6) return "BOARDS TODAY";
  if (minsUntilBoard > 0) return `BOARDS IN ${minsUntilBoard} MINUTE${minsUntilBoard === 1 ? "" : "S"}`;
  return "BOARDING NOW";
}

export default function BoardingPassScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const prevBrightnessRef = useRef<number | null>(null);

  const [data, setData] = useState<{ booking: WalletBooking; item: WalletBookingItem; ticket: WalletTicket } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticketId) return;
    getTicketById(ticketId).then((result) => {
      if (result) setData(result);
      else setNotFound(true);
    });
  }, [ticketId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
        <Text style={s.errorTitle}>TICKET NOT FOUND</Text>
        <Text style={s.errorBody}>This ticket isn&rsquo;t in your wallet. Add the booking from the Tickets tab.</Text>
      </SafeAreaView>
    );
  }

  if (!data) {
    return <SafeAreaView style={s.centered} />;
  }

  void now; // re-render trigger for the boarding countdown

  const { booking, item, ticket } = data;
  const { trip } = item;
  const isCancelled = trip.status === "cancelled" || ticket.voided;
  const { operator } = booking;

  // Boarding time is a "HH:MM:SS" Postgres time column; fall back to departure minus 30 min.
  let minsUntilBoard: number | null = null;
  if (!isCancelled) {
    if (trip.boardingTime) {
      const [bh, bm] = trip.boardingTime.split(":").map(Number);
      const boardIso = new Date(trip.startTime);
      boardIso.setHours(bh, bm, 0, 0);
      minsUntilBoard = minutesUntil(boardIso.toISOString());
    } else {
      minsUntilBoard = minutesUntil(trip.startTime) - 30;
    }
  }

  function openDirections() {
    const url = operator?.dockMapsUrl ?? (operator?.dockAddress
      ? `https://maps.google.com/?q=${encodeURIComponent(operator.dockAddress)}`
      : null);
    if (url) Linking.openURL(url);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.closeLink}>✕</Text>
        </TouchableOpacity>
        <Text style={s.appBarTitle}>SAVED ON THIS PHONE ✓</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {!isCancelled ? (
          <View style={s.banner}>
            <Text style={s.bannerText}>{boardingBannerText(minsUntilBoard)}</Text>
          </View>
        ) : (
          <View style={s.cancelBanner}>
            <Text style={s.cancelBannerText}>{ticket.voided ? "TICKET CANCELLED" : "TRIP CANCELLED"}</Text>
          </View>
        )}

        <View style={s.tripNameBlock}>
          <Text style={s.tripName}>{trip.product.displayName}</Text>
          <Text style={s.vesselName}>{trip.vessel.name}</Text>
        </View>

        {/* Stub notch — deck-colored punches at each end of a dashed rule. */}
        <View style={s.notchRow}>
          <View style={[s.notchSquare, { backgroundColor: trip.vessel.color }]} />
          <View style={s.notchRule} />
          <View style={[s.notchSquare, { backgroundColor: trip.vessel.color }]} />
        </View>

        <View style={s.detailBlock}>
          <View style={s.qrWrap}>
            {isCancelled ? (
              <View style={s.qrVoid}>
                <Text style={s.qrVoidText}>✕</Text>
              </View>
            ) : (
              <QRCode value={ticket.qrPayload} size={124} color={color.hull} backgroundColor={color.white} />
            )}
          </View>
          <View style={s.detailCols}>
            <View>
              <Text style={s.detailLabel}>CONFIRMATION</Text>
              <Text style={s.detailValue}>{booking.confirmationCode}</Text>
            </View>
            <View style={{ marginTop: space.md }}>
              <Text style={s.detailLabel}>BE AT DOCK BY</Text>
              <Text style={s.detailValue}>
                {trip.boardingTime ? fmtTimeStr(trip.boardingTime) : fmtTime(trip.startTime)}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.paidBlock}>
          <Row label="DATE" value={fmtDateLong(trip.departureDate)} />
          <Row label="DEPARTS" value={fmtTime(trip.startTime)} />
          <Row label="RETURNS" value={fmtTime(trip.endTime)} />
          <Row label="TICKET" value={`${ticketLabel(ticket.ticketType)} · ${trip.vessel.name}`} />
          <Row label="PASSENGER" value={booking.customerName} last />
        </View>

        {(operator?.dockAddress || operator?.dockMapsUrl) && (
          <TouchableOpacity style={s.actionRow} onPress={openDirections} activeOpacity={0.8}>
            <Text style={s.actionText}>DIRECTIONS TO THE DOCK →</Text>
          </TouchableOpacity>
        )}

        {trip.product.whatToBring && trip.product.whatToBring.length > 0 && (
          <View style={s.beforeYouGo}>
            <Text style={s.beforeYouGoTitle}>BEFORE YOU GO</Text>
            {trip.product.whatToBring.map((item, i) => (
              <Text key={i} style={s.beforeYouGoItem}>• {item}</Text>
            ))}
          </View>
        )}

        <Text style={s.ticketId} numberOfLines={1} ellipsizeMode="middle">{ticket.id}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[r.row, !last && r.rowRule]}>
      <Text style={r.label}>{label}</Text>
      <Text style={r.value}>{value}</Text>
    </View>
  );
}

const r = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  rowRule: { borderBottomWidth: 1, borderBottomColor: color.ruleSoft },
  label: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.label), color: color.ink3 },
  value: { fontFamily: font.sansSemibold, fontSize: 14, color: color.hull, textAlign: "right", flexShrink: 1, marginLeft: 12 },
});

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter,
    backgroundColor: color.white,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  closeLink: { fontSize: 16, color: color.hull, width: 20 },
  appBarTitle: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.greenOpen,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl, backgroundColor: color.deck },
  errorTitle: { fontFamily: font.sansBold, fontSize: 18, color: color.hull, marginBottom: 8, textAlign: "center" },
  errorBody: { fontFamily: font.sans, fontSize: 14, color: color.ink2, textAlign: "center", lineHeight: 20 },
  content: { paddingBottom: 40 },
  banner: {
    backgroundColor: color.hull,
    paddingVertical: 10,
    alignItems: "center",
  },
  bannerText: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kickerWide),
    color: color.orangeLight,
  },
  cancelBanner: { backgroundColor: color.orangePress, paddingVertical: 10, alignItems: "center" },
  cancelBannerText: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kickerWide),
    color: color.white,
  },
  tripNameBlock: { backgroundColor: color.hull, paddingHorizontal: space.gutter, paddingBottom: space.lg, paddingTop: 4 },
  tripName: { fontFamily: font.sansBold, fontSize: 26, color: color.white },
  vesselName: { fontFamily: font.mono, fontSize: 13, color: color.inkOnDark3, marginTop: 2 },
  notchRow: { flexDirection: "row", alignItems: "center", height: 12, backgroundColor: color.hull },
  notchSquare: { width: 12, height: 12 },
  notchRule: {
    flex: 1,
    height: 0,
    borderTopWidth: 1,
    borderTopColor: color.hullLine,
    borderStyle: "dashed",
    marginHorizontal: 4,
  },
  detailBlock: {
    flexDirection: "row",
    backgroundColor: color.white,
    padding: space.gutter,
    gap: space.lg,
  },
  qrWrap: {
    width: 124,
    height: 124,
    backgroundColor: color.white,
    padding: 8,
    borderWidth: 1,
    borderColor: color.rule,
    alignItems: "center",
    justifyContent: "center",
  },
  qrVoid: { width: 108, height: 108, alignItems: "center", justifyContent: "center" },
  qrVoidText: { fontSize: 64, color: color.orangePress, fontWeight: "200" },
  detailCols: { flex: 1, justifyContent: "center" },
  detailLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
  },
  detailValue: { fontFamily: font.monoSemibold, fontSize: 20, color: color.hull, marginTop: 2 },
  paidBlock: { backgroundColor: color.white, paddingHorizontal: space.gutter, marginTop: 1 },
  actionRow: {
    backgroundColor: color.white,
    marginTop: 1,
    paddingHorizontal: space.gutter,
    paddingVertical: 14,
  },
  actionText: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.orangeInk,
  },
  beforeYouGo: { backgroundColor: color.orangeOnOrange, marginTop: space.lg, marginHorizontal: space.gutter, padding: space.md },
  beforeYouGoTitle: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.orangeInk,
    marginBottom: 6,
  },
  beforeYouGoItem: { fontFamily: font.sans, fontSize: 13, color: color.orangeInk, lineHeight: 19 },
  ticketId: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.disabledBorder,
    textAlign: "center",
    marginTop: 16,
  },
});
