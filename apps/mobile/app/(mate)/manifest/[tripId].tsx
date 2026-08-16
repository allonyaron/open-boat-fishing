import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useMateAuth } from '@/lib/mate-auth-context';
import {
  cacheManifest,
  getCachedManifest,
  getLocalCheckedInTickets,
  getUnsyncedCheckIns,
  markCheckInError,
  markCheckInSynced,
  queueCheckIn,
  type MateBooking,
  type MateManifest,
  type MateTicket,
} from '@/lib/mate-store';
import { Colors } from '@/constants/Colors';

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(':')[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error('EXPO_PUBLIC_API_URL must be set for production builds');
}
const API_URL = getApiUrl();

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function ticketLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanResult = {
  kind: 'success' | 'already_checked_in' | 'error';
  message: string;
  name?: string;
};

// ─── ScanResultOverlay ────────────────────────────────────────────────────────

function ScanResultOverlay({ result }: { result: ScanResult }) {
  const bg =
    result.kind === 'success'
      ? '#16A34A'
      : result.kind === 'already_checked_in'
      ? '#D97706'
      : '#EF4444';
  const icon =
    result.kind === 'success' ? '✓' : result.kind === 'already_checked_in' ? '⚠' : '✕';

  return (
    <View style={[ov.wrap, { backgroundColor: bg }]}>
      <Text style={ov.icon}>{icon}</Text>
      {result.name ? <Text style={ov.name}>{result.name}</Text> : null}
      <Text style={ov.msg}>{result.message}</Text>
    </View>
  );
}

