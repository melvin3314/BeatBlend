import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import 'react-native-reanimated';
import PerfOverlay from "./src/devtools/PerfOverlay";
import { GenerateMixScreen } from "./src/screens/GenerateMixScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { MultiTrackMixScreen } from "./src/screens/MultiTrackMixScreen";

export default function App() {
  const [screen, setScreen] = useState<"home" | "mix" | "multi_mix">("home");
  const [mixTracks, setMixTracks] = useState<{ uri: string; name: string }[]>([]);

  return (
    <>
      {__DEV__ && <PerfOverlay />}
      {screen === "home" && (
        <HomeScreen
          onOpenMixScreen={(tracks: { uri: string; name: string }[]) => {
            setMixTracks(tracks);
            setScreen("mix");
          }}
          onOpenMultiMixScreen={(tracks: { uri: string; name: string }[]) => {
            setMixTracks(tracks);
            setScreen("multi_mix");
          }}
        />
      )}
      {screen === "mix" && (
        <GenerateMixScreen
          tracks={mixTracks}
          onClose={() => setScreen("home")}
        />
      )}
      {screen === "multi_mix" && (
        <MultiTrackMixScreen
          tracks={mixTracks}
          onClose={() => setScreen("home")}
        />
      )}
      <StatusBar style="auto" />
    </>
  );
}
