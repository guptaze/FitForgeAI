import { Redirect } from "expo-router";
// Placeholder route required by expo-router because we render a custom FAB button
// for this tab. It always redirects to the quick-log modal.
export default function FabRoute() {
  return <Redirect href="/quick-log" />;
}
