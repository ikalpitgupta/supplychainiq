/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Class-based dark variants so `dark:` utilities follow the app's own theme
  // toggle (ThemeProvider syncs the `dark` class on <html>), not the OS.
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Outfit", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Theme tokens — values live in CSS variables (index.css) and flip with
        // [data-theme="dark"]. RGB triplets enable Tailwind's /opacity syntax.
        canvas: "rgb(var(--canvas-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        // Fixed chrome (sidebar, feature cards, ink buttons) — deliberately does
        // NOT flip; it anchors the brand in both themes.
        chrome: {
          DEFAULT: "rgb(var(--chrome-rgb) / <alpha-value>)",
          soft: "rgb(var(--chrome-soft-rgb) / <alpha-value>)",
        },
        brand: {
          50: "#f2effe", 100: "#e7e1fd", 200: "#d1c6fb", 300: "#b3a2f7",
          400: "#9279f0", 500: "#7a5ce8", 600: "#6b46da", 700: "#5a37bd",
          800: "#4b2f9b", 900: "#3f2b7d", 950: "#261a4d",
        },
        lime: {
          50: "#f7fde8", 100: "#eef9cd", 200: "#e3f6a4", 300: "#d6f06e",
          400: "#c9ea3f", 500: "#b5d81e", 600: "#94b414", 700: "#718a14",
          800: "#5a6c17", 900: "#4b5a18",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(10, 12, 6, 0.06), 0 8px 24px -12px rgba(10, 12, 6, 0.14)",
        float: "0 24px 60px -24px rgba(10, 12, 6, 0.32)",
      },
      keyframes: {
        "fade-float": {
          "0%": { opacity: "0", transform: "translateY(26px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "fade-slide-up": {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 10px 24px -8px rgba(37, 99, 235, 0.45)" },
          "50%": { boxShadow: "0 16px 40px -6px rgba(37, 99, 235, 0.75)" },
        },
        // Route transitions: forward pages rise in from below,
        // back-navigation pages slide in from the left (reverse feel).
        "page-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "page-back": {
          "0%": { opacity: "0", transform: "translateX(-18px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        // Premium shine sweep across a surface (used on the glowing logo tile).
        "logo-shine": {
          "0%": { transform: "translateX(-160%) skewX(-18deg)", opacity: "0" },
          "15%": { opacity: "0.85" },
          "55%": { opacity: "0.85" },
          "100%": { transform: "translateX(260%) skewX(-18deg)", opacity: "0" },
        },
      },
      animation: {
        "fade-float": "fade-float 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-slide-up": "fade-slide-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        "glow-pulse": "glow-pulse 2.6s ease-in-out infinite",
        "page-in": "page-in 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
        "page-back": "page-back 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
        "logo-shine": "logo-shine 3.6s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};
