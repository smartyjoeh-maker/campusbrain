import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#15221f",
        forest: "#155e4b",
        mint: "#dff1e9",
        paper: "#f7f8f4",
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "sans-serif"],
      },
      boxShadow: {
        soft: "0 18px 50px rgba(20, 45, 37, .08)",
      },
    },
  },
  plugins: [],
};

export default config;
