import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

/**
 * Tickets tab — the offline boarding pass wallet. PRIORITY SCREEN.
 *
 * Design intent: works entirely offline at the dock.
 * Tickets are cached to expo-sqlite on download; no network needed to show QR.
 *
 * TODO:
 * - On first load: fetch /api/bookings for authenticated user, persist to SQLite
 * - Render a flat list of upcoming bookings, grouped by departure date
 * - Each row is pressable → navigates to /boarding/[ticketId] (full-screen QR)
 * - Pull-to-refresh syncs when online; stale cache badge shows last-synced time
 * - Unauthenticated state: prompt to log in / enter booking reference
 */
export default function TicketsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Tickets</Text>
      <Text style={styles.description}>
        Your boarding passes — works offline at the dock.
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
    backgroundColor: Colors.surfaceAlt,
  },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: Colors.inkMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
});
