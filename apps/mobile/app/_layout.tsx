import { StripeProvider } from "@stripe/stripe-react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts, Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold } from "@expo-google-fonts/archivo";
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold, IBMPlexMono_700Bold } from "@expo-google-fonts/ibm-plex-mono";
import { View } from "react-native";
import { CustomerAuthProvider } from "@/lib/customer-auth-context";
import { Colors } from "@/constants/Colors";
import { color as nativeColor } from "@/constants/nativeTokens";

const STRIPE_PK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const MERCHANT_ID = process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID ?? "";
const URL_SCHEME = process.env.EXPO_PUBLIC_URL_SCHEME ?? "";
const IS_MATE = process.env.EXPO_PUBLIC_APP_VARIANT === "mate";

function AppStack() {
  return (
    <>
      <StatusBar style="light" backgroundColor={Colors.teal} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.teal },
          headerTintColor: Colors.white,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: Colors.surfaceAlt },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(mate)" options={{ headerShown: false }} />
        <Stack.Screen name="reports-list" options={{ title: "Fishing Reports" }} />
        <Stack.Screen name="cart" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="checkout" options={{ headerShown: false }} />
        <Stack.Screen
          name="boarding/[ticketId]"
          options={{ headerShown: false, presentation: "modal" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
  });

  if (IS_MATE) return <AppStack />;
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: nativeColor.deck }} />;

  return (
    <CustomerAuthProvider>
      <StripeProvider
        publishableKey={STRIPE_PK}
        merchantIdentifier={MERCHANT_ID}
        urlScheme={URL_SCHEME}
      >
        <AppStack />
      </StripeProvider>
    </CustomerAuthProvider>
  );
}
