import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#0E7C7B",
          tint: "#E3F0EF",
          hover: "#0B6B6A",
        },
        ink: "#10201F",
        muted: "#56676A",
        faint: "#8A9998",
        surface: "#F4F6F6",
        fill: "#F1F4F3",
        hairline: "#ECEFEE",
        "card-border": "#EAEDEC",
        success: { DEFAULT: "#1F9D6B", bg: "#E7F4EC" },
        warning: { DEFAULT: "#C0392B", bg: "#FBEBEA" },
        disabled: { DEFAULT: "#DCE2E1", text: "#9AA7A6" },
      },
      fontFamily: {
        grotesk: ["var(--font-space-grotesk)", "sans-serif"],
        jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
      },
      borderRadius: {
        card: "20px",
        btn: "16px",
        pill: "999px",
        badge: "6px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,32,31,0.04)",
        "card-selected": "0 14px 30px -14px rgba(14,124,123,0.35)",
        "day-selected": "0 8px 18px -6px rgba(14,124,123,0.5)",
        summary: "0 14px 40px -20px rgba(16,32,31,0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
