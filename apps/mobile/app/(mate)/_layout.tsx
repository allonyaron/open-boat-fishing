import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { MateAuthProvider, useMateAuth } from "@/lib/mate-auth-context";
import { Colors } from "@/constants/Colors";

function MateStack() {
  const { loading } = useMateAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.teal,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.teal },
        headerTintColor: "#FFFFFF",
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: Colors.surfaceAlt },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: "Today's Trips", headerBackVisible: false }} />
      <Stack.Screen name="manifest/[tripId]" options={{ title: "Manifest" }} />
    </Stack>
  );
}

export default function MateLayout() {
  return (
    <MateAuthProvider>
      <MateStack />
    </MateAuthProvider>
  );
}
