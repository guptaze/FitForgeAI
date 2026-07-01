import React from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { theme } from "@/src/theme";

function FabButton() {
  const router = useRouter();
  return (
    <View style={styles.fabWrap}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push("/quick-log");
        }}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        testID="fab-quick-log"
      >
        <Ionicons name="add" size={32} color={theme.color.onBrand} />
      </Pressable>
      <Text style={styles.fabLabel}>LOG</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.color.surfaceSecondary,
            borderTopColor: theme.color.border,
            borderTopWidth: 1,
            height: 88,
            paddingTop: 8,
            paddingBottom: 24,
          },
          tabBarActiveTintColor: theme.color.brand,
          tabBarInactiveTintColor: theme.color.muted,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
            tabBarButtonTestID: "tab-home",
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: "Plan",
            tabBarIcon: ({ color, size }) => <Ionicons name="barbell-outline" size={size} color={color} />,
            tabBarButtonTestID: "tab-plan",
          }}
        />
        <Tabs.Screen
          name="fab"
          options={{
            title: "",
            tabBarIcon: () => null,
            tabBarButton: () => <FabButton />,
          }}
        />
        <Tabs.Screen
          name="bloodwork"
          options={{
            title: "Blood",
            tabBarIcon: ({ color, size }) => <Ionicons name="water-outline" size={size} color={color} />,
            tabBarButtonTestID: "tab-bloodwork",
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  fabWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    marginTop: -24,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.color.brand,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F35900",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 3,
    borderColor: theme.color.surfaceSecondary,
  },
  fabLabel: {
    color: theme.color.brand,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: 4,
  },
});
