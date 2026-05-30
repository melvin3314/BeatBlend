/**
 * Design tokens — Dark Futuristic DJ Theme
 */

export const colors = {
  // Base
  bg: "#0B0E14",
  surface: "#111827",
  surfaceElevated: "#1A2332",
  surfaceGlass: "rgba(17, 24, 39, 0.85)",

  // Borders
  border: "#1E293B",
  borderActive: "#334155",

  // Text
  textPrimary: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",

  // Accents
  accent: "#3B82F6",      // Blue
  accentGlow: "rgba(59, 130, 246, 0.4)",
  secondary: "#8B5CF6",   // Purple
  secondaryGlow: "rgba(139, 92, 246, 0.4)",

  // Energy colors
  energyLow: "#3B82F6",   // Blue
  energyMid: "#F59E0B",   // Amber
  energyHigh: "#EF4444",  // Red

  // States
  success: "#10B981",
  warning: "#FBBF24",
  danger: "#EF4444",

  // Overlays
  overlay: "rgba(0, 0, 0, 0.6)",
  shadow: "rgba(0, 0, 0, 0.3)",

  // Glow helpers
  glowBlue: "rgba(59, 130, 246, 0.15)",
  glowPurple: "rgba(139, 92, 246, 0.15)",
  glowAmber: "rgba(245, 158, 11, 0.12)",
  glowRed: "rgba(239, 68, 68, 0.12)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const typography = {
  caption: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.2 },
  label: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.8 },
  body: { fontSize: 13, fontWeight: "500" as const },
  title: { fontSize: 16, fontWeight: "700" as const },
  headline: { fontSize: 22, fontWeight: "800" as const },
  glow: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.5, textShadowColor: "rgba(59,130,246,0.5)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
};

export type ThemeColors = typeof colors;
