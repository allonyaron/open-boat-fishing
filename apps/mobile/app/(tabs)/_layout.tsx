/* eslint-disable react/prop-types -- prop shapes are enforced by TypeScript below */
import { Tabs, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Rect, Line } from "react-native-svg";
import { BoatGlyph } from "@/components/BoatGlyph";
import { color, font, tracking, ls, size } from "@/constants/nativeTokens";

const ACTIVE = color.orange;
const ACTIVE_INK = color.hull;
const INACTIVE_INK = color.mutedMark;

function TicketsMark({ tint }: { tint: string }) {
  return (
    <Svg width={18} height={11} viewBox="0 0 18 11">
      <Rect x={0.75} y={0.75} width={16.5} height={9.5} rx={0} stroke={tint} strokeWidth={1.5} fill="none" />
      <Line x1={9} y1={0.75} x2={9} y2={10.25} stroke={tint} strokeWidth={1.5} />
    </Svg>
  );
}

function ConditionsMark({ tint }: { tint: string }) {
  return (
    <Svg width={16} height={10} viewBox="0 0 16 10">
      <Circle cx={8} cy={4} r={4} fill={tint} />
      <Rect x={0} y={10 - 2} width={16} height={2} fill={tint} />
    </Svg>
  );
}

function AccountMark({ tint }: { tint: string }) {
  return (
    <Svg width={14} height={12} viewBox="0 0 14 12">
      <Circle cx={7} cy={3.5} r={3.5} fill={tint} />
      <Rect x={0} y={8} width={14} height={4} fill={tint} />
    </Svg>
  );
}

function TabMark({ name, focused }: { name: "book" | "tickets" | "conditions" | "account"; focused: boolean }) {
  const tint = focused ? ACTIVE : INACTIVE_INK;
  if (name === "book") return <BoatGlyph color={tint} />;
  if (name === "tickets") return <TicketsMark tint={tint} />;
  if (name === "conditions") return <ConditionsMark tint={tint} />;
  return <AccountMark tint={tint} />;
}

function TabButton({
  label,
  mark,
  routeName,
  onPress,
}: {
  label: string;
  mark: "book" | "tickets" | "conditions" | "account";
  routeName: string;
  onPress: (e: GestureResponderEvent) => void;
}) {
  // expo-router's Tabs strips the `(tabs)` group segment from the pathname, so
  // the active route resolves to e.g. "/trips". tabBarButton's own
  // `accessibilityState.selected` prop is not reliably populated here, so
  // this reads the route directly instead of trusting that prop.
  const pathname = usePathname();
  const focused = pathname === `/${routeName}` || (routeName === "trips" && pathname === "/");

  return (
    <Pressable style={tb.item} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: focused }}>
      <View style={[tb.topRule, focused && tb.topRuleActive]} />
      <Text style={[tb.label, { color: focused ? ACTIVE_INK : INACTIVE_INK }]}>{label}</Text>
      <View style={tb.markSlot}>
        <TabMark name={mark} focused={focused} />
      </View>
    </Pressable>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: tb.bar,
      }}
    >
      <Tabs.Screen
        name="trips"
        options={{
          tabBarButton: (props) => (
            <TabButton label="BOOK" mark="book" routeName="trips" onPress={(e) => props.onPress?.(e)} />
          ),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          tabBarButton: (props) => (
            <TabButton label="TICKETS" mark="tickets" routeName="tickets" onPress={(e) => props.onPress?.(e)} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          tabBarButton: (props) => (
            <TabButton label="CONDITIONS" mark="conditions" routeName="reports" onPress={(e) => props.onPress?.(e)} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarButton: (props) => (
            <TabButton label="ACCOUNT" mark="account" routeName="account" onPress={(e) => props.onPress?.(e)} />
          ),
        }}
      />
    </Tabs>
  );
}

const tb = StyleSheet.create({
  bar: {
    height: size.tabBar,
    backgroundColor: color.white,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: size.tabActiveRule,
    gap: 4,
  },
  topRule: {
    height: size.tabActiveRule,
    width: "100%",
    backgroundColor: "transparent",
  },
  topRuleActive: {
    backgroundColor: color.orange,
  },
  label: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
  },
  markSlot: {
    height: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
