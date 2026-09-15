import type { Config } from "tailwindcss";
import * as tokens from "@openboat/design";

const config: Config = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: tokens.navy,
        gold: tokens.gold,
        teal: tokens.teal,
        amber: tokens.amber,
        ink: tokens.ink,
        muted: tokens.muted,
        faint: tokens.faint,
        surface: tokens.surface,
        fill: tokens.fill,
        hairline: tokens.hairline,
        "card-border": tokens.cardBorder,
        success: tokens.success,
        warning: tokens.warning,
        disabled: tokens.disabled,
        // ── Consumer booking flow design system ──────────────────────────────
        hull: { DEFAULT: "#0d1c26", "2": "#132b39", line: "#3c5867" },
        deck: { DEFAULT: "#eef1f0", "2": "#e6eaea", "3": "#f6f8f8" },
        rule: { DEFAULT: "#cdd6da", soft: "#e3e9eb" },
        "border-input": "#9aa8ae",
        orange: {
          DEFAULT: "#c94510",
          ink: "#b1440f",
          press: "#8c3b12",
          light: "#ff8a5c",
        },
        "ink-2": "#41565f",
        "ink-3": "#5b6f79",
        "ink-dark-2": "#b6c6ce",
        "ink-dark-3": "#8fa3ad",
        "green-open": "#186a4a",
      },
      fontFamily: {
        grotesk: ["var(--font-space-grotesk)", "sans-serif"],
        jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
        manrope: ["var(--font-manrope)", "sans-serif"],
        // Consumer booking flow
        archivo: ["var(--font-archivo)", "Helvetica", "sans-serif"],
        "plex-mono": ["var(--font-ibm-plex-mono)", "monospace"],
      },
      fontSize: {
        "9": "9px",
        "10": "10px",
        "11": "11px",
        "12": "12px",
        "13": "13px",
        "14": "14px",
        "15": "15px",
        "16": "16px",
        "17": "17px",
        "18": "18px",
        "20": "20px",
        "22": "22px",
        "24": "24px",
        "26": "26px",
        "28": "28px",
        "32": "32px",
        "36": "36px",
        "48": "48px",
      },
      borderWidth: {
        "1.5": "1.5px",
      },
      borderRadius: {
        card: "20px",
        btn: "16px",
        pill: "999px",
        badge: "6px",
        icon: "10px",
      },
      spacing: {
        navbar: "60px",
        masthead: "66px",
        logo: "34px",
      },
      letterSpacing: {
        label: "0.08em",
        caps: "0.1em",
      },
      backdropBlur: {
        glass: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,32,31,0.04)",
        "card-selected": "0 14px 30px -14px rgba(201,154,63,0.35)",
        "day-selected": "0 8px 18px -6px rgba(20,35,61,0.4)",
        summary: "0 14px 40px -20px rgba(16,32,31,0.25)",
        hero: "0 20px 60px -10px rgba(20,35,61,0.5)",
        sidebar: "0 10px 30px rgba(20,35,60,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
