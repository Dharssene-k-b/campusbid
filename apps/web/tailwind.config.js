/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f4ef",
        ink: "#1d332c",
        forest: "#1e4d3c",
        mint: "#dce9df",
        sun: "#ef9c55",
        line: "#deded4"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Georgia", "ui-serif", "serif"]
      },
      boxShadow: {
        card: "0 10px 28px rgba(29, 51, 44, 0.06)"
      }
    }
  },
  plugins: []
};
