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
import Constants from "expo-constants";
import { Colors } from "@/constants/Colors";
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

// ─── API URL ──────────────────────────────────────────────────────────────────

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error("EXPO_PUBLIC_API_URL must be set for production builds");
}
const API_URL = getApiUrl();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
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
            <View style={[s.fieldGroup, { marginBottom: 0 }]}>
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
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.payBtnText}>Pay {fmtCents(totalCents)}</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 32 }} />
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
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.inkMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tripGroup: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingRight: 16,
  },
  tripGroupBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripColorBar: {
    width: 4,
    borderRadius: 2,
    marginHorizontal: 12,
    alignSelf: "stretch",
  },
  tripGroupBody: {
    flex: 1,
    gap: 2,
  },
  tripVessel: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.ink,
  },
  tripMeta: {
    fontSize: 13,
    color: Colors.inkMuted,
    fontWeight: "500",
  },
  tripTime: {
    fontSize: 13,
    color: Colors.inkSubtle,
    marginBottom: 8,
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  lineLabel: {
    fontSize: 14,
    color: Colors.ink,
  },
  linePrice: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.ink,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.ink,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.ink,
  },
  fieldGroup: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 0,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.inkSubtle,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  optional: {
    fontWeight: "400",
    color: Colors.inkSubtle,
  },
  input: {
    fontSize: 16,
    color: Colors.ink,
    paddingVertical: 8,
  },
  error: {
    fontSize: 14,
    color: Colors.error,
    marginTop: 12,
    paddingHorizontal: 4,
    lineHeight: 20,
  },
  terms: {
    fontSize: 13,
    color: Colors.inkSubtle,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 12,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  payBtn: {
    backgroundColor: Colors.teal,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: Colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  payBtnDisabled: {
    opacity: 0.7,
  },
  payBtnText: {
    color: "#fff",
    fontSize: 18,
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
    paddingHorizontal: 32,
    gap: 16,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  checkmark: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "700",
    lineHeight: 44,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.ink,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: Colors.inkMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  codeBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 28,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 1,
    marginBottom: 6,
  },
  code: {
    fontSize: 32,
    fontWeight: "800",
    color: Colors.ink,
    letterSpacing: 4,
  },
  hint: {
    fontSize: 13,
    color: Colors.inkSubtle,
    textAlign: "center",
    lineHeight: 19,
  },
  btn: {
    backgroundColor: Colors.teal,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 8,
    width: "100%",
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
