import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client.js";
import { ROLE_GUEST } from "../constants.js";

// Authentication for both apps, backed by Supabase Auth. Email + password
// throughout, but arrived at from two opposite directions:
//
//   Residents  self-register through the public signup flow and must confirm
//              their email. Signup can only ever produce role='resident' — the
//              handle_new_user trigger hard-codes it and ignores user_metadata,
//              so the form cannot be used to mint an admin.
//
//   Staff      are provisioned by an administrator
//              (supabase/scripts/create-staff-users.mjs). Their role is set
//              through the service role, never through a signup form.
//
// Why not magic links for staff: dispatch staff sign in during the incident,
// often on a shared operations terminal, sometimes on the connection the storm
// is already degrading. A magic link makes every login depend on a mail round
// trip completing first, which is the wrong dependency to add to an emergency
// system. Trade-off accepted: passwords need rotation, so staff accounts are
// admin-issued rather than self-registered.
//
// Guests remain first-class. Panic and the emergency Describe path never touch
// this provider — a report can always be filed against a browser-local device
// id with nobody signed in.

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

  /**
   * Resident self-registration.
   *
   * Whatever is passed here, the account comes out as a resident: the role is
   * assigned by a database trigger, not by this call. `full_name` goes into
   * user_metadata purely so the profile row has a name to show.
   */
  const signUp = useCallback(async (email, password, fullName) => {
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: (fullName ?? "").trim() } },
    });

    if (signUpError) {
      setError(signUpError.message);
      return { data: null, error: signUpError.message, needsConfirmation: false };
    }

    // With email confirmation on, Supabase returns a user but no session.
    const needsConfirmation = Boolean(data.user) && !data.session;
    return { data: data.user, error: null, needsConfirmation };
  }, []);

  const resendConfirmation = useCallback(async (email) => {
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    return { error: resendError ? resendError.message : null };
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
      // A guest is not a resident. Both are "not staff", but only a resident
      // has an account, so only a resident gets cross-device history.
      isGuest: !session,
      isResident: role === "resident",
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
      signUp,
      resendConfirmation,
      signOut,
    };
  }, [session, profile, loading, error, signIn, signUp, resendConfirmation, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
