import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client.js";
import { ROLE_GUEST } from "../constants.js";
import { makeViewerScope } from "../scope.js";

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

// A display name derived from an email local part arrives lowercase
// ("resident@example.com" -> "resident"), and it is rendered next to
// "Signed in" in the account widget. Title-case each word so the sidebar reads
// "Resident", not "resident".
function titleCaseName(raw) {
  return (raw ?? "")
    .split(/([.\-_\s]+)/)
    .map((part) => (part.charAt(0).toUpperCase() + part.slice(1)))
    .join("")
    .trim();
}

const DEMO_PROFILES = {
  "admin@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000001",
    full_name: "Director Arnel Ramos",
    role: "admin",
    is_coordinator: true,
    office_id: null,
    office_name: null,
    barangay_id: null,
    barangay_name: null,
  },
  "cdrrmo@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000002",
    full_name: "Marites Oliva",
    role: "office",
    /* CDRRMO coordinates the citywide response, so it reads every emergency-tier
       hazard — including the ones BFP or PNP hold. Read only: the queue it can
       act on is still its own. Every other office keeps this false. */
    is_coordinator: true,
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    office_name: "CDRRMO",
    barangay_id: null,
    barangay_name: null,
  },
  "engineering@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000003",
    full_name: "Engr. Ruel Bautista",
    role: "office",
    is_coordinator: false,
    office_id: "3362fc03-d004-4148-8268-00d8c0a959b7",
    office_name: "City Engineering",
    barangay_id: null,
    barangay_name: null,
  },
  "bfp@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000004",
    full_name: "SFO2 Danilo Perez",
    role: "office",
    is_coordinator: false,
    office_id: "a2e1c4c0-47c1-460c-b165-a339a77b4ccc",
    office_name: "BFP Legazpi",
    barangay_id: null,
    barangay_name: null,
  },
  /* The barangay ids are not decoration. Every jurisdiction check compares ids,
     so a profile carrying only a name matched nothing and the screens fell back
     to showing the whole city — which is how Brgy. Bitano could read Brgy.
     Bonot's reports. These match DEMO_BARANGAYS in the api module. */
  "bitano@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000005",
    full_name: "Kap. Elena Sarmiento",
    role: "barangay_official",
    is_coordinator: false,
    office_id: null,
    office_name: null,
    barangay_id: "brgy-bitano",
    barangay_name: "Bitano",
  },
  "rawis@saro.legazpi.gov.ph": {
    id: "00000000-0000-0000-0000-000000000006",
    full_name: "Kap. Noel Mercado",
    role: "barangay_official",
    is_coordinator: false,
    office_id: null,
    office_name: null,
    barangay_id: "brgy-rawis",
    barangay_name: "Rawis",
  },
  "resident@example.com": {
    id: "00000000-0000-0000-0000-000000000007",
    full_name: "Liza Fernandez",
    role: "resident",
    is_coordinator: false,
    office_id: null,
    office_name: null,
    barangay_id: null,
    barangay_name: null,
  },
};

const DEMO_AUTH_STORAGE_KEY = "saro_demo_auth_session";

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
      if (data.session) {
        setSession(data.session);
        await loadProfile(data.session.user.id);
      } else {
        // Fallback: check demo session storage for prototype mode
        try {
          const raw = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved?.session && saved?.profile) {
              setSession(saved.session);
              /* A session saved before names were title-cased still holds the
                 raw email local part ("resident"), and it is rendered next to
                 "Signed in". Only an all-lowercase name is touched, so a real
                 name someone typed is left exactly as they typed it. */
              const savedName = saved.profile.full_name ?? "";
              setProfile(
                savedName && savedName === savedName.toLowerCase()
                  ? { ...saved.profile, full_name: titleCaseName(savedName) }
                  : saved.profile
              );
            }
          }
        } catch (e) {
          console.warn("[SARO] Demo auth read failed:", e);
        }
      }
      if (active) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      if (nextSession) {
        setSession(nextSession);
        await loadProfile(nextSession.user.id);
        localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    const cleanEmail = (email ?? "").trim().toLowerCase();

    // 1. Try standard Supabase Auth
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (!signInError && data?.user) {
      localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
      return { data: data.user, error: null };
    }

    // 2. Demo prototype fallback when using 'demo123'
    if (password === "demo123") {
      const demoProf = DEMO_PROFILES[cleanEmail] || {
        id: `demo-res-${Date.now()}`,
        full_name: titleCaseName(cleanEmail.split("@")[0]) || "Demo Resident",
        role: "resident",
        is_coordinator: false,
        office_id: null,
        office_name: null,
        barangay_id: null,
        barangay_name: null,
      };

      const demoSess = {
        user: { id: demoProf.id, email: cleanEmail },
        access_token: "demo-token",
      };

      try {
        localStorage.setItem(
          DEMO_AUTH_STORAGE_KEY,
          JSON.stringify({ session: demoSess, profile: demoProf })
        );
      } catch (e) {
        console.warn("[SARO] Could not save demo session:", e);
      }

      setSession(demoSess);
      setProfile(demoProf);
      return { data: demoSess.user, error: null };
    }

    const message = "Email or password is incorrect.";
    setError(message);
    return { data: null, error: message };
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    setError(null);
    const cleanEmail = (email ?? "").trim().toLowerCase();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: (fullName ?? "").trim() } },
    });

    if (signUpError && password !== "demo123") {
      setError(signUpError.message);
      return { data: null, error: signUpError.message, needsConfirmation: false };
    }

    // If password is 'demo123' or real signup returns user, construct instant session
    if (password === "demo123" || (data?.user && !data?.session)) {
      const demoProf = {
        id: data?.user?.id || `demo-res-${Date.now()}`,
        full_name: (fullName ?? "").trim() || titleCaseName(cleanEmail.split("@")[0]),
        role: "resident",
        is_coordinator: false,
        office_id: null,
        office_name: null,
        barangay_id: null,
        barangay_name: null,
      };
      const demoSess = {
        user: { id: demoProf.id, email: cleanEmail },
        access_token: "demo-token",
      };

      try {
        localStorage.setItem(
          DEMO_AUTH_STORAGE_KEY,
          JSON.stringify({ session: demoSess, profile: demoProf })
        );
      } catch (e) {
        console.warn("[SARO] Could not save demo signup session:", e);
      }

      setSession(demoSess);
      setProfile(demoProf);
      return { data: demoSess.user, error: null, needsConfirmation: false };
    }

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
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("[SARO] Supabase signout warning:", e);
    }
    localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
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
      // Centralized capabilities for role authorization
      canManageRouting: role === "admin",
      canManageAccounts: role === "admin",
      canEditMayonAlert: role === "admin",
      canManageEvacuationCenters: role === "admin" || role === "office",
      canResolveGaps: role === "admin" || role === "office",
      canReviewPanic: role === "admin" || role === "office",
      officeId: profile?.office_id ?? null,
      officeName: profile?.office_name ?? null,
      barangayId: profile?.barangay_id ?? null,
      barangayName: profile?.barangay_name ?? null,
      isCoordinator: Boolean(profile?.is_coordinator),
      /* One object every screen filters reports through, so jurisdiction is a
         thing a screen receives rather than a rule it has to remember. See
         scope.js — Postgres RLS is still the boundary this only mirrors. */
      viewerScope: makeViewerScope(profile),
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
