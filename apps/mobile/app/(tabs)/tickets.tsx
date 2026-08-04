import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Colors } from '@/constants/Colors';
import {
  type WalletBooking,
  type WalletBookingItem,
  type WalletTicket,
  getAllBookings,
  upsertBooking,
} from '@/lib/wallet';

// ─── API URL ─────────────────────────────────────────────────────────────────

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(':')[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error('EXPO_PUBLIC_API_URL must be set for production builds');
}
const API_URL = getApiUrl();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ─── AddBookingSheet ──────────────────────────────────────────────────────────

function AddBookingSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (booking: WalletBooking) => void;
}) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 500,
      duration: 220,
      useNativeDriver: true,
    }).start(onClose);
  }, [onClose]);

  const handleFind = useCallback(async () => {
    const cleanCode = code.trim().toUpperCase();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanCode || !cleanEmail) {
      setError('Enter your confirmation code and email.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/bookings?code=${encodeURIComponent(cleanCode)}&email=${encodeURIComponent(cleanEmail)}`
      );
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? 'Booking not found. Check your code and email.');
        return;
      }
      const booking = await upsertBooking(data as Omit<WalletBooking, 'syncedAt'>);
      onAdded(booking);
      dismiss();
    } catch {
      setError('Could not connect to server. Try again when you have signal.');
    } finally {
      setLoading(false);
    }
  }, [code, email, onAdded, dismiss]);

  return (
    <Modal transparent animationType="none" onRequestClose={dismiss}>
      <Pressable style={add.backdrop} onPress={dismiss} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={add.kav}
      >
        <Animated.View style={[add.sheet, { transform: [{ translateY }] }]}>
          <View style={add.handle} />
          <Text style={add.title}>Add Booking</Text>
          <Text style={add.subtitle}>
            Your confirmation code and email are in your booking email.
          </Text>

          <View style={add.fieldGroup}>
            <Text style={add.label}>Confirmation Code</Text>
            <TextInput
              style={add.input}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="e.g. A1B2C3"
              placeholderTextColor={Colors.inkSubtle}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              returnKeyType="next"
            />
          </View>

          <View style={add.fieldGroup}>
            <Text style={add.label}>Email Used at Purchase</Text>
            <TextInput
              style={add.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.inkSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={handleFind}
            />
          </View>

          {error ? <Text style={add.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[add.btn, loading && add.btnLoading]}
            onPress={handleFind}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={add.btnText}>Find My Tickets</Text>
            }
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── TicketRow ────────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  onPress,
}: {
  ticket: WalletTicket;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={tr.row} onPress={onPress} activeOpacity={0.7}>
      <View style={tr.left}>
        <Text style={[tr.type, ticket.voided && tr.typeVoided]}>
          {ticketLabel(ticket.ticketType)}
        </Text>
        {ticket.voided && <Text style={tr.cancelled}>CANCELLED</Text>}
      </View>
      <Text style={tr.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── BookingItemCard ──────────────────────────────────────────────────────────

function BookingItemCard({
  item,
  onTicketPress,
}: {
  item: WalletBookingItem;
  onTicketPress: (ticketId: string) => void;
}) {
  const { trip } = item;
  const isTripCancelled = trip.status === 'cancelled';

  return (
    <View style={[bic.card, isTripCancelled && bic.cardCancelled]}>
      <View style={[bic.colorBar, { backgroundColor: trip.vessel.color }]} />
      <View style={bic.body}>
        <View style={bic.topRow}>
          <Text style={bic.vesselName}>{trip.vessel.name}</Text>
          {isTripCancelled && (
            <View style={bic.cancelBadge}>
              <Text style={bic.cancelBadgeText}>CANCELLED</Text>
            </View>
          )}
        </View>
        <Text style={bic.productName}>{trip.product.displayName}</Text>
        <Text style={bic.time}>
          {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)}
        </Text>
        <View style={bic.divider} />
        {item.tickets.map((t) => (
          <TicketRow
            key={t.id}
            ticket={t}
            onPress={() => onTicketPress(t.id)}
          />
        ))}
      </View>
    </View>
  );
}

// ─── TicketsScreen ────────────────────────────────────────────────────────────

export default function TicketsScreen() {
  const router = useRouter();
  const [bookings, setBookings] = useState<WalletBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const loadFromCache = useCallback(async () => {
    const stored = await getAllBookings();
    setBookings(stored);
  }, []);

  useEffect(() => {
    loadFromCache().finally(() => setLoading(false));
  }, [loadFromCache]);

  // Reload from SQLite whenever the tab gains focus — covers the case where
  // the background wallet sync in checkout.tsx completed after the initial mount.
  useFocusEffect(
    useCallback(() => {
      loadFromCache();
    }, [loadFromCache])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const stored = await getAllBookings();
      const results = await Promise.allSettled(
        stored.map((b) =>
          fetch(
            `${API_URL}/api/bookings?code=${b.confirmationCode}&email=${encodeURIComponent(b.customerEmail)}`
          )
            .then((r) => r.json() as Promise<Omit<WalletBooking, 'syncedAt'>>)
            .then((data) => upsertBooking(data))
        )
      );
      setBookings(
        results.map((r, i) => (r.status === 'fulfilled' ? r.value : stored[i]))
      );
    } catch {
      // keep showing cached data
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Group items by departure date
  const byDate = new Map<string, { item: WalletBookingItem; booking: WalletBooking }[]>();
  for (const booking of bookings) {
    for (const item of booking.items) {
      const d = item.trip.departureDate;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push({ item, booking });
    }
  }
  const sortedDates = [...byDate.keys()].sort();
  const hasTickets = sortedDates.length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.heading}>My Tickets</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={s.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={Colors.teal} size="large" />
        </View>
      ) : !hasTickets ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🎫</Text>
          <Text style={s.emptyTitle}>No tickets yet</Text>
          <Text style={s.emptyBody}>
            After booking, tap Add to save your boarding passes here. They'll work offline at the dock.
          </Text>
          <TouchableOpacity
            style={s.emptyBtn}
            onPress={() => setShowAdd(true)}
            activeOpacity={0.85}
          >
            <Text style={s.emptyBtnText}>Add Booking</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.teal}
            />
          }
        >
          {sortedDates.map((date) => (
            <View key={date}>
              <Text style={s.dateHeader}>{fmtDate(date)}</Text>
              {byDate.get(date)!.map(({ item }) => (
                <BookingItemCard
                  key={item.id}
                  item={item}
                  onTicketPress={(ticketId) =>
                    router.push({ pathname: '/boarding/[ticketId]', params: { ticketId } })
                  }
                />
              ))}
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {showAdd && (
        <AddBookingSheet
          onClose={() => setShowAdd(false)}
          onAdded={(booking) => {
            setBookings((prev) => {
              const idx = prev.findIndex((b) => b.id === booking.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = booking;
                return next;
              }
              return [...prev, booking];
            });
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
  },
  addBtn: {
    backgroundColor: Colors.teal,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 15,
    color: Colors.inkMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.teal,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.inkSubtle,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
});

const bic = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardCancelled: {
    opacity: 0.55,
  },
  colorBar: {
    width: 5,
  },
  body: {
    flex: 1,
    padding: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  vesselName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
  },
  cancelBadge: {
    backgroundColor: Colors.error,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  cancelBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  productName: {
    fontSize: 13,
    color: Colors.inkMuted,
    fontWeight: '500',
    marginBottom: 1,
  },
  time: {
    fontSize: 13,
    color: Colors.inkSubtle,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },
});

const tr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  type: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
  },
  typeVoided: {
    color: Colors.inkSubtle,
    textDecorationLine: 'line-through',
  },
  cancelled: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.error,
    letterSpacing: 0.3,
  },
  chevron: {
    fontSize: 20,
    color: Colors.inkSubtle,
    lineHeight: 24,
  },
});

const add = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  kav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.inkMuted,
    marginBottom: 20,
    lineHeight: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.inkMuted,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  input: {
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.surfaceAlt,
  },
  error: {
    fontSize: 13,
    color: Colors.error,
    marginBottom: 12,
    lineHeight: 18,
  },
  btn: {
    height: 50,
    backgroundColor: Colors.teal,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnLoading: {
    opacity: 0.75,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
