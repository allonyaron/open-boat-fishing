import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { fmtTime } from "@openboat/utils";
import { Colors } from "@/constants/Colors";
import { FontSize, LineHeight } from "@/constants/Typography";
import { Padding, Radius, Shadow, Spacing } from "@/constants/Spacing";
import { upsertBooking } from "@/lib/wallet";

// ─── Types (mirrors trips.tsx) ────────────────────────────────────────────────

type Price = { id: string; ticketType: string; priceCents: number };
type Trip = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  seatsRemaining: number;
  vessel: { id: string; name: string; color: string };
  product: { id: string; category: string; displayName: string; prices: Price[] };
};
type CartKey = string; // "tripId:ticketType"

type PendingCheckout = {
  cart: Record<CartKey, number>;
  cartTrips: Trip[];
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const checkoutStorage = new MMKV();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ─── ConfirmedView ────────────────────────────────────────────────────────────

function ConfirmedView({
  code,
  email,
  onDone,
}: {
  code: string;
  email: string;
  onDone: () => void;
}) {
  return (
    <SafeAreaView style={cv.safe}>
      <View style={cv.inner}>
        <View style={cv.iconCircle}>
          <Text style={cv.checkmark}>✓</Text>
        </View>
        <Text style={cv.title}>You're booked!</Text>
        <Text style={cv.subtitle}>Confirmation email sent to {email}</Text>
        <View style={cv.codeBox}>
          <Text style={cv.codeLabel}>CONFIRMATION CODE</Text>
          <Text style={cv.code}>{code}</Text>
        </View>
        <Text style={cv.hint}>
          Your boarding passes will appear in My Tickets shortly. You can also add them manually
          using your code and email.
        </Text>
        <TouchableOpacity style={cv.btn} onPress={onDone} activeOpacity={0.85}>
          <Text style={cv.btnText}>View My Tickets</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── CheckoutScreen ───────────────────────────────────────────────────────────

type CartLine = {
  trip: Trip;
  ticketType: string;
  qty: number;
  priceCents: number;
  lineTotal: number;
};

export default function CheckoutScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
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
      lines.push({
        trip,
        ticketType,
        qty,
        priceCents: price.priceCents,
        lineTotal: price.priceCents * qty,
      });
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
      // Build cart payload grouped by tripId
      const cartByTrip = new Map<string, { ticketType: string; quantity: number }[]>();
      for (const line of cartLines) {
        if (!cartByTrip.has(line.trip.id)) cartByTrip.set(line.trip.id, []);
        cartByTrip.get(line.trip.id)!.push({ ticketType: line.ticketType, quantity: line.qty });
      }
      const cartPayload = [...cartByTrip.entries()].map(([tripId, tickets]) => ({
        tripId,
        tickets,
      }));

      const res = await fetch(`${API_URL}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart: cartPayload,
          customerName: cleanName,
          customerEmail: cleanEmail,
          customerPhone: cleanPhone,
          notes: notes.trim() || null,
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
        // 'Canceled' means the user dismissed the sheet — not an error to surface
        if (presentError.code !== "Canceled") {
          setError(presentError.message ?? "Payment failed. Please try again.");
        }
        return;
      }

      // Payment succeeded — clear the pending cart
      checkoutStorage.set("cart_paid", true);
      checkoutStorage.delete("pending_checkout");

      setConfirmed({ code: confirmationCode, email: cleanEmail });

      // Background: retry fetching the confirmed booking and add to wallet.
      // The webhook that confirms the booking is async, so the first attempt
      // may arrive before it fires.
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
    return (
      <ConfirmedView
        code={confirmed.code}
        email={confirmed.email}
        onDone={() => router.replace("/(tabs)/tickets")}
      />
    );
  }

  if (!pending || cartLines.length === 0) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <Text style={s.emptyText}>No items in cart.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Order summary */}
          <Text style={s.sectionLabel}>ORDER SUMMARY</Text>
          <View style={s.card}>
            {linesByTrip.map(({ trip, lines }, idx) => (
              <View
                key={trip.id}
                style={[s.tripGroup, idx < linesByTrip.length - 1 && s.tripGroupBorder]}
              >
                <View style={[s.tripColorBar, { backgroundColor: trip.vessel.color }]} />
                <View style={s.tripGroupBody}>
                  <Text style={s.tripVessel}>{trip.vessel.name}</Text>
                  <Text style={s.tripMeta}>{trip.product.displayName}</Text>
                  <Text style={s.tripTime}>
                    {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)}
                  </Text>
                  {lines.map((line) => (
                    <View key={line.ticketType} style={s.lineRow}>
                      <Text style={s.lineLabel}>
                        {ticketLabel(line.ticketType)} × {line.qty}
                      </Text>
                      <Text style={s.linePrice}>{fmtCents(line.lineTotal)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalAmount}>{fmtCents(totalCents)}</Text>
            </View>
          </View>

          {/* Contact info */}
          <Text style={s.sectionLabel}>YOUR INFORMATION</Text>
          <View style={s.card}>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Full Name</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Jane Smith"
                placeholderTextColor={Colors.inkSubtle}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Email</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={Colors.inkSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>
                Mobile Number <Text style={s.optional}>(for ticket delivery)</Text>
              </Text>
              <TextInput
                style={s.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="(631) 555-0100"
                placeholderTextColor={Colors.inkSubtle}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
            <View style={[s.fieldGroup, { marginBottom: 0 }]}>
              <Text style={s.fieldLabel}>
                Special Requests <Text style={s.optional}>(optional)</Text>
              </Text>
              <TextInput
                style={[s.input, s.notesInput]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Accessibility needs, dietary requirements…"
                placeholderTextColor={Colors.inkSubtle}
                multiline
                maxLength={500}
                returnKeyType="done"
                blurOnSubmit
              />
            </View>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Text style={s.terms}>
            By completing your purchase you accept the terms and conditions.
          </Text>

          <TouchableOpacity
            style={[s.payBtn, paying && s.payBtnDisabled]}
            onPress={handlePay}
            disabled={paying}
            activeOpacity={0.85}
          >
            {paying ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={s.payBtnText}>Pay {fmtCents(totalCents)}</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: Spacing.xxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.xl,
    color: Colors.inkMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xs,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    shadowColor: Colors.shadow,
    ...Shadow.card,
  },
  tripGroup: {
    flexDirection: "row",
    paddingVertical: Padding.btnVertical,
    paddingRight: Spacing.xl,
  },
  tripGroupBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripColorBar: {
    width: Spacing.xs,
    borderRadius: Radius.xs,
    marginHorizontal: Spacing.lg,
    alignSelf: "stretch",
  },
  tripGroupBody: {
    flex: 1,
    gap: Spacing.xxs,
  },
  tripVessel: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.ink,
  },
  tripMeta: {
    fontSize: FontSize.base,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  tripTime: {
    fontSize: FontSize.base,
    color: Colors.inkSubtle,
    marginBottom: Spacing.md,
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.xxs,
  },
  lineLabel: {
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  linePrice: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.ink,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.xl,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  totalLabel: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.ink,
  },
  totalAmount: {
    fontSize: FontSize.h3,
    fontWeight: "800",
    color: Colors.ink,
  },
  fieldGroup: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Padding.btnVertical,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 0,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: "600",
    color: Colors.inkSubtle,
    letterSpacing: 0.3,
    marginBottom: Spacing.xs,
  },
  optional: {
    fontWeight: "400",
    color: Colors.inkSubtle,
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: 8,
  },
  input: {
    fontSize: FontSize.xl,
    color: Colors.ink,
    paddingVertical: Spacing.md,
  },
  error: {
    fontSize: FontSize.md,
    color: Colors.error,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    lineHeight: LineHeight.base,
  },
  terms: {
    fontSize: FontSize.base,
    color: Colors.inkSubtle,
    textAlign: "center",
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    lineHeight: LineHeight.tight,
  },
  payBtn: {
    backgroundColor: Colors.gold,
    paddingVertical: Spacing.xl,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xs,
    shadowColor: Colors.gold,
    ...Shadow.modal,
  },
  payBtnDisabled: {
    opacity: 0.7,
  },
  payBtnText: {
    color: Colors.navy,
    fontSize: FontSize.xxl,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});

const cv = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  checkmark: {
    color: Colors.navy,
    fontSize: FontSize.display,
    fontWeight: "700",
    lineHeight: LineHeight.loose,
  },
  title: {
    fontSize: FontSize.h2,
    fontWeight: "800",
    color: Colors.ink,
    textAlign: "center",
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.inkMuted,
    textAlign: "center",
    lineHeight: LineHeight.base,
  },
  codeBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Padding.cardHorizontal,
    paddingVertical: Spacing.xl,
    alignItems: "center",
    width: "100%",
  },
  codeLabel: {
    fontSize: FontSize.xs,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  code: {
    fontSize: FontSize.h1,
    fontWeight: "800",
    color: Colors.ink,
    letterSpacing: 4,
  },
  hint: {
    fontSize: FontSize.base,
    color: Colors.inkSubtle,
    textAlign: "center",
    lineHeight: LineHeight.base,
  },
  btn: {
    backgroundColor: Colors.gold,
    paddingHorizontal: Spacing.xxxxl,
    paddingVertical: Spacing.xl,
    borderRadius: Radius.lg,
    marginTop: Spacing.md,
    width: "100%",
    alignItems: "center",
  },
  btnText: {
    color: Colors.navy,
    fontSize: FontSize.xl,
    fontWeight: "700",
  },
});
