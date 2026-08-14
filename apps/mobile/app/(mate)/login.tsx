import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { saveMateToken } from '@/lib/mate-auth';
import { useMateAuth } from '@/lib/mate-auth-context';
import {
  cacheManifest,
  cacheTrips,
  type MateManifest,
  type MateTrip,
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

export default function MateLoginScreen() {
  const router = useRouter();
  const { setAuth } = useMateAuth();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPin = pin.trim();
    if (!cleanEmail || !cleanPin) {
      setError('Enter your email and PIN.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus('Signing in...');

    try {
      const res = await fetch(`${API_URL}/api/mate/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, pin: cleanPin }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? 'Login failed.');
        setLoading(false);
        setStatus(null);
        return;
      }

      const token = data.token as string;
      await saveMateToken(token);

      // Prefetch today's trips and all their manifests into SQLite.
      // This is what makes the app work offline at the dock.
      setStatus('Loading today\'s trips...');
      const localDate = new Date().toLocaleDateString('en-CA');
      const tripsRes = await fetch(`${API_URL}/api/mate/trips?date=${localDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (tripsRes.ok) {
        const trips = await tripsRes.json() as MateTrip[];
        await cacheTrips(trips);

        setStatus(`Loading ${trips.length} manifest${trips.length === 1 ? '' : 's'}...`);
        await Promise.allSettled(
          trips.map(async (trip) => {
            const mRes = await fetch(
              `${API_URL}/api/mate/manifest?tripId=${trip.id}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (mRes.ok) {
              const manifest = await mRes.json() as MateManifest;
              await cacheManifest(trip.id, manifest);
            }
          })
        );
      }

      setAuth(token);
      router.replace('/(mate)');
    } catch {
      setError('Could not connect. Check your network and try again.');
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kav}
      >
        <View style={s.inner}>
          <View style={s.logo}>
            <Text style={s.logoIcon}>⚓</Text>
            <Text style={s.logoTitle}>Mate Check-In</Text>
            <Text style={s.logoSub}>Staff only</Text>
          </View>

          <View style={s.form}>
            <View style={s.fieldGroup}>
              <Text style={s.label}>Email</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="mate@example.com"
                placeholderTextColor={Colors.inkSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                editable={!loading}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.label}>PIN</Text>
              <TextInput
                style={s.input}
                value={pin}
                onChangeText={setPin}
                placeholder="••••"
                placeholderTextColor={Colors.inkSubtle}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={8}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
              />
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.btn, loading && s.btnLoading]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <View style={s.btnRow}>
                  <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  <Text style={s.btnText}>{status ?? 'Loading...'}</Text>
                </View>
              ) : (
                <Text style={s.btnText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.teal,
  },
  kav: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  logo: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoIcon: {
    fontSize: 52,
    marginBottom: 8,
  },
  logoTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  logoSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  form: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 4,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.inkMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
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
  error: {
    fontSize: 13,
    color: Colors.error,
    marginBottom: 10,
    lineHeight: 18,
  },
  btn: {
    height: 52,
    backgroundColor: Colors.teal,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnLoading: {
    opacity: 0.8,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
