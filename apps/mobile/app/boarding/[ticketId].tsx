import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/Colors';

/**
 * Boarding pass detail screen — offline wallet view.
 *
 * Opened from the Tickets tab when a passenger taps a ticket row.
 * Presented as a modal over the tab bar (see _layout.tsx).
 *
 * TODO:
 * - Load ticket from SQLite by ticketId (offline-first, no network required)
 * - Render large QR code (expo-barcode-generator or react-native-qrcode-svg)
 * - Header: boat name, color-coded per vessel
 * - Body: trip type, date, departure + return time, "Purchased By" name
 * - Footer: ticket ID string, last-synced timestamp
 * - Full-screen brightness boost on mount (keep QR scannable at the gangway)
 */
export default function BoardingPassScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Boarding Pass</Text>
      <Text style={styles.ticketId}>Ticket: {ticketId}</Text>
      <Text style={styles.description}>
        QR code and trip details display here — works offline at the dock.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Colors.surface,
  },
  heading: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  ticketId: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.inkSubtle,
    fontVariant: ['tabular-nums'],
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: Colors.inkMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
