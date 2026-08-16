import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { API_URL } from "@/lib/api";
import { fmtTime } from "@openboat/utils";
import * as SecureStore from "expo-secure-store";
import { Colors } from "@/constants/Colors";
import { useCustomerAuth } from "@/lib/customer-auth-context";
import { saveCustomerToken } from "@/lib/customer-auth";
import { registerForPushNotifications, type NotificationPrefs } from "@/lib/push-notifications";

const PUSH_TOKEN_KEY = "expo_push_token";
const PREFS_KEY = "notification_prefs";

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingItem = {
  id: string;
  bookingId: string;
  subtotalCents: number;
  tripDepartureDate: string;
  tripStartTime: string;
  tripEndTime: string;
  tripStatus: string;
  vesselName: string;
  vesselColor: string;
  productName: string;
  tickets: { id: string; ticketType: string; priceCents: number; voided: boolean }[];
};

type Booking = {
  id: string;
  confirmationCode: string;
  status: string;
  totalCents: number;
  createdAt: string;
  items: BookingItem[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// fmtTime imported from @openboat/utils

function statusColor(s: string) {
  if (s === "cancelled") return Colors.error;
  if (s === "sailed" || s === "confirmed") return Colors.success;
  return Colors.inkSubtle;
}

// ─── BookingCard ──────────────────────────────────────────────────────────────

function BookingCard({ booking }: { booking: Booking }) {
  return (
    <View style={b.card}>
      <View style={b.cardHeader}>
        <Text style={b.code}>#{booking.confirmationCode}</Text>
        <Text style={[b.status, { color: statusColor(booking.status) }]}>
          {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
        </Text>
      </View>
      {booking.items.map((item) => (
        <View key={item.id} style={b.item}>
          <View style={[b.colorDot, { backgroundColor: item.vesselColor || Colors.teal }]} />
          <View style={b.itemBody}>
            <Text style={b.itemVessel}>{item.vesselName}</Text>
            <Text style={b.itemProduct}>{item.productName}</Text>
            <Text style={b.itemDate}>
              {fmtDate(item.tripDepartureDate)} · {fmtTime(item.tripStartTime)}–
              {fmtTime(item.tripEndTime)}
            </Text>
            <Text style={b.itemTickets}>
              {item.tickets
                .filter((t) => !t.voided)
                .map((t) => t.ticketType)
                .join(", ")}
            </Text>
          </View>
        </View>
      ))}
      <View style={b.cardFooter}>
        <Text style={b.total}>{fmt$(booking.totalCents)}</Text>
      </View>
    </View>
  );
}

// ─── SignInForm ───────────────────────────────────────────────────────────────

function SignInForm({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestOtp = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to send code.");
      } else {
        setStep("otp");
      }
    } catch {
      setError("Could not connect. Check your network.");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    const clean = otp.trim();
    if (clean.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: clean }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Incorrect code. Try again.");
      } else {
        onSignedIn(data.token);
      }
    } catch {
      setError("Could not connect. Check your network.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={f.wrap}>
        <Text style={f.heading}>Sign In</Text>
        <Text style={f.sub}>
          {step === "email"
            ? "Enter your email to receive a one-time code."
            : `We sent a 6-digit code to ${email}. Enter it below.`}
        </Text>

        {step === "email" ? (
          <TextInput
            style={f.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.inkSubtle}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={requestOtp}
            editable={!loading}
          />
        ) : (
          <TextInput
            style={[f.input, f.otpInput]}
            value={otp}
            onChangeText={setOtp}
            placeholder="000000"
            placeholderTextColor={Colors.inkSubtle}
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={verifyOtp}
            editable={!loading}
            autoFocus
          />
        )}

        {error ? <Text style={f.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[f.btn, loading && f.btnLoading]}
          onPress={step === "email" ? requestOtp : verifyOtp}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={f.btnText}>{step === "email" ? "Send Code" : "Verify Code"}</Text>
          )}
        </TouchableOpacity>

        {step === "otp" && (
          <TouchableOpacity
            onPress={() => {
              setStep("email");
              setOtp("");
              setError(null);
            }}
          >
            <Text style={f.back}>← Use a different email</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── NotificationSettings ─────────────────────────────────────────────────────

function NotificationSettings({
  pushToken,
  token,
}: {
  pushToken: string | null;
  token: string | null;
}) {
  const defaultPrefs: NotificationPrefs = {
    notifyReminders: true,
    notifyCancellations: true,
    notifyConfirmations: true,
  };
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    SecureStore.getItemAsync(PREFS_KEY).then((raw) => {
      if (raw && mounted.current) {
        try {
          setPrefs(JSON.parse(raw));
        } catch {}
      }
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const updatePref = async (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next));
    if (!pushToken || !token) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expoToken: pushToken, ...next }),
      });
    } catch {}
    setSaving(false);
  };

  if (!pushToken) {
    return (
      <View style={n.wrap}>
        <Text style={n.title}>Notifications</Text>
        <Text style={n.noToken}>Notifications are not available in this environment.</Text>
      </View>
    );
  }

  return (
    <View style={n.wrap}>
      <Text style={n.title}>Notifications {saving ? "(saving…)" : ""}</Text>
      {(
        [
          {
            key: "notifyCancellations",
            label: "Trip cancellations",
            desc: "Get notified immediately if your trip is cancelled.",
          },
          {
            key: "notifyReminders",
            label: "Trip reminders",
            desc: "Reminder 24 hours before your trip departs.",
          },
          {
            key: "notifyConfirmations",
            label: "Booking confirmations",
            desc: "Confirmation push when a booking is processed.",
          },
        ] as { key: keyof NotificationPrefs; label: string; desc: string }[]
      ).map((item) => (
        <View key={item.key} style={n.row}>
          <View style={n.rowText}>
            <Text style={n.rowLabel}>{item.label}</Text>
            <Text style={n.rowDesc}>{item.desc}</Text>
          </View>
          <Switch
            value={prefs[item.key]}
            onValueChange={(v) => updatePref(item.key, v)}
            trackColor={{ true: Colors.teal, false: Colors.border }}
            thumbColor="#fff"
          />
        </View>
      ))}
    </View>
  );
}

