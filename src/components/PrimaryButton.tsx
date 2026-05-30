import { StyleSheet, Text, TouchableOpacity } from "react-native";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: "neutral" | "accent";
};

export const PrimaryButton = ({ label, onPress, variant = "neutral" }: PrimaryButtonProps) => {
  return (
    <TouchableOpacity
      style={[styles.button, variant === "accent" ? styles.accent : styles.neutral]}
      onPress={() => void onPress()}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  neutral: {
    backgroundColor: "#374151",
  },
  accent: {
    backgroundColor: "#7C3AED",
  },
  buttonText: {
    color: "#F9FAFB",
    fontWeight: "600",
  },
});
