import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          navy: "#0F172A",
          emerald: "#10B981",
          danger: "#EF4444",
          canvas: "#F9FAFB",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgb(15 23 42 / 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