// ─── AccountScreen ────────────────────────────────────────────────────────────

export default function AccountScreen() {
  const { token, customer, loading: authLoading, setAuth, logout } = useCustomerAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);

  // Acquire push token on mount; registration with the server happens on sign-in
  useEffect(() => {
    registerForPushNotifications().then(async (expoPushToken) => {
      if (!expoPushToken) return;
      setPushToken(expoPushToken);
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, expoPushToken);
    });
  }, []);

  const fetchBookings = useCallback(async () => {
    if (!token) return;
    setBookingsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/account/bookings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as Booking[];
        setBookings(data);
      }
    } catch {}
    setBookingsLoading(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      fetchBookings();
    }, [fetchBookings]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBookings();
    setRefreshing(false);
  }, [fetchBookings]);

  const handleSignedIn = async (newToken: string) => {
    await saveCustomerToken(newToken);
    setAuth(newToken);
    if (pushToken) {
      fetch(`${API_URL}/api/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${newToken}` },
        body: JSON.stringify({ expoToken: pushToken }),
      }).catch(() => {});
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  if (authLoading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <ActivityIndicator color={Colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.header}>
            <Text style={s.headerTitle}>Account</Text>
          </View>
          <SignInForm onSignedIn={handleSignedIn} />
          <NotificationSettings pushToken={pushToken} token={token} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.teal} />
        }
      >
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Account</Text>
            <Text style={s.headerEmail}>{customer?.email}</Text>
          </View>
          <TouchableOpacity
            onPress={handleLogout}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.signOut}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionLabel}>Booking History</Text>

        {bookingsLoading ? (
          <ActivityIndicator color={Colors.teal} style={{ marginTop: 32 }} />
        ) : bookings.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🎣</Text>
            <Text style={s.emptyTitle}>No bookings yet</Text>
            <Text style={s.emptyBody}>Book a trip and it'll appear here.</Text>
          </View>
        ) : (
          bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)
        )}

        <NotificationSettings pushToken={pushToken} token={token} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.teal,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#fff" },
  headerEmail: { fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  signOut: { fontSize: 14, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.inkSubtle,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },
  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 32, gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: Colors.ink },
  emptyBody: { fontSize: 14, color: Colors.inkMuted, textAlign: "center" },
});

const b = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  code: { fontSize: 14, fontWeight: "700", color: Colors.ink },
  status: { fontSize: 12, fontWeight: "700" },
  item: { flexDirection: "row", padding: 12, gap: 10 },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  itemBody: { flex: 1 },
  itemVessel: { fontSize: 14, fontWeight: "700", color: Colors.ink },
  itemProduct: { fontSize: 13, color: Colors.inkMuted, fontWeight: "500" },
  itemDate: { fontSize: 12, color: Colors.inkSubtle, marginTop: 2 },
  itemTickets: { fontSize: 12, color: Colors.inkSubtle, marginTop: 2, textTransform: "capitalize" },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "flex-end",
  },
  total: { fontSize: 14, fontWeight: "700", color: Colors.ink },
});

const f = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    margin: 16,
    padding: 20,
    gap: 12,
  },
  heading: { fontSize: 20, fontWeight: "800", color: Colors.ink },
  sub: { fontSize: 14, color: Colors.inkMuted, lineHeight: 20 },
  input: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.surfaceAlt,
  },
  otpInput: { fontSize: 28, fontWeight: "700", letterSpacing: 8, textAlign: "center" },
  error: { fontSize: 13, color: Colors.error },
  btn: {
    height: 50,
    backgroundColor: Colors.teal,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnLoading: { opacity: 0.7 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  back: { fontSize: 13, color: Colors.teal, textAlign: "center" },
});

const n = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    margin: 16,
    marginTop: 8,
    padding: 20,
    gap: 4,
  },
  title: { fontSize: 16, fontWeight: "700", color: Colors.ink, marginBottom: 12 },
  noToken: { fontSize: 14, color: Colors.inkMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: "600", color: Colors.ink },
  rowDesc: { fontSize: 12, color: Colors.inkMuted, marginTop: 2, lineHeight: 16 },
});
