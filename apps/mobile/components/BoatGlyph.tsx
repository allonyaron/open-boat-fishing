import Svg, { Path } from "react-native-svg";

/**
 * Trip-count glyph for the day belt and the BOOK tab mark.
 * Locked at 17×9 — do not scale up, do not add a stroke, do not animate.
 * See design_handoff_trip_count_glyph/README.md.
 */
export function BoatGlyph({ color }: { color: string }) {
  return (
    <Svg width={17} height={9} viewBox="0.4 1.4 25.2 12.2">
      <Path d="M0.6 8.8 H25 L21.9 13 H3.5 Z" fill={color} />
      <Path d="M5.4 4.8 H12.4 V8.8 H5.4 Z" fill={color} />
      <Path
        d="M15 8.4 C17.6 5.2 19.4 3 22.2 2.2 C24.2 1.7 25.3 3.6 25.4 6.2 C25 3.9 24 2.7 22.3 3.2 C20 3.9 18.3 6.2 16.2 9.2 Z"
        fill={color}
      />
    </Svg>
  );
}
