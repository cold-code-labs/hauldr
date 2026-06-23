import type { Config } from "tailwindcss";
import yggdrasil from "@cold-code-labs/yggdrasil-react/tailwind";

export default {
  presets: [yggdrasil],
  // The panel has its own hand-rolled console CSS; Tailwind only supplies
  // utilities for the yggdrasil-react primitives. Disable Preflight so it
  // doesn't reset the existing styles.
  corePlugins: { preflight: false },
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./node_modules/@cold-code-labs/yggdrasil-react/src/**/*.{ts,tsx}",
    "./node_modules/.pnpm/**/@cold-code-labs/yggdrasil-react/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
