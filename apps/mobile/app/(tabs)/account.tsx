import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

/**
 * Account tab — customer profile and booking history.
 *
 * TODO:
 * - Email-based login (magic link via Resend, token stored in expo-secure-store)
 * - Booking history list (past trips)
 * - Notification preferences (trip reminders via push)
 * - Log out action
 */
export default function AccountScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Account</Text>
      <Text style={styles.description}>
        Manage your profile, booking history, and notification preferences.
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
