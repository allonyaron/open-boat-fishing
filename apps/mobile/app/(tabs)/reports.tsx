import React, { useEffect, useState } from "react";
import { Image, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { API_URL } from "@/lib/api";
import { color, font, tracking, ls, space } from "@/constants/nativeTokens";

/**
 * Frame 08 · Conditions. Wind/swell/water/tide are stub data — no weather
 * or tide provider is wired into this repo yet. The layout and thresholds
 * are real; the numbers are not. Replace CONDITIONS_FIXTURE with a live
 * source before launch.
 */
const CONDITIONS_FIXTURE = {
  advisory: null as null | { headline: string; window: string },
  wind: { value: "12", unit: "KT", sub: "NW, GUSTS 18", warn: false },
  swell: { value: "2–3", unit: "FT", sub: "MODERATE", warn: false },
  water: { value: "64", unit: "°F", sub: "FLUKE ON", warn: false, positive: true },
  tide: [
    { label: "HIGH", time: "5:42 AM" },
    { label: "LOW", time: "11:58 AM" },
    { label: "HIGH", time: "6:07 PM" },
  ],
  dockPhone: "(631) 555-1234",
};

type FishCount = { species: string; count: number };
type ReportItem = {
  id: string;
  catchSummary: string | null;
  fishCounts: FishCount[];
  photoUrls: string[];
  departureDate: string;
  vesselName: string;
  vesselColor: string;
};

function StatTile({ label, value, unit, sub, warn, positive }: { label: string; value: string; unit: string; sub: string; warn?: boolean; positive?: boolean }) {
  return (
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>
        {value}
        <Text style={s.statUnit}> {unit}</Text>
      </Text>
      <Text style={[s.statSub, warn && s.statSubWarn, positive && s.statSubPositive]}>{sub}</Text>
    </View>
  );
}

export default function ConditionsScreen() {
  const router = useRouter();
  const [alertsOn, setAlertsOn] = useState(true);
  const [latestReport, setLatestReport] = useState<ReportItem | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/reports`)
      .then((r) => r.json())
      .then((data: { items?: ReportItem[] }) => setLatestReport(data.items?.[0] ?? null))
      .catch(() => {});
  }, []);

  const advisory = CONDITIONS_FIXTURE.advisory;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.appBar}>
        <Text style={s.appBarTitle}>CONDITIONS</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {advisory && (
          <View style={s.advisoryBand}>
            <View style={s.advisoryMark} />
            <View style={{ flex: 1 }}>
              <Text style={s.advisoryHeadline}>
                {advisory.headline} · {advisory.window}
              </Text>
              <Text style={s.advisoryBody}>
                The captain calls it at 5:00 AM — you&rsquo;ll get a push either way.
              </Text>
            </View>
          </View>
        )}

        <View style={s.statRow}>
          <StatTile label="WIND" {...CONDITIONS_FIXTURE.wind} />
          <StatTile label="SWELL" {...CONDITIONS_FIXTURE.swell} />
          <StatTile label="WATER" {...CONDITIONS_FIXTURE.water} />
        </View>

        <Text style={s.sectionKicker}>TIDE</Text>
        <View style={s.tideTable}>
          {CONDITIONS_FIXTURE.tide.map((row, i) => (
            <View key={i} style={[s.tideRow, i > 0 && s.tideRowRule]}>
              <Text style={s.tideLabel}>{row.label}</Text>
              <Text style={s.tideTime}>{row.time}</Text>
            </View>
          ))}
        </View>

        <Text style={s.policyNote}>
          Trips are cancelled for forecast severe weather or rough seas — never for rain. If the
          weather looks questionable, call {CONDITIONS_FIXTURE.dockPhone} to confirm.
        </Text>

        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>WEATHER ALERTS</Text>
            <Text style={s.toggleSub}>Push when the captain calls a trip.</Text>
          </View>
          <Switch
            value={alertsOn}
            onValueChange={setAlertsOn}
            trackColor={{ false: color.disabledFill, true: color.orange }}
            thumbColor={color.white}
          />
        </View>

        <TouchableOpacity
          style={s.reportCard}
          activeOpacity={0.85}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPress={() => router.push("/reports-list" as any)}
        >
          <Text style={s.reportKicker}>FISHING REPORT</Text>
          {latestReport ? (
            <>
              <Text style={s.reportVessel}>{latestReport.vesselName}</Text>
              {latestReport.catchSummary && (
                <Text style={s.reportSummary} numberOfLines={2}>
                  {latestReport.catchSummary}
                </Text>
              )}
              {latestReport.photoUrls[0] && (
                <Image source={{ uri: latestReport.photoUrls[0] }} style={s.reportPhoto} />
              )}
            </>
          ) : (
            <Text style={s.reportSummary}>Check back after the next trip.</Text>
          )}
          <Text style={s.reportLink}>ALL REPORTS →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.deck },
  appBar: {
    height: 44,
    backgroundColor: color.hull,
    justifyContent: "center",
    paddingHorizontal: space.gutter,
    borderBottomWidth: 3,
    borderBottomColor: color.orange,
  },
  appBarTitle: {
    fontFamily: font.monoSemibold,
    fontSize: 13,
    letterSpacing: ls(13, tracking.kicker),
    color: color.white,
  },
  scroll: { padding: space.gutter, gap: space.lg, paddingBottom: 40 },
  advisoryBand: {
    flexDirection: "row",
    gap: space.sm,
    backgroundColor: color.orange,
    padding: space.md,
  },
  advisoryMark: {
    width: 14,
    height: 14,
    backgroundColor: color.white,
    marginTop: 2,
  },
  advisoryHeadline: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.caps),
    color: color.white,
  },
  advisoryBody: {
    fontFamily: font.sans,
    fontSize: 13,
    color: color.orangeOnOrange,
    marginTop: 4,
    lineHeight: 18,
  },
  statRow: {
    flexDirection: "row",
    gap: 1,
    backgroundColor: color.rule,
  },
  statTile: {
    flex: 1,
    backgroundColor: color.white,
    padding: space.sm,
    gap: 2,
  },
  statLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 10,
    letterSpacing: ls(10, tracking.label),
    color: color.ink3,
  },
  statValue: {
    fontFamily: font.sansBold,
    fontSize: 24,
    color: color.hull,
  },
  statUnit: {
    fontFamily: font.sans,
    fontSize: 12,
    color: color.ink3,
  },
  statSub: {
    fontFamily: font.mono,
    fontSize: 11,
    color: color.ink3,
  },
  statSubWarn: { color: color.orangePress },
  statSubPositive: { color: color.greenOpen },
  sectionKicker: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.ink2,
  },
  tideTable: {
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.rule,
  },
  tideRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  tideRowRule: {
    borderTopWidth: 1,
    borderTopColor: color.ruleSoft,
  },
  tideLabel: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.hull,
  },
  tideTime: {
    fontFamily: font.mono,
    fontSize: 12,
    color: color.ink2,
  },
  policyNote: {
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 19,
    color: color.ink2,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.rule,
    paddingTop: space.lg,
  },
  toggleLabel: {
    fontFamily: font.sansSemibold,
    fontSize: 14,
    color: color.hull,
  },
  toggleSub: {
    fontFamily: font.mono,
    fontSize: 12,
    color: color.ink3,
    marginTop: 2,
  },
  reportCard: {
    backgroundColor: color.hull,
    padding: space.lg,
    gap: 6,
  },
  reportKicker: {
    fontFamily: font.monoSemibold,
    fontSize: 11,
    letterSpacing: ls(11, tracking.kicker),
    color: color.orangeLight,
  },
  reportVessel: {
    fontFamily: font.sansBold,
    fontSize: 18,
    color: color.white,
  },
  reportSummary: {
    fontFamily: font.sans,
    fontSize: 14,
    color: color.inkOnDark3,
    lineHeight: 19,
  },
  reportPhoto: {
    width: "100%",
    height: 120,
    backgroundColor: color.hull2,
  },
  reportLink: {
    fontFamily: font.monoSemibold,
    fontSize: 12,
    letterSpacing: ls(12, tracking.data),
    color: color.orangeLight,
    marginTop: 4,
  },
});
