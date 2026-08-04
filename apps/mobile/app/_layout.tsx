import { StripeProvider } from '@stripe/stripe-react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const STRIPE_PK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const MERCHANT_ID = process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID ?? '';
const URL_SCHEME = process.env.EXPO_PUBLIC_URL_SCHEME ?? '';

export default function RootLayout() {
  return (
    <StripeProvider
      publishableKey={STRIPE_PK}
      merchantIdentifier={MERCHANT_ID}
      urlScheme={URL_SCHEME}
    >
      <>
        <StatusBar style="light" backgroundColor="#0E7C7B" />
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: '#0E7C7B',
            },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: {
              fontWeight: '700',
            },
            contentStyle: {
              backgroundColor: '#F4F8F8',
            },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="checkout"
            options={{
              title: 'Checkout',
            }}
          />
          <Stack.Screen
            name="boarding/[ticketId]"
            options={{
              title: 'Boarding Pass',
              presentation: 'modal',
            }}
          />
        </Stack>
      </>
    </StripeProvider>
  );
}
