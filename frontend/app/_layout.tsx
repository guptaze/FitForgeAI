import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { theme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.color.surface} />
      <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.surface },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="quick-log"
            options={{
              presentation: "modal",
              animation: "slide_from_bottom",
              contentStyle: { backgroundColor: "rgba(0,0,0,0.6)" },
            }}
          />
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}
