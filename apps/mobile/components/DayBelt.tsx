import { useRef } from "react";
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BoatGlyph } from "@/components/BoatGlyph";
import { color, font, ls, size, tracking } from "@/constants/nativeTokens";

export type TripCountByDate = Record<string, number>;

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The 7 dates (Sun–Sat) of the week containing `dateStr`. */
export function weekDatesFor(dateStr: string): string[] {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay();
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + i);
    return toDateStr(day);
  });
}

/**
 * Shipped web day belt (SailingsSection.tsx), unchanged, at native tap size.
 * Swipe left/right pages by week; the date sheet (frame 02) handles jumps
 * outside the current week.
 */
export function DayBelt({
  weekDates,
  tripCountByDate,
  selectedDate,
  todayStr,
  onSelectDate,
  onSwipeWeek,
}: {
  weekDates: string[];
  tripCountByDate: TripCountByDate;
  selectedDate: string | null;
  todayStr: string;
  onSelectDate: (date: string) => void;
  onSwipeWeek: (direction: 1 | -1) => void;
}) {
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) onSwipeWeek(1);
        else if (g.dx > 40) onSwipeWeek(-1);
      },
    }),
  ).current;

  return (
    <View style={s.grid} {...panResponder.panHandlers}>
      {weekDates.map((dateStr) => {
        const dt = new Date(dateStr + "T12:00:00Z");
        const dow = DOW[dt.getUTCDay()];
        const day = dt.getUTCDate();
        const count = tripCountByDate[dateStr] ?? 0;
        const hasTrips = count > 0;
        const isSelected = selectedDate === dateStr;
        const isPast = dateStr < todayStr;

        return (
          <TouchableOpacity
            key={dateStr}
            style={[s.chip, isSelected && s.chipSelected, !hasTrips && s.chipEmpty]}
            disabled={!hasTrips}
            onPress={() => onSelectDate(dateStr)}
            activeOpacity={0.8}
          >
            <Text style={[s.dow, isSelected && s.dowSelected, isPast && s.textMuted]}>{dow}</Text>
            <Text style={[s.dayNum, isSelected && s.dayNumSelected, !hasTrips && s.textMuted]}>
              {day}
            </Text>
            <View style={s.countRow}>
              {hasTrips && (
                <>
                  <Text style={[s.count, isSelected && s.countSelected]}>{count}</Text>
                  <BoatGlyph color={isSelected ? color.orangeOnOrange : color.ink3} />
                </>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", gap: 2 },
  chip: {
    flex: 1,
    minHeight: size.dayChip,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.rule,
  },
  chipEmpty: { backgroundColor: color.emptyFill },
  chipSelected: { backgroundColor: color.orange, borderColor: color.orange },
  dow: {
    fontFamily: font.monoMedium,
    fontSize: 9,
    letterSpacing: ls(9, tracking.data),
    color: color.ink3,
  },
  dowSelected: { color: color.orangeOnOrange },
  dayNum: {
    fontFamily: font.sansBold,
    fontSize: 19,
    lineHeight: 19,
    color: color.hull,
  },
  dayNumSelected: { color: color.white },
  textMuted: { color: color.ink3 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    height: size.dayChipCountRow,
  },
  count: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    color: color.ink3,
  },
  countSelected: { color: color.orangeOnOrange },
});
