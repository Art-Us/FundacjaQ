import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    // Scans the whole src tree (not just pages/components/app) — utility
    // classes built as string literals in src/lib (e.g. resourceLabels.ts's
    // per-group/per-status badge colors) were being silently dropped from
    // the compiled CSS whenever that exact class string didn't happen to
    // also appear verbatim in an already-scanned .tsx file.
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
    },
  },
  plugins: [],
};
export default config;
