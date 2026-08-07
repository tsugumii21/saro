import { createContext, useContext, useState } from "react";
import { CLIENT_STORAGE_KEYS, ROLE_GUEST } from "../constants.js";

const AuthContext = createContext(null);
const PROFILE_KEY = CLIENT_STORAGE_KEYS.AUTH_PROFILE;

function getInitialProfile() {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(PROFILE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch { localStorage.removeItem(PROFILE_KEY); }
  }
  return null;
}

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(getInitialProfile);

  const login = (newProfile) => {
    if (newProfile) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(newProfile));
    } else {
      localStorage.removeItem(PROFILE_KEY);
    }
    setProfile(newProfile);
  };

  const logout = () => {
    localStorage.removeItem(PROFILE_KEY);
    setProfile(null);
  };

  // Derived user object mirroring Supabase auth user shape
  const user = profile
    ? { id: profile.id, email: `${profile.id}@saro.legazpi.gov.ph` }
    : null;

  const role = profile ? profile.role : ROLE_GUEST;

  const value = {
    user,
    profile,
    role,
    loading: false,
    login,
    logout,
    setMockProfile: login
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
