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
      },
      fontFamily: {
        grotesk: ["var(--font-space-grotesk)", "sans-serif"],
        jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
        manrope: ["var(--font-manrope)", "sans-serif"],
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
