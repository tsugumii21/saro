import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client.js";
import { ROLE_GUEST } from "../constants.js";

// Staff authentication, backed by Supabase Auth.
//
// Method: email + password, with self-signup disabled and accounts provisioned
// by an administrator (supabase/scripts/create-staff-users.mjs).
//
// Why not magic links: dispatch staff sign in during the incident, often on a
// shared operations terminal, sometimes on the connection that the storm is
// already degrading. A magic link makes every login depend on a mail round trip
// completing first, which is the wrong dependency to add to an emergency
// system. Password login also works on a shared terminal where nobody wants to
// hand over their inbox. Trade-off accepted: passwords need rotation and can be
// shared, so accounts are admin-issued rather than self-registered.
//
// Residents never authenticate at all. They are anonymous by design — the
// schema has no resident role, and a report is tied to a random device id that
// identifies a browser rather than a person.

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error: profileError } = await supabase
      .from("profiles_with_scope")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[SARO] Could not load profile:", profileError.message);
      setProfile(null);
      return;
    }
    // An auth user with no profile row has no role and therefore no access.
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      await loadProfile(data.session?.user?.id);
      if (active) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      await loadProfile(nextSession?.user?.id);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Deliberately vague: distinguishing "no such account" from "wrong
      // password" tells an attacker which staff emails exist.
      const message = "Email or password is incorrect.";
      setError(message);
      return { data: null, error: message };
    }

    return { data: data.user, error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const value = useMemo(() => {
    const role = profile?.role ?? ROLE_GUEST;
    return {
      user: session?.user ?? null,
      session,
      profile,
      role,
      isAdmin: role === "admin",
      isOffice: role === "office",
      isBarangayOfficial: role === "barangay_official",
      officeId: profile?.office_id ?? null,
      officeName: profile?.office_name ?? null,
      barangayId: profile?.barangay_id ?? null,
      barangayName: profile?.barangay_name ?? null,
      loading,
      error,
      signIn,
      signOut,
    };
  }, [session, profile, loading, error, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
