// Open Boat admin console v2 tokens (design_handoff_admin_console_v2/tailwind.tokens.ts),
// merged into theme.extend in tailwind.config.ts.
// Colors resolve to CSS variables defined in src/app/admin/ob-tokens.css, so one class works in
// both themes. The admin layout sets data-ob-theme="console" | "sunlight" on <html>.
//
// Two changes from the handoff file:
// - fontFamily points at the self-hosted next/font variables (--font-archivo,
//   --font-ibm-plex-mono); next/font registers hashed family names, so "Archivo" would not resolve.
// - borderWidth.rule is dropped: `border-rule` is already the public site's rule *color*
//   (SailingsSection), and a same-named width would add 2px borders there. Use `border-2`.
import type { Config } from "tailwindcss";

type ThemeExtend = NonNullable<NonNullable<Config["theme"]>["extend"]>;

const v = (n: string) => `var(--ob-${n})`;

export const obTokens = {
  colors: {
    ob: {
      bg: v("bg"), panel: v("panel"), "panel-2": v("panel-2"),
      hair: v("hair"), rule: v("rule"), control: v("control"),
      ink: v("ink"), "ink-2": v("ink-2"), "ink-3": v("ink-3"),
      key: v("key"), "key-ink": v("key-ink"), "key-hover": v("key-hover"),
      go: v("go"), "go-ink": v("go-ink"), "go-tint": v("go-tint"),
      caution: v("caution"), "caution-ink": v("caution-ink"), "caution-tint": v("caution-tint"),
      alert: v("alert"), "alert-ink": v("alert-ink"), "alert-tint": v("alert-tint"),
      "alert-fill": v("alert-fill"), "alert-fill-hover": v("alert-fill-hover"),
      focus: v("focus"), scrim: v("scrim"),
    },
  },
  fontFamily: {
    ui: ["var(--font-archivo)", "system-ui", "sans-serif"],
    num: ["var(--font-ibm-plex-mono)", "ui-monospace", "monospace"],
  },
  fontSize: {
    // [size, { lineHeight, letterSpacing, fontWeight }]
    "readout-xl": ["52px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "500" }],
    "readout-l": ["36px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "500" }],
    "num-time": ["30px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "500" }],
    "num-gauge": ["26px", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "500" }],
    "title-page": ["32px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "800" }],
    "title-panel": ["20px", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "800" }],
    "title-row": ["18px", { lineHeight: "1.3", fontWeight: "700" }],
    body: ["16px", { lineHeight: "1.45" }],
    "body-sm": ["15px", { lineHeight: "1.45" }],
    meta: ["14px", { lineHeight: "1.4" }], // floor: nothing smaller in the admin
  },
  spacing: { "ob-1": "4px", "ob-2": "8px", "ob-3": "12px", "ob-4": "16px", "ob-5": "20px", "ob-6": "24px", "ob-8": "32px", "ob-12": "48px" },
  minHeight: { "tap-desk": "36px", "tap-dock": "48px", "tap-main": "56px", field: "52px" },
  borderRadius: { ob: "2px", lamp: "1px" },
  boxShadow: { dialog: v("shadow-dialog"), toast: v("shadow-toast"), "glow-go": v("glow-go") },
  keyframes: {
    "ob-pulse": { "0%,100%": { boxShadow: v("glow-go"), opacity: "1" }, "50%": { boxShadow: "0 0 0 0 transparent", opacity: "0.55" } },
    "ob-toast-in": { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
    "ob-shimmer": { "0%,100%": { opacity: ".5" }, "50%": { opacity: "1" } },
  },
  animation: {
    "ob-pulse": "ob-pulse 1.8s ease-in-out infinite",
    "ob-toast-in": "ob-toast-in .2s ease-out",
    // Not in the handoff's tailwind file; 1.4s is what the mockup's loading blocks use.
    "ob-shimmer": "ob-shimmer 1.4s ease-in-out infinite",
  },
} satisfies ThemeExtend;
