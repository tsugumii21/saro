import { AuthProvider } from "@saro/shared";
import AppEntryFlow from "./components/citizen/AppEntryFlow";

/**
 * ResidentGate is the entry point for @saro/resident-app.
 * It builds and serves ONLY the mobile resident application starting directly at the splash screen.
 */
export default function ResidentGate() {
  return (
    <AuthProvider>
      <AppEntryFlow />
    </AuthProvider>
  );
}
