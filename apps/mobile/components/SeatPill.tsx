import { StyleSheet, Text } from "react-native";
import { font, ls, seatPill, tracking } from "@/constants/nativeTokens";

/** Mirrors SeatPill in apps/web/src/components/SailingsSection.tsx exactly. */
export function SeatPill({ seatsRemaining }: { seatsRemaining: number }) {
  const { label, color } = seatPill(seatsRemaining);
  return <Text style={[s.text, { color }]}>{label}</Text>;
}

const s = StyleSheet.create({
  text: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.data),
  },
});
