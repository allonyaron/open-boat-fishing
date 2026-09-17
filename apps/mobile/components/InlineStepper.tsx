import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { color, font, size } from "@/constants/nativeTokens";

/** Enlarged for touch per frame 03: 52px wide buttons, 48px tall (web is 45×46). */
export function InlineStepper({
  value,
  onDec,
  onInc,
  atMax,
  decLabel,
  incLabel,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  atMax: boolean;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <View style={s.wrap}>
      <TouchableOpacity
        style={[s.btn, s.btnLeft, value === 0 && s.btnDisabled]}
        onPress={onDec}
        disabled={value === 0}
        accessibilityLabel={decLabel}
        hitSlop={{ top: 8, bottom: 8 }}
      >
        <Text style={s.btnText}>−</Text>
      </TouchableOpacity>
      <View style={s.value}>
        <Text style={s.valueText}>{value}</Text>
      </View>
      <TouchableOpacity
        style={[s.btn, s.btnRight, atMax && s.btnDisabled]}
        onPress={onInc}
        disabled={atMax}
        accessibilityLabel={incLabel}
        hitSlop={{ top: 8, bottom: 8 }}
      >
        <Text style={s.btnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "stretch" },
  btn: {
    width: size.stepperButton,
    height: size.stepperHeight,
    backgroundColor: color.hull,
    alignItems: "center",
    justifyContent: "center",
  },
  btnLeft: { borderRightWidth: 1, borderRightColor: color.hullLine },
  btnRight: { borderLeftWidth: 1, borderLeftColor: color.hullLine },
  btnDisabled: { backgroundColor: color.disabledBorder },
  btnText: { color: color.white, fontSize: 20, fontWeight: "600" },
  value: {
    minWidth: 46,
    height: size.stepperHeight,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hull,
  },
  valueText: { fontFamily: font.monoSemibold, fontSize: 16, color: color.hull },
});
