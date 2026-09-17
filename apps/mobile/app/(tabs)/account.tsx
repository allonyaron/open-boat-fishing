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
import { color, font, ls, space, tracking } from "@/constants/nativeTokens";
import { useCustomerAuth } from "@/lib/customer-auth-context";
import { saveCustomerToken } from "@/lib/customer-auth";
import { registerForPushNotifications, type NotificationPrefs } from "@/lib/push-notifications";

const PUSH_TOKEN_KEY = "expo_push_token";
const PREFS_KEY = "notification_prefs";

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

function fmt$(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusColor(st: string) {
  if (st === "cancelled") return color.orangeInk;
  if (st === "sailed" || st === "confirmed") return color.greenOpen;
  return color.ink3;
}

function BookingCard({ booking }: { booking: Booking }) {
  return (
    <View style={b.card}>
      <View style={b.cardHeader}>
        <Text style={b.code}>{booking.confirmationCode}</Text>
        <Text style={[b.status, { color: statusColor(booking.status) }]}>{booking.status.toUpperCase()}</Text>
      </View>
      {booking.items.map((item) => (
        <View key={item.id} style={b.item}>
          <View style={[b.colorDot, { backgroundColor: item.vesselColor || color.hull }]} />
          <View style={b.itemBody}>
            <Text style={b.itemVessel}>{item.vesselName}</Text>
            <Text style={b.itemProduct}>{item.productName}</Text>
            <Text style={b.itemDate}>
              {fmtDate(item.tripDepartureDate)} · {fmtTime(item.tripStartTime)}–{fmtTime(item.tripEndTime)}
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
      if (!res.ok) setError(data.error ?? "Failed to send code.");
      else setStep("otp");
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
      if (!res.ok || !data.token) setError(data.error ?? "Incorrect code. Try again.");
      else onSignedIn(data.token);
    } catch {
      setError("Could not connect. Check your network.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={f.wrap}>
        <Text style={f.label}>{step === "email" ? "EMAIL" : "6-DIGIT CODE"}</Text>
        {step === "email" ? (
          <TextInput
            style={f.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={color.disabledBorder}
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
            placeholderTextColor={color.disabledBorder}
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={verifyOtp}
            editable={!loading}
            autoFocus
          />
        )}

        {error ? <Text style={f.error}>{error}</Text> : null}

        <TouchableOpacity style={[f.btn, loading && f.btnLoading]} onPress={step === "email" ? requestOtp : verifyOtp} disabled={loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color={color.white} /> : <Text style={f.btnText}>{step === "email" ? "SEND CODE" : "VERIFY CODE"}</Text>}
        </TouchableOpacity>

        {step === "otp" && (
          <TouchableOpacity onPress={() => { setStep("email"); setOtp(""); setError(null); }}>
            <Text style={f.back}>‹ USE A DIFFERENT EMAIL</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function NotificationSettings({ pushToken, token }: { pushToken: string | null; token: string | null }) {
  const defaultPrefs: NotificationPrefs = { notifyReminders: true, notifyCancellations: true, notifyConfirmations: true };
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
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
    try {
      await fetch(`${API_URL}/api/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expoToken: pushToken, ...next }),
      });
    } catch {}
  };

  const onCount = Object.values(prefs).filter(Boolean).length;

  return (
    <View>
      <Text style={g.groupLabel}>ON THIS PHONE</Text>
      <View style={g.group}>
        <ListRow label="Notifications" value={pushToken ? `${onCount} ON ›` : "UNAVAILABLE"} disabled={!pushToken} />
        {pushToken && (
          <View style={g.subRows}>
            <SwitchRow label="Trip cancellations" value={prefs.notifyCancellations} onChange={(v) => updatePref("notifyCancellations", v)} />
            <SwitchRow label="Trip reminders" value={prefs.notifyReminders} onChange={(v) => updatePref("notifyReminders", v)} />
            <SwitchRow label="Booking confirmations" value={prefs.notifyConfirmations} onChange={(v) => updatePref("notifyConfirmations", v)} last />
          </View>
        )}
      </View>
    </View>
  );
}

function ListRow({ label, value, disabled }: { label: string; value: string; disabled?: boolean }) {
  return (
    <View style={g.row}>
      <Text style={[g.rowLabel, disabled && g.rowLabelDisabled]}>{label}</Text>
      <Text style={g.rowValue}>{value}</Text>
    </View>
  );
}

function SwitchRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[g.subRow, !last && g.subRowRule]}>
      <Text style={g.subRowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: color.disabledFill, true: color.orange }} thumbColor={color.white} />
    </View>
  );
}

export default function AccountScreen() {
  const { token, customer, loading: authLoading, setAuth, logout } = useCustomerAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);

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
      const res = await fetch(`${API_URL}/api/account/bookings`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setBookings((await res.json()) as Booking[]);
    } catch {}
    setBookingsLoading(false);
  }, [token]);

  useFocusEffect(useCallback(() => { fetchBookings(); }, [fetchBookings]));

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
          <ActivityIndicator color={color.hull} />
        </View>
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={s.appBar}>
            <Text style={s.appBarTitle}>ACCOUNT</Text>
          </View>
          <View style={s.guestBanner}>
            <Text style={s.guestKicker}>BOOKING AS A GUEST</Text>
            <Text style={s.guestBody}>Keep your tickets on any phone.</Text>
          </View>
          <SignInForm onSignedIn={handleSignedIn} />
          <Text style={s.neverNeed}>YOU NEVER NEED AN ACCOUNT TO BOOK A SEAT.</Text>
          <NotificationSettings pushToken={pushToken} token={token} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.hull} />}>
        <View style={s.appBar}>
          <Text style={s.appBarTitle}>ACCOUNT</Text>
        </View>
        <View style={s.identityBanner}>
          <Text style={s.identityEmail}>{customer?.email}</Text>
          <TouchableOpacity onPress={handleLogout} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.signOut}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>

        <Text style={g.groupLabel}>BOOKING HISTORY</Text>
        {bookingsLoading ? (
          <ActivityIndicator color={color.hull} style={{ marginTop: 24 }} />
        ) : bookings.length === 0 ? (
          <Text style={s.emptyText}>Book a trip and it&rsquo;ll appear here.</Text>
        ) : (
          bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)
        )}

        <NotificationSettings pushToken={pushToken} token={token} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { paddingBottom: 40 },
  appBar: {
    height: 44,
    justifyContent: "center",
    backgroundColor: color.hull,
    paddingHorizontal: space.gutter,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  appBarTitle: { fontFamily: font.monoSemibold, fontSize: 13, letterSpacing: ls(13, tracking.kicker), color: color.white },
  guestBanner: { backgroundColor: color.hull2, padding: space.lg },
  guestKicker: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.kicker), color: color.orangeLight },
  guestBody: { fontFamily: font.sansSemibold, fontSize: 16, color: color.white, marginTop: 4 },
  neverNeed: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.ink3,
    textAlign: "center",
    paddingHorizontal: space.gutter,
    marginTop: 4,
    marginBottom: 8,
  },
  identityBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: color.hull2,
    padding: space.lg,
  },
  identityEmail: { fontFamily: font.sansSemibold, fontSize: 15, color: color.white },
  signOut: { fontFamily: font.monoSemibold, fontSize: 12, letterSpacing: ls(12, tracking.data), color: color.orangeLight },
  emptyText: { fontFamily: font.sans, fontSize: 14, color: color.ink3, paddingHorizontal: space.gutter, paddingVertical: 8 },
});

const b = StyleSheet.create({
  card: { backgroundColor: color.white, borderWidth: 1, borderColor: color.rule, marginHorizontal: space.gutter, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.ruleSoft },
  code: { fontFamily: font.monoSemibold, fontSize: 13, color: color.hull },
  status: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.data) },
  item: { flexDirection: "row", padding: 12, gap: 10 },
  colorDot: { width: 8, height: 8, marginTop: 4 },
  itemBody: { flex: 1 },
  itemVessel: { fontFamily: font.sansBold, fontSize: 14, color: color.hull },
  itemProduct: { fontFamily: font.sans, fontSize: 13, color: color.ink2 },
  itemDate: { fontFamily: font.mono, fontSize: 11, color: color.ink3, marginTop: 2 },
  cardFooter: { borderTopWidth: 1, borderTopColor: color.ruleSoft, paddingHorizontal: 14, paddingVertical: 8, alignItems: "flex-end" },
  total: { fontFamily: font.monoSemibold, fontSize: 13, color: color.hull },
});

const f = StyleSheet.create({
  wrap: { paddingHorizontal: space.gutter, paddingTop: space.lg, gap: 10 },
  label: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.label), color: color.ink3 },
  input: { borderWidth: 1, borderColor: color.disabledBorder, paddingHorizontal: 14, paddingVertical: 12, fontFamily: font.sans, fontSize: 16, color: color.hull },
  otpInput: { fontFamily: font.monoBold, fontSize: 24, letterSpacing: 6, textAlign: "center" },
  error: { fontFamily: font.sansSemibold, fontSize: 13, color: color.orangeInk },
  btn: { backgroundColor: color.orange, paddingVertical: 15, alignItems: "center" },
  btnLoading: { opacity: 0.8 },
  btnText: { fontFamily: font.sansBold, fontSize: 14, letterSpacing: ls(14, tracking.data), color: color.white },
  back: { fontFamily: font.monoSemibold, fontSize: 11, letterSpacing: ls(11, tracking.data), color: color.ink2, textAlign: "center" },
});

const g = StyleSheet.create({
  groupLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.ink2,
    paddingHorizontal: space.gutter,
    paddingTop: space.xl,
    paddingBottom: 8,
  },
  group: { backgroundColor: color.white, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.rule },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.gutter, paddingVertical: 17 },
  rowLabel: { fontFamily: font.sansSemibold, fontSize: 15, color: color.hull },
  rowLabelDisabled: { color: color.disabledBorder },
  rowValue: { fontFamily: font.mono, fontSize: 12, color: color.ink3 },
  subRows: { borderTopWidth: 1, borderTopColor: color.ruleSoft, paddingHorizontal: space.gutter },
  subRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 },
  subRowRule: { borderBottomWidth: 1, borderBottomColor: color.ruleSoft },
  subRowLabel: { fontFamily: font.sans, fontSize: 14, color: color.ink2, flex: 1, marginRight: 12 },
});
