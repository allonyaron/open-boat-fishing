import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useStripe } from "@stripe/stripe-react-native";
import { MMKV } from "react-native-mmkv";
import { API_URL } from "@/lib/api";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import {
  type Cart,
  type Trip,
  dollars,
  fmtTimeRange,
  tripTypeColor,
} from "@/lib/trip-helpers";
import { upsertBooking } from "@/lib/wallet";

const checkoutStorage = new MMKV();

type PendingCheckout = { cart: Cart; cartTrips: Trip[] };

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ─── ConfirmedView ────────────────────────────────────────────────────────────

function ConfirmedView({ code, onDone }: { code: string; onDone: () => void }) {
  return (
    <SafeAreaView style={cv.safe}>
      <View style={cv.appBar}>
        <Text style={cv.appBarTitle}>CONFIRMED</Text>
      </View>
      <View style={cv.inner}>
        <Text style={cv.title}>You&rsquo;re booked.</Text>
        <Text style={cv.subtitle}>Your boarding pass is saved on this phone.</Text>
        <View style={cv.codeBox}>
          <Text style={cv.codeLabel}>CONFIRMATION</Text>
          <Text style={cv.code}>{code}</Text>
        </View>
        <TouchableOpacity style={cv.btn} onPress={onDone} activeOpacity={0.85}>
          <Text style={cv.btnText}>VIEW MY TICKETS</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── CheckoutScreen ───────────────────────────────────────────────────────────

type CartLine = { trip: Trip; ticketType: string; qty: number; priceCents: number; lineTotal: number };

export default function CheckoutScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ code: string; email: string } | null>(null);

  useEffect(() => {
    const raw = checkoutStorage.getString("pending_checkout");
    if (raw) {
      try {
        setPending(JSON.parse(raw) as PendingCheckout);
      } catch {
        /* ignore malformed */
      }
    }
  }, []);

  const cartLines = useMemo<CartLine[]>(() => {
    if (!pending) return [];
    const lines: CartLine[] = [];
    for (const [key, qty] of Object.entries(pending.cart)) {
      if (qty <= 0) continue;
      const [tripId, ticketType] = key.split(":");
      const trip = pending.cartTrips.find((t) => t.id === tripId);
      if (!trip) continue;
      const price = trip.product.prices.find((p) => p.ticketType === ticketType);
      if (!price) continue;
      lines.push({ trip, ticketType, qty, priceCents: price.priceCents, lineTotal: price.priceCents * qty });
    }
    return lines;
  }, [pending]);

  const totalCents = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines]);

  const linesByTrip = useMemo(() => {
    const map = new Map<string, { trip: Trip; lines: CartLine[] }>();
    for (const line of cartLines) {
      if (!map.has(line.trip.id)) map.set(line.trip.id, { trip: line.trip, lines: [] });
      map.get(line.trip.id)!.lines.push(line);
    }
    return [...map.values()];
  }, [cartLines]);

  const handlePay = useCallback(async () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim() || undefined;

    if (!cleanName) {
      setError("Please enter your name.");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setError(null);
    setPaying(true);

    try {
      const cartByTrip = new Map<string, { ticketType: string; quantity: number }[]>();
      for (const line of cartLines) {
        if (!cartByTrip.has(line.trip.id)) cartByTrip.set(line.trip.id, []);
        cartByTrip.get(line.trip.id)!.push({ ticketType: line.ticketType, quantity: line.qty });
      }
      const cartPayload = [...cartByTrip.entries()].map(([tripId, tickets]) => ({ tripId, tickets }));

      const res = await fetch(`${API_URL}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart: cartPayload,
          customerName: cleanName,
          customerEmail: cleanEmail,
          customerPhone: cleanPhone,
          notes: null,
        }),
      });

      type BookingResponse = {
        clientSecret?: string;
        bookingId?: string;
        confirmationCode?: string;
        totalCents?: number;
        error?: string;
      };
      const data = (await res.json()) as BookingResponse;

      if (!res.ok || !data.clientSecret || !data.confirmationCode) {
        setError(data.error ?? "Unable to create booking. Please try again.");
        return;
      }

      const { clientSecret, confirmationCode } = data;

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: process.env.EXPO_PUBLIC_MERCHANT_NAME ?? "Fishing Tickets",
        paymentIntentClientSecret: clientSecret,
        defaultBillingDetails: { name: cleanName, email: cleanEmail, phone: cleanPhone },
        allowsDelayedPaymentMethods: false,
      });

      if (initError) {
        setError(initError.message ?? "Payment setup failed. Please try again.");
        return;
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== "Canceled") {
          setError(presentError.message ?? "Payment failed. Please try again.");
        }
        return;
      }

      checkoutStorage.set("cart_paid", true);
      checkoutStorage.delete("pending_checkout");
      setConfirmed({ code: confirmationCode, email: cleanEmail });

      void (async () => {
        for (let i = 0; i < 5; i++) {
          await new Promise<void>((r) => setTimeout(r, 1500));
          try {
            const r = await fetch(
              `${API_URL}/api/bookings?code=${encodeURIComponent(confirmationCode)}&email=${encodeURIComponent(cleanEmail)}`,
            );
            if (r.ok) {
              const bookingData = (await r.json()) as Parameters<typeof upsertBooking>[0];
              await upsertBooking(bookingData);
              break;
            }
          } catch {
            /* keep trying */
          }
        }
      })();
    } catch {
      setError("Could not connect to server. Check your connection and try again.");
    } finally {
      setPaying(false);
    }
  }, [name, email, phone, cartLines, initPaymentSheet, presentPaymentSheet]);

  if (confirmed) {
    return <ConfirmedView code={confirmed.code} onDone={() => router.replace("/(tabs)/tickets")} />;
  }

  if (!pending || cartLines.length === 0) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.appBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backLink}>‹ BACK</Text>
          </TouchableOpacity>
          <Text style={s.appBarTitle}>PAY BY CARD</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={s.centered}>
          <Text style={s.emptyText}>No items in cart.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backLink}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={s.appBarTitle}>PAY BY CARD</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionLabel}>ORDER SUMMARY</Text>
          <View style={s.card}>
            {linesByTrip.map(({ trip, lines }, idx) => (
              <View key={trip.id} style={[s.tripGroup, idx < linesByTrip.length - 1 && s.tripGroupBorder]}>
                <View style={[s.tripColorBar, { backgroundColor: tripTypeColor(trip.product.category) }]} />
                <View style={s.tripGroupBody}>
                  <Text style={s.tripVessel}>{trip.vessel.name}</Text>
                  <Text style={s.tripMeta}>{trip.product.displayName}</Text>
                  <Text style={s.tripTime}>{fmtTimeRange(trip.startTime, trip.endTime)}</Text>
                  {lines.map((line) => (
                    <View key={line.ticketType} style={s.lineRow}>
                      <Text style={s.lineLabel}>{ticketLabel(line.ticketType)} × {line.qty}</Text>
                      <Text style={s.linePrice}>{dollars(line.lineTotal)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>TOTAL</Text>
              <Text style={s.totalAmount}>{dollars(totalCents)}</Text>
            </View>
          </View>

          <Text style={s.sectionLabel}>YOUR INFORMATION</Text>
          <View style={s.card}>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>NAME</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Jane Smith"
                placeholderTextColor={color.disabledBorder}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>EMAIL <Text style={s.optional}>(for your receipt)</Text></Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={color.disabledBorder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>
            <View style={[s.fieldGroup, { borderBottomWidth: 0 }]}>
              <Text style={s.fieldLabel}>MOBILE <Text style={s.optional}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="(631) 555-0100"
                placeholderTextColor={color.disabledBorder}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
          </View>

          <View style={s.errorSlot}>{error ? <Text style={s.error}>{error}</Text> : null}</View>

          <TouchableOpacity
            style={[s.payBtn, paying && s.payBtnCharging]}
            onPress={handlePay}
            disabled={paying}
            activeOpacity={0.85}
          >
            {paying ? (
              <>
                <View style={s.spinnerSlot} />
                <Text style={s.payBtnText}>Charging {dollars(totalCents)}…</Text>
              </>
            ) : (
              <Text style={s.payBtnText}>PAY {dollars(totalCents)}</Text>
            )}
          </TouchableOpacity>
          {paying && <Text style={s.chargingNote}>DON&rsquo;T LEAVE THE APP · THIS TAKES A FEW SECONDS</Text>}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  backLink: {
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl },
  emptyText: { fontFamily: font.sans, fontSize: 16, color: color.ink2 },
  scroll: { flex: 1 },
  scrollContent: { padding: space.gutter },
  sectionLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.ink2,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  card: { backgroundColor: color.white, borderWidth: 1, borderColor: color.rule },
  tripGroup: { flexDirection: "row", paddingVertical: 14, paddingRight: space.lg },
  tripGroupBorder: { borderBottomWidth: 1, borderBottomColor: color.ruleSoft },
  tripColorBar: { width: 4, marginHorizontal: space.lg, alignSelf: "stretch" },
  tripGroupBody: { flex: 1, gap: 2 },
  tripVessel: { fontFamily: font.sansBold, fontSize: 16, color: color.hull },
  tripMeta: { fontFamily: font.sans, fontSize: 13, color: color.ink2 },
  tripTime: { fontFamily: font.mono, fontSize: 12, color: color.ink3, marginBottom: 6 },
  lineRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  lineLabel: { fontFamily: font.sans, fontSize: 14, color: color.hull },
  linePrice: { fontFamily: font.monoSemibold, fontSize: 13, color: color.hull },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.rule,
    backgroundColor: color.deck3,
  },
  totalLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.hull,
  },
  totalAmount: { fontFamily: font.monoBold, fontSize: 22, color: color.hull },
  fieldGroup: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.ruleSoft,
  },
  fieldLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.ink3,
    marginBottom: 4,
  },
  optional: { fontFamily: font.mono, color: color.disabledBorder },
  input: {
    fontFamily: font.sans,
    fontSize: 17,
    color: color.hull,
    paddingVertical: space.sm,
  },
  errorSlot: { minHeight: 20, marginTop: space.md },
  error: { fontFamily: font.sansSemibold, fontSize: 13, color: color.orangeInk },
  payBtn: {
    minHeight: 66,
    backgroundColor: color.orange,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: space.sm,
  },
  payBtnCharging: { backgroundColor: color.orangePress },
  payBtnText: {
    fontFamily: font.sansBold,
    fontSize: 16,
    letterSpacing: ls(16, tracking.data),
    color: color.white,
  },
  spinnerSlot: { width: 14, height: 14, backgroundColor: color.orangeOnOrange },
  chargingNote: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
    textAlign: "center",
    marginTop: 8,
  },
});

const cv = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 54,
    justifyContent: "center",
    paddingHorizontal: space.gutter,
    backgroundColor: color.hull,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  appBarTitle: {
    fontFamily: font.monoSemibold,
    fontSize: 13,
    letterSpacing: ls(13, tracking.kicker),
    color: color.white,
  },
  inner: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xxl, gap: space.lg },
  title: { fontFamily: font.sansBold, fontSize: 26, color: color.hull, textAlign: "center" },
  subtitle: { fontFamily: font.sans, fontSize: 15, color: color.ink2, textAlign: "center" },
  codeBox: {
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.rule,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    alignItems: "center",
    width: "100%",
  },
  codeLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.ink3,
    marginBottom: 6,
  },
  code: { fontFamily: font.monoBold, fontSize: 28, color: color.hull, letterSpacing: 2 },
  btn: {
    backgroundColor: color.orange,
    paddingVertical: space.lg,
    width: "100%",
    alignItems: "center",
  },
  btnText: {
    fontFamily: font.sansBold,
    fontSize: 14,
    letterSpacing: ls(14, tracking.data),
    color: color.white,
  },
});
