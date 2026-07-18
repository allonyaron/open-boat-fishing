import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
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
          name="boarding/[ticketId]"
          options={{
            title: 'Boarding Pass',
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  );
}
