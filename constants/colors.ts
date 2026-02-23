const Colors = {
  light: {
    background: "#F8F9FB",
    surface: "#FFFFFF",
    surfaceSecondary: "#F0F2F5",
    text: "#0A1628",
    textSecondary: "#5A6578",
    textTertiary: "#8E99A8",
    tint: "#0B6E99",
    tintLight: "#E8F4F8",
    accent: "#00B4A0",
    accentLight: "#E6F9F6",
    recording: "#E53935",
    recordingLight: "#FFEBEE",
    warning: "#F5A623",
    warningLight: "#FFF8E7",
    border: "#E4E8ED",
    tabIconDefault: "#8E99A8",
    tabIconSelected: "#0B6E99",
    cardShadow: "rgba(10, 22, 40, 0.06)",
    overlay: "rgba(10, 22, 40, 0.5)",
  },
  dark: {
    background: "#0A1118",
    surface: "#141E2A",
    surfaceSecondary: "#1C2836",
    text: "#ECF0F4",
    textSecondary: "#8E99A8",
    textTertiary: "#5A6578",
    tint: "#2EAAD4",
    tintLight: "#0D2A36",
    accent: "#00D4B8",
    accentLight: "#0D2926",
    recording: "#EF5350",
    recordingLight: "#2A1215",
    warning: "#F5A623",
    warningLight: "#2A2210",
    border: "#243040",
    tabIconDefault: "#5A6578",
    tabIconSelected: "#2EAAD4",
    cardShadow: "rgba(0, 0, 0, 0.3)",
    overlay: "rgba(0, 0, 0, 0.7)",
  },
};

export default Colors;

export function useThemeColors(colorScheme: 'light' | 'dark' | null | undefined) {
  return colorScheme === 'dark' ? Colors.dark : Colors.light;
}

