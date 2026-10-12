import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { PaymentSheet, useStripe } from "@stripe/stripe-react-native";
import { dollars, lineFares, toApiCart } from "@openboat/utils";
import { API_URL } from "@/lib/api";
import { cart, useAppCart } from "@/lib/cart-store";
import { shownQuote, useQuote } from "@/lib/quote";
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { fmtTimeRange, tripTypeColor } from "@/lib/trip-helpers";
import { upsertBooking } from "@/lib/wallet";

// The booking from the first Pay press. A retry after a decline or a dismissed
// sheet presents the same PI again instead of holding the seats twice (P2-3).
type Attempt = {
  bookingId: string;
  clientSecret: string;
  confirmationCode: string;
  holdExpiresAt: string;
  /** Proves this app owns the booking: sent on extend-hold, contact and release. */
  holdToken: string;
  /** The email the booking holds, which the wallet lookup needs. */
  email: string;
  /** The booking's totalCents: the PI's amount, which the sheet charges. */
  totalCents: number;
};

const HOLD_RAN_OUT = "Your seat hold ran out and the seats were released. Tap Pay to check they're still free.";

// Gives an unpaid hold's seats back. Best effort: once the hold expires, the
// next booking request reclaims it anyway. Returns false if it turned out paid.
async function releaseAttempt(a: Attempt): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/bookings/${a.bookingId}/release`, {
      method: "POST",
      headers: { "X-Hold-Token": a.holdToken },
    });
    return res.status !== 409;
  } catch {
    return true;
  }
}

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

export default function CheckoutScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // The same cart the Trips tab and the cart screen show (P8-4).
  const { lines } = useAppCart();
  const quote = useQuote(lines);
  const { quote: shown } = shownQuote(quote);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ code: string; email: string } | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  // The held booking's total, once there is one: the amount the sheet charges.
  const [heldTotal, setHeldTotal] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // What Pay shows: the booking's total once it exists, else the server's
  // quote. Never a client-side sum (P8-3).
  const totalCents = heldTotal ?? (quote.status === "ready" ? quote.quote.totalCents : null);

  // Leaving checkout (back to change the cart) gives the held seats back.
  useEffect(() => {
    return () => {
      if (attemptRef.current) void releaseAttempt(attemptRef.current);
    };
  }, []);

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
      const contact = { customerName: cleanName, customerEmail: cleanEmail, customerPhone: cleanPhone };

      // Reuse the live hold from an earlier attempt, after saving the contact
      // details as they are now (the confirmation goes to the stored email).
      const previous = attemptRef.current;
      let attempt: Attempt | null = null;
      if (previous && new Date(previous.holdExpiresAt).getTime() > Date.now()) {
        const res = await fetch(`${API_URL}/api/bookings/${previous.bookingId}/contact`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Hold-Token": previous.holdToken },
          body: JSON.stringify(contact),
        });
        if (!res.ok && res.status !== 404) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Unable to update your booking. Please try again.");
          return;
        }
        // 404: no longer a live hold; it is replaced below.
        if (res.ok) attemptRef.current = attempt = { ...previous, email: cleanEmail };
        else setHeldTotal(null);
      }

      if (!attempt) {
        const cartPayload = toApiCart(lines);

        // The server releases the previous booking in the same request. If the
        // request never gets an answer, attemptRef keeps it for the next tap.
        const res = await fetch(`${API_URL}/api/bookings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cart: cartPayload,
            ...contact,
            notes: null,
            replaces: previous && { bookingId: previous.bookingId, holdToken: previous.holdToken },
          }),
        });

        type BookingResponse = {
          clientSecret?: string;
          bookingId?: string;
          confirmationCode?: string;
          holdExpiresAt?: string;
          holdToken?: string;
          totalCents?: number;
          error?: string;
          code?: string;
        };
        const data = (await res.json()) as BookingResponse;
        // The server releases `replaces` (or finds it paid) before it books.
        // A rate limit, validation or server error can come back before that,
        // so keep the previous booking for the next tap.
        if (res.ok || res.status === 404 || res.status === 409) {
          attemptRef.current = null;
          setHeldTotal(null);
        }

        if (data.code === "replaced_booking_paid" && previous) {
          // It was paid after all (the sheet reported a failure it shouldn't have).
          cart.clear();
          setConfirmed({ code: previous.confirmationCode, email: previous.email });
          return;
        }
        if (
          !res.ok ||
          !data.clientSecret ||
          !data.confirmationCode ||
          !data.bookingId ||
          !data.holdExpiresAt ||
          !data.holdToken ||
          typeof data.totalCents !== "number"
        ) {
          setError(data.error ?? "Unable to create booking. Please try again.");
          return;
        }
        attempt = {
          bookingId: data.bookingId,
          clientSecret: data.clientSecret,
          confirmationCode: data.confirmationCode,
          holdExpiresAt: data.holdExpiresAt,
          holdToken: data.holdToken,
          email: cleanEmail,
          totalCents: data.totalCents,
        };
        attemptRef.current = attempt;
        // The booking was priced under the trip locks. Show its total, which is
        // what the sheet charges, and say so if it differs from the quote (P8-3).
        setHeldTotal(data.totalCents);
        if (quote.status === "ready" && quote.quote.totalCents !== data.totalCents) {
          setNotice(`The price changed to ${dollars(data.totalCents)} while you were checking out.`);
          quote.refresh();
        }
      }

      const { bookingId, clientSecret, confirmationCode, holdToken } = attempt;

      // Extend the hold so the sheet (and any 3DS step) doesn't race the expiry.
      fetch(`${API_URL}/api/bookings/${bookingId}/extend-hold`, {
        method: "PATCH",
        headers: { "X-Hold-Token": holdToken },
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ holdExpiresAt?: string }>) : null))
        .then((d) => {
          const current = attemptRef.current;
          if (d?.holdExpiresAt && current?.bookingId === bookingId) {
            attemptRef.current = { ...current, holdExpiresAt: d.holdExpiresAt };
          }
        })
        .catch(() => {});

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: process.env.EXPO_PUBLIC_MERCHANT_NAME ?? "Fishing Tickets",
        paymentIntentClientSecret: clientSecret,
        defaultBillingDetails: { name: cleanName, email: cleanEmail, phone: cleanPhone },
        allowsDelayedPaymentMethods: false,
        // Card only (P2-5): the PI is pinned to ["card"], but PaymentSheet would
        // still offer Link as a wallet.
        link: { display: PaymentSheet.LinkDisplay.NEVER },
      });

      if (initError) {
        // Most likely the PI was canceled because the hold ran out. Drop it so
        // the next tap books afresh.
        attemptRef.current = null;
        setHeldTotal(null);
        void releaseAttempt(attempt);
        setError(HOLD_RAN_OUT);
        return;
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== "Canceled") {
          setError(presentError.message ?? "Payment failed. Please try again.");
        }
        return;
      }

      attemptRef.current = null;
      cart.clear();
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
  }, [name, email, phone, lines, quote, initPaymentSheet, presentPaymentSheet]);

  if (confirmed) {
    return <ConfirmedView code={confirmed.code} onDone={() => router.replace("/(tabs)/tickets")} />;
  }

  if (lines.length === 0) {
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
            {lines.map((line, idx) => {
              const { trip } = line;
              const quoted = shown?.lines.find((l) => l.tripId === trip.id);
              return (
              <View key={trip.id} style={[s.tripGroup, idx < lines.length - 1 && s.tripGroupBorder]}>
                <View style={[s.tripColorBar, { backgroundColor: tripTypeColor(trip.product.category) }]} />
                <View style={s.tripGroupBody}>
                  <Text style={s.tripVessel}>{trip.vessel.name}</Text>
                  <Text style={s.tripMeta}>{trip.product.displayName}</Text>
                  <Text style={s.tripTime}>{fmtTimeRange(trip.startTime, trip.endTime)}</Text>
                  {lineFares(line).map((f) => {
                    const fare = quoted?.fares.find((q) => q.ticketType === f.ticketType);
                    return (
                      <View key={f.ticketType} style={s.lineRow}>
                        <Text style={s.lineLabel}>{ticketLabel(f.ticketType)} × {f.quantity}</Text>
                        <Text style={s.linePrice}>{fare ? dollars(fare.listCents) : "…"}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
              );
            })}
            {(shown?.discountCents ?? 0) > 0 && (
              <View style={s.discountRow}>
                <Text style={s.discountLabel}>Group discount</Text>
                <Text style={s.discountAmount}>−{dollars(shown!.discountCents)}</Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>TOTAL</Text>
              <Text style={s.totalAmount}>{totalCents !== null ? dollars(totalCents) : "…"}</Text>
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

          <View style={s.errorSlot}>
            {notice ? <Text style={s.notice}>{notice}</Text> : null}
            {quote.status === "error" && heldTotal === null ? <Text style={s.error}>{quote.message}</Text> : null}
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>

          <TouchableOpacity
            style={[s.payBtn, paying && s.payBtnCharging]}
            onPress={handlePay}
            disabled={paying || totalCents === null}
            activeOpacity={0.85}
          >
            {paying ? (
              <>
                <View style={s.spinnerSlot} />
                <Text style={s.payBtnText}>Charging {totalCents !== null ? dollars(totalCents) : ""}…</Text>
              </>
            ) : (
              <Text style={s.payBtnText}>{totalCents !== null ? `PAY ${dollars(totalCents)}` : "PAY"}</Text>
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
  discountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: color.ruleSoft,
  },
  discountLabel: { fontFamily: font.sansSemibold, fontSize: 14, color: color.greenOpen },
  discountAmount: { fontFamily: font.monoSemibold, fontSize: 14, color: color.greenOpen },
  notice: { fontFamily: font.sansSemibold, fontSize: 14, color: color.hull, marginBottom: 6 },
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