// ─── TicketRow ────────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  localCheckedIn,
  onCheckIn,
}: {
  ticket: MateTicket;
  localCheckedIn: boolean;
  onCheckIn: (ticket: MateTicket, method: 'manual') => void;
}) {
  const checkedIn = ticket.checkedIn || localCheckedIn;

  return (
    <View style={[tr.row, ticket.voided && tr.rowVoided]}>
      <View style={tr.left}>
        <Text style={[tr.type, ticket.voided && tr.typeVoided]}>
          {ticketLabel(ticket.ticketType)}
        </Text>
        {ticket.voided && <Text style={tr.cancelledBadge}>VOIDED</Text>}
        {checkedIn && !ticket.voided && (
          <View style={tr.checkedBadge}>
            <Text style={tr.checkedBadgeText}>✓ CHECKED</Text>
          </View>
        )}
      </View>
      {!ticket.voided && !checkedIn && (
        <TouchableOpacity
          style={tr.btn}
          onPress={() => onCheckIn(ticket, 'manual')}
          activeOpacity={0.8}
        >
          <Text style={tr.btnText}>Check In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── BookingCard ──────────────────────────────────────────────────────────────

function BookingCard({
  booking,
  localCheckedIn,
  onCheckIn,
}: {
  booking: MateBooking;
  localCheckedIn: Set<string>;
  onCheckIn: (ticket: MateTicket, booking: MateBooking, method: 'manual') => void;
}) {
  const allChecked = booking.tickets.every(
    (t) => t.voided || t.checkedIn || localCheckedIn.has(t.id)
  );

  return (
    <View style={[bc.card, allChecked && bc.cardChecked]}>
      <View style={bc.header}>
        <Text style={bc.name}>{booking.customerName}</Text>
        <Text style={bc.code}>{booking.confirmationCode}</Text>
      </View>
      {booking.tickets.map((ticket) => (
        <TicketRow
          key={ticket.id}
          ticket={ticket}
          localCheckedIn={localCheckedIn.has(ticket.id)}
          onCheckIn={(t, method) => onCheckIn(t, booking, method)}
        />
      ))}
    </View>
  );
}

// ─── ManifestScreen ───────────────────────────────────────────────────────────

export default function ManifestScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { token } = useMateAuth();
  const navigation = useNavigation();
  const router = useRouter();

  const [manifest, setManifest] = useState<MateManifest | null>(null);
  const [localCheckedIn, setLocalCheckedIn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scanMode, setScanMode] = useState<'none' | 'camera' | 'keyboard'>('none');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [keyboardInput, setKeyboardInput] = useState('');
  const keyboardRef = useRef<TextInput>(null);
  const scanLocked = useRef(false);
  const [capacityUpdating, setCapacityUpdating] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // ─── Load ────────────────────────────────────────────────────────────────────

  const loadManifest = useCallback(async () => {
    if (!tripId) return;
    const cached = await getCachedManifest(tripId);
    if (cached) {
      setManifest(cached);
      // Update header title
      navigation.setOptions({
        title: `${cached.trip.vessel.name} — ${fmtTime(cached.trip.startTime)}`,
      });
    }
    const local = await getLocalCheckedInTickets(tripId);
    setLocalCheckedIn(local);
  }, [tripId, navigation]);

  useEffect(() => {
    loadManifest().finally(() => setLoading(false));
  }, [loadManifest]);

  // ─── Sync ─────────────────────────────────────────────────────────────────

  const syncAndRefresh = useCallback(async () => {
    if (!tripId || !token) return;

    // 1. Flush unsynced queue
    const unsynced = await getUnsyncedCheckIns();
    if (unsynced.length > 0) {
      try {
        const res = await fetch(`${API_URL}/api/mate/checkins`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ events: unsynced }),
        });
        if (res.ok) {
          const data = await res.json() as {
            results: { localId: string; ok: boolean; error?: string }[];
          };
          await Promise.all(
            data.results.map(async (r) => {
              if (r.ok) {
                await markCheckInSynced(r.localId);
              } else if (r.error === 'ticket_not_found' || r.error === 'ticket_voided') {
                await markCheckInError(r.localId, r.error);
              }
            })
          );
        }
      } catch {
        // offline — leave in queue
      }
    }

    // 2. Refresh manifest from server
    try {
      const res = await fetch(
        `${API_URL}/api/mate/manifest?tripId=${tripId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const fresh = await res.json() as MateManifest;
        await cacheManifest(tripId, fresh);
        setManifest(fresh);
      }
    } catch {
      // offline — use cache
    }

    // 3. Reload local checked-in set
    const local = await getLocalCheckedInTickets(tripId);
    setLocalCheckedIn(local);
  }, [tripId, token]);

  useFocusEffect(
    useCallback(() => {
      syncAndRefresh();
    }, [syncAndRefresh])
  );

  // ─── Check-in logic ───────────────────────────────────────────────────────

  const performCheckIn = useCallback(
    async (
      ticket: MateTicket,
      booking: MateBooking,
      method: 'qr' | 'name_search' | 'manual'
    ) => {
      if (!tripId) return;
      if (ticket.voided) return;
      const alreadyChecked = ticket.checkedIn || localCheckedIn.has(ticket.id);
      if (alreadyChecked && method === 'qr') {
        setScanResult({
          kind: 'already_checked_in',
          message: `Already checked in${ticket.checkedInAt ? ` at ${fmtTime(ticket.checkedInAt)}` : ''}`,
          name: booking.customerName ?? undefined,
        });
        return;
      }
      if (alreadyChecked) return;

      const entry = {
        localId: uuid(),
        ticketId: ticket.id,
        tripId,
        method,
        note: null,
        checkedInAt: new Date().toISOString(),
      };

      // Optimistic update
      setLocalCheckedIn((prev) => new Set([...prev, ticket.id]));
      await queueCheckIn(entry);

      if (method === 'qr') {
        setScanResult({
          kind: 'success',
          message: `${ticketLabel(ticket.ticketType)} — CHECKED IN`,
          name: booking.customerName ?? undefined,
        });
      }
    },
    [tripId, localCheckedIn]
  );

  // ─── QR scan handler ──────────────────────────────────────────────────────

  const processQrPayload = useCallback(
    (payload: string) => {
      if (!manifest || scanLocked.current) return;
      scanLocked.current = true;

      const cleaned = payload.trim();
      let matched: { ticket: MateTicket; booking: MateBooking } | null = null;

      for (const booking of manifest.bookings) {
        for (const ticket of booking.tickets) {
          if (ticket.qrPayload === cleaned || ticket.id === cleaned) {
            matched = { ticket, booking };
            break;
          }
        }
        if (matched) break;
      }

      if (!matched) {
        setScanResult({ kind: 'error', message: 'Ticket not found on this trip' });
      } else {
        performCheckIn(matched.ticket, matched.booking, 'qr');
      }

      // Auto-clear result and unlock after 1.5s
      setTimeout(() => {
        setScanResult(null);
        scanLocked.current = false;
      }, 1500);
    },
    [manifest, performCheckIn]
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      processQrPayload(data);
    },
    [processQrPayload]
  );

  const handleKeyboardScan = useCallback(
    ({ nativeEvent: { text } }: { nativeEvent: { text: string } }) => {
      setKeyboardInput('');
      processQrPayload(text);
      // Re-focus immediately after submit
      setTimeout(() => keyboardRef.current?.focus(), 50);
    },
    [processQrPayload]
  );

  const openCameraMode = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setScanMode('camera');
  }, [cameraPermission, requestCameraPermission]);

  const openKeyboardMode = useCallback(() => {
    setScanMode('keyboard');
    setTimeout(() => keyboardRef.current?.focus(), 100);
  }, []);

  const closeScanMode = useCallback(() => {
    setScanMode('none');
    setScanResult(null);
    scanLocked.current = false;
    setKeyboardInput('');
  }, []);

  // ─── Capacity adjustment ──────────────────────────────────────────────────

  const adjustCapacity = useCallback(async (delta: 1 | -1) => {
    if (!manifest || !tripId || !token || capacityUpdating) return;
    const newCapacity = manifest.trip.capacity + delta;
    setCapacityUpdating(true);
    // Optimistic update
    setManifest((prev) =>
      prev ? {
        ...prev,
        trip: {
          ...prev.trip,
          capacity: newCapacity,
          seatsRemaining: Math.max(0, prev.trip.seatsRemaining + delta),
        },
      } : prev
    );
    try {
      const res = await fetch(`${API_URL}/api/mate/trips/${tripId}/capacity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ capacity: newCapacity }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        Alert.alert('Cannot adjust capacity', data.error ?? 'Unknown error');
        // Revert optimistic update
        setManifest((prev) =>
          prev ? {
            ...prev,
            trip: {
              ...prev.trip,
              capacity: manifest.trip.capacity,
              seatsRemaining: manifest.trip.seatsRemaining,
            },
          } : prev
        );
      }
    } catch {
      Alert.alert('Offline', 'Capacity change requires a network connection.');
      setManifest((prev) =>
        prev ? {
          ...prev,
          trip: {
            ...prev.trip,
            capacity: manifest.trip.capacity,
            seatsRemaining: manifest.trip.seatsRemaining,
          },
        } : prev
      );
    } finally {
      setCapacityUpdating(false);
    }
  }, [manifest, tripId, token, capacityUpdating]);

  // ─── Filter passengers ────────────────────────────────────────────────────

  const filteredBookings = useMemo(() => {
    if (!manifest) return [];
    if (!search.trim()) return manifest.bookings;
    const q = search.toLowerCase();
    return manifest.bookings.filter(
      (b) =>
        (b.customerName ?? '').toLowerCase().includes(q) ||
        b.confirmationCode.toLowerCase().includes(q)
    );
  }, [manifest, search]);

  const totalTickets = manifest?.bookings.reduce((n, b) => n + b.tickets.filter(t => !t.voided).length, 0) ?? 0;
  const totalChecked = manifest?.bookings.reduce(
    (n, b) => n + b.tickets.filter((t) => !t.voided && (t.checkedIn || localCheckedIn.has(t.id))).length,
    0
  ) ?? 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <ActivityIndicator color={Colors.teal} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!manifest) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <Text style={s.emptyTitle}>Manifest not cached</Text>
          <Text style={s.emptyBody}>Connect to network to load this trip.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* ── Trip summary bar ── */}
      <View style={[s.tripBar, { borderLeftColor: manifest.trip.vessel.color }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.tripBarText}>
            {manifest.trip.vessel.name} · {manifest.trip.product.displayName}
          </Text>
          <Text style={s.tripBarCount}>
            {totalChecked}/{totalTickets} checked in
          </Text>
        </View>
        {(manifest.trip.status === 'sailed' || manifest.trip.status === 'pending_settlement') && (
          <TouchableOpacity
            style={s.reportBtn}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push({ pathname: '/(mate)/report/[tripId]' as any, params: { tripId: tripId! } })}
            activeOpacity={0.8}
          >
            <Text style={s.reportBtnText}>Post Report</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Capacity controls (only when certificateCapacity is configured) ── */}
      {manifest.trip.vessel.certificateCapacity !== null && (
        <View style={s.capacityBar}>
          <View style={s.capacityInfo}>
            <Text style={s.capacityLabel}>Capacity</Text>
            <Text style={s.capacityNumbers}>
              {manifest.trip.capacity} listed · {manifest.trip.vessel.certificateCapacity} certified
            </Text>
          </View>
          <View style={s.capacityBtns}>
            <TouchableOpacity
              style={[s.capBtn, (manifest.trip.capacity <= totalTickets || capacityUpdating) && s.capBtnDisabled]}
              onPress={() => adjustCapacity(-1)}
              disabled={manifest.trip.capacity <= totalTickets || capacityUpdating}
              activeOpacity={0.7}
            >
              <Text style={s.capBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.capBtn, (manifest.trip.capacity >= manifest.trip.vessel.certificateCapacity || capacityUpdating) && s.capBtnDisabled]}
              onPress={() => adjustCapacity(1)}
              disabled={manifest.trip.capacity >= manifest.trip.vessel.certificateCapacity || capacityUpdating}
              activeOpacity={0.7}
            >
              <Text style={s.capBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Search bar + scan buttons ── */}
      <View style={s.controls}>
        <TextInput
          style={s.searchInput}
          placeholder="Search by name or code..."
          placeholderTextColor={Colors.inkSubtle}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <View style={s.scanBtns}>
          <TouchableOpacity
            style={[s.scanBtn, scanMode === 'camera' && s.scanBtnActive]}
            onPress={scanMode === 'camera' ? closeScanMode : openCameraMode}
            activeOpacity={0.8}
          >
            <Text style={[s.scanBtnText, scanMode === 'camera' && s.scanBtnTextActive]}>
              📷 Camera
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scanBtn, scanMode === 'keyboard' && s.scanBtnActive]}
            onPress={scanMode === 'keyboard' ? closeScanMode : openKeyboardMode}
            activeOpacity={0.8}
          >
            <Text style={[s.scanBtnText, scanMode === 'keyboard' && s.scanBtnTextActive]}>
              ⌨ Keyboard
            </Text>
          </TouchableOpacity>
        </View>
        {scanMode === 'keyboard' && (
          <Text style={s.keyboardHint}>Keyboard scan active — aim scanner at QR code</Text>
        )}
      </View>

      {/* ── Passenger list ── */}
      <FlatList
        data={filteredBookings}
        keyExtractor={(b) => b.id}
        renderItem={({ item: booking }) => (
          <BookingCard
            booking={booking}
            localCheckedIn={localCheckedIn}
            onCheckIn={(ticket, b, method) => performCheckIn(ticket, b, method)}
          />
        )}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <View style={s.centered}>
            <Text style={s.emptyBody}>No passengers match your search.</Text>
          </View>
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* ── Hidden TextInput for Bluetooth/USB keyboard scanner (Tera HW0002) ── */}
      {scanMode === 'keyboard' && (
        <TextInput
          ref={keyboardRef}
          style={s.hiddenInput}
          value={keyboardInput}
          onChangeText={setKeyboardInput}
          onSubmitEditing={handleKeyboardScan}
          blurOnSubmit={false}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          onBlur={() => {
            // Re-focus on blur so the scanner always has a target
            setTimeout(() => keyboardRef.current?.focus(), 50);
          }}
        />
      )}

      {/* ── Camera scan modal ── */}
      <Modal
        visible={scanMode === 'camera'}
        animationType="slide"
        onRequestClose={closeScanMode}
      >
        <SafeAreaView style={cam.container}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />

          {/* Scan overlay result */}
          {scanResult ? (
            <ScanResultOverlay result={scanResult} />
          ) : (
            <View style={cam.reticle}>
              <View style={cam.reticleBox} />
              <Text style={cam.reticleHint}>Point camera at boarding pass QR</Text>
            </View>
          )}

          <TouchableOpacity style={cam.closeBtn} onPress={closeScanMode}>
            <Text style={cam.closeBtnText}>✕  Done</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* ── Keyboard mode result overlay (appears over list) ── */}
      {scanMode === 'keyboard' && scanResult ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ScanResultOverlay result={scanResult} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginBottom: 8 },
  emptyBody: { fontSize: 15, color: Colors.inkMuted, textAlign: 'center' },

  tripBar: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripBarText: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  tripBarCount: { fontSize: 14, fontWeight: '700', color: Colors.teal },
  reportBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 10,
  },
  reportBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  capacityBar: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  capacityInfo: { flex: 1 },
  capacityLabel: { fontSize: 11, fontWeight: '700', color: Colors.inkSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  capacityNumbers: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  capacityBtns: { flexDirection: 'row', gap: 8 },
  capBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capBtnDisabled: { borderColor: Colors.border, opacity: 0.4 },
  capBtnText: { fontSize: 20, fontWeight: '700', color: Colors.teal, lineHeight: 24 },

  controls: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  searchInput: {
    height: 40,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: Colors.ink,
    backgroundColor: Colors.surfaceAlt,
  },
  scanBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  scanBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  scanBtnActive: {
    borderColor: Colors.teal,
    backgroundColor: Colors.teal + '18',
  },
  scanBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.inkMuted,
  },
  scanBtnTextActive: {
    color: Colors.teal,
  },
  keyboardHint: {
    fontSize: 12,
    color: Colors.teal,
    fontWeight: '600',
    textAlign: 'center',
  },

  listContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 32,
  },

  // Hidden TextInput that captures Bluetooth scanner keyboard input
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    bottom: 0,
    left: 0,
    opacity: 0,
  },
});

const bc = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardChecked: {
    borderColor: Colors.success + '55',
    backgroundColor: '#F0FDF4',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  name: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  code: { fontSize: 13, color: Colors.inkSubtle, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

const tr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowVoided: { opacity: 0.45 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  type: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  typeVoided: { color: Colors.inkSubtle, textDecorationLine: 'line-through' },
  cancelledBadge: {
    fontSize: 11, fontWeight: '700', color: Colors.error, letterSpacing: 0.3,
  },
  checkedBadge: {
    backgroundColor: Colors.success + '22',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  checkedBadgeText: {
    fontSize: 11, fontWeight: '700', color: Colors.success, letterSpacing: 0.3,
  },
  btn: {
    backgroundColor: Colors.teal,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

const cam = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  reticle: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  reticleBox: {
    width: 220,
    height: 220,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  reticleHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

const ov = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  icon: { fontSize: 32, color: '#fff', marginBottom: 4 },
  name: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 2 },
  msg: { fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
});
