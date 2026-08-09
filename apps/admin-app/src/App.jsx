import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth, STAFF_ROLES } from "@saro/shared";
import LandingPage from "./components/landing/LandingPage";
import StaffShell, { StaffLogin } from "./components/staff/StaffShell";

function AdminAppContent() {
  const { profile, role, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="t-body-sm text-ink-muted font-medium">Checking operations session…</p>
      </div>
    );
  }

  // 1. Signed-in authorized staff -> Full StaffShell
  if (profile && STAFF_ROLES.includes(role)) {
    return <StaffShell />;
  }

  // 2. Unauthenticated user on Login Screen
  if (showLogin) {
    return <StaffLogin onBack={() => setShowLogin(false)} />;
  }

  // 3. Unauthenticated user on Landing Page / Dashboard
  return <LandingPage onOpenLogin={() => setShowLogin(true)} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AdminAppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
