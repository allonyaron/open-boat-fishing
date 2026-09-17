import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { color, font, ls, tracking } from "@/constants/nativeTokens";

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function DateSheet({
  visible,
  onClose,
  year,
  month, // 0-indexed
  tripCountByDate,
  todayStr,
  onPrevMonth,
  onNextMonth,
  onCommit,
}: {
  visible: boolean;
  onClose: () => void;
  year: number;
  month: number;
  tripCountByDate: Record<string, number>;
  todayStr: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onCommit: (date: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  // Reset the in-sheet selection each time it opens, and when the month
  // changes underneath it — a picked day from a different month/visit
  // must never linger behind a stale commit-button label.
  useEffect(() => {
    if (!visible) setPicked(null);
  }, [visible]);
  useEffect(() => {
    setPicked(null);
  }, [year, month]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dayLabel = picked
    ? new Date(picked + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()
    : null;
  const pickedCount = picked ? tripCountByDate[picked] ?? 0 : 0;

  return (
    <Sheet visible={visible} detent={0.66} onClose={onClose}>
      <View style={s.header}>
        <Text style={s.title}>PICK A DATE</Text>
        <TouchableOpacity onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeText}>CLOSE</Text>
        </TouchableOpacity>
      </View>

      <View style={s.monthNav}>
        <TouchableOpacity onPress={onPrevMonth} style={s.navBtn}>
          <Text style={s.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.monthLabel}>{MONTHS[month]} {year}</Text>
        <TouchableOpacity onPress={onNextMonth} style={s.navBtn}>
          <Text style={s.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={s.dowRow}>
        {DOW.map((d, i) => (
          <Text key={i} style={s.dowText}>{d}</Text>
        ))}
      </View>

      <View style={s.grid}>
        {cells.map((date, i) => {
          if (!date) return <View key={`e${i}`} style={s.cell} />;
          const isPast = date < todayStr;
          const hasTrips = (tripCountByDate[date] ?? 0) > 0;
          const isSelected = date === picked;
          return (
            <TouchableOpacity
              key={date}
              style={s.cell}
              disabled={isPast || !hasTrips}
              onPress={() => setPicked(date)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  s.cellInner,
                  isSelected && s.cellSelected,
                  isPast && s.cellPast,
                  !hasTrips && !isPast && s.cellEmpty,
                ]}
              >
                <Text
                  style={[
                    s.cellNum,
                    isSelected && s.cellNumSelected,
                    isPast && s.cellNumPast,
                    !hasTrips && !isPast && s.cellNumEmpty,
                  ]}
                >
                  {parseInt(date.slice(-2), 10)}
                </Text>
              </View>
              {hasTrips && !isPast && (
                <View style={[s.dot, isSelected && s.dotSelected]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: color.hull }]} />
          <Text style={s.legendText}>SAILING</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: color.emptyFill }]} />
          <Text style={s.legendText}>NOTHING SAILS</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: color.pastFill }]} />
          <Text style={s.legendText}>PAST</Text>
        </View>
      </View>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.commitBtn, !picked && s.commitBtnDisabled]}
          disabled={!picked}
          onPress={() => picked && onCommit(picked)}
          activeOpacity={0.85}
        >
          <Text style={s.commitText}>
            {picked
              ? `SHOW ${pickedCount} SAILING${pickedCount === 1 ? "" : "S"} · ${dayLabel} →`
              : "PICK A DAY WITH SAILINGS"}
          </Text>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontFamily: font.sansBold,
    fontSize: 18,
    color: color.hull,
  },
  closeBtn: { padding: 4 },
  closeText: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.label),
    color: color.ink2,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  navArrow: { fontSize: 20, color: color.hull },
  monthLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 13,
    letterSpacing: ls(13, tracking.caps),
    color: color.hull,
  },
  dowRow: { flexDirection: "row", paddingHorizontal: 16 },
  dowText: {
    flex: 1,
    textAlign: "center",
    fontFamily: font.mono,
    fontSize: 10,
    color: color.inkOnDark3,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  cell: {
    width: `${100 / 7}%` as unknown as number,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  cellInner: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  cellSelected: { backgroundColor: color.hull },
  cellPast: { backgroundColor: color.pastFill },
  cellEmpty: { backgroundColor: color.emptyFill },
  cellNum: { fontFamily: font.sansSemibold, fontSize: 14, color: color.hull },
  cellNumSelected: { color: color.white },
  cellNumPast: { color: color.pastInk },
  cellNumEmpty: { color: color.ink3 },
  dot: { width: 4, height: 4, backgroundColor: color.hull },
  dotSelected: { backgroundColor: color.inkOnDark3 },
  legend: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 5, height: 5 },
  legendSwatch: { width: 10, height: 10 },
  legendText: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.ink3,
  },
  footer: { padding: 16, paddingTop: 14 },
  commitBtn: {
    height: 52,
    backgroundColor: color.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  commitBtnDisabled: { backgroundColor: color.disabledFill },
  commitText: {
    fontFamily: font.sansBold,
    fontSize: 14,
    letterSpacing: ls(14, tracking.data),
    color: color.white,
    textTransform: "uppercase",
  },
});
