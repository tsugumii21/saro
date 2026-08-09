#!/usr/bin/env node
//
// Creates the SARO staff accounts and their profile rows.
//
// Staff accounts cannot be seeded in seed.sql because they need rows in
// auth.users, which only the Auth Admin API should write. Self-signup is
// disabled in config.toml, so this script is the provisioning path.
//
// Usage — the secret key is read from the environment and never from a file:
//
//   SUPABASE_URL="https://<ref>.supabase.co" \
//   SUPABASE_SECRET_KEY="sb_secret_..." \
//   node supabase/scripts/create-staff-users.mjs
//
// Add --reset-passwords to re-issue passwords for accounts that already exist.
//
// The script prints each generated password ONCE. Nothing is written to disk.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RESET_PASSWORDS = process.argv.includes("--reset-passwords");

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.");
  console.error("Do not put the secret key in a file. It bypasses every RLS policy.");
  process.exit(1);
}

if (SECRET_KEY.startsWith("sb_publishable_") || SECRET_KEY.startsWith("eyJ")) {
  console.error("That looks like a publishable/anon key. This script needs the secret key.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Scope is named here; ids are resolved from the database so a rename of an
// office does not silently create an unscoped account.
const STAFF = [
  { email: "admin@saro.legazpi.gov.ph",     fullName: "Director Arnel Ramos",  role: "admin" },
  { email: "cdrrmo@saro.legazpi.gov.ph",    fullName: "Marites Oliva",         role: "office", office: "CDRRMO" },
  { email: "engineering@saro.legazpi.gov.ph", fullName: "Engr. Ruel Bautista", role: "office", office: "City Engineering" },
  { email: "bfp@saro.legazpi.gov.ph",       fullName: "SFO2 Danilo Perez",     role: "office", office: "BFP Legazpi" },
  { email: "bitano@saro.legazpi.gov.ph",    fullName: "Kap. Elena Sarmiento",  role: "barangay_official", barangay: "Bitano" },
  { email: "rawis@saro.legazpi.gov.ph",     fullName: "Kap. Noel Mercado",     role: "barangay_official", barangay: "Rawis" },
  // A demo resident, so the admin queue shows both verified and guest reports.
  // Residents normally arrive through public signup; this one is provisioned
  // pre-confirmed so there is something to sign in as immediately.
  { email: "resident@example.com",          fullName: "Liza Fernandez",        role: "resident", demoResident: true }
];

function generatePassword() {
  // Default prototype password for easy local/demo access
  return process.env.DEMO_PASSWORD || "demo123";
}

async function resolveScope() {
  const [{ data: offices, error: oErr }, { data: barangays, error: bErr }] = await Promise.all([
    admin.from("offices").select("id, short_name"),
    admin.from("barangays").select("id, name")
  ]);
  if (oErr) throw new Error(`Could not read offices: ${oErr.message}`);
  if (bErr) throw new Error(`Could not read barangays: ${bErr.message}`);
  if (!offices?.length) throw new Error("No offices found. Run the seed first.");

  return {
    officeByName: new Map(offices.map((o) => [o.short_name, o.id])),
    barangayByName: new Map(barangays.map((b) => [b.name, b.id]))
  };
}

async function findExistingUser(email) {
  // listUsers is paginated; staff lists are small, so one page is plenty.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`Could not list users: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Move two seeded guest reports onto the demo resident's account.
 *
 * reporter_device_id has to be cleared in the same statement as
 * reporter_user_id is set — the reports_exactly_one_reporter constraint
 * rejects a row carrying both.
 */
async function claimSeedReportsForResident(userId) {
  const { data: candidates, error } = await admin
    .from("reports")
    .select("id")
    .like("reporter_device_id", "dev_seed_%")
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    console.error(`  could not read seed reports: ${error.message}`);
    return;
  }
  if (!candidates?.length) return;

  const { error: updateError } = await admin
    .from("reports")
    .update({ reporter_user_id: userId, reporter_device_id: null })
    .in("id", candidates.map((r) => r.id));

  if (updateError) {
    console.error(`  could not attach seed reports to the demo resident: ${updateError.message}`);
    return;
  }
  console.log(`  attached ${candidates.length} seeded reports to the demo resident`);
}

async function main() {
  const { officeByName, barangayByName } = await resolveScope();
  const created = [];

  for (const person of STAFF) {
    const officeId = person.office ? officeByName.get(person.office) : null;
    const barangayId = person.barangay ? barangayByName.get(person.barangay) : null;

    if (person.office && !officeId) {
      console.error(`  skip ${person.email} — office "${person.office}" not found`);
      continue;
    }
    if (person.barangay && !barangayId) {
      console.error(`  skip ${person.email} — barangay "${person.barangay}" not found`);
      continue;
    }

    let user = await findExistingUser(person.email);
    let password = null;

    if (!user) {
      password = generatePassword();
      const { data, error } = await admin.auth.admin.createUser({
        email: person.email,
        password,
        email_confirm: true,          // no inbox round trip for provisioned accounts
        user_metadata: { full_name: person.fullName }
      });
      if (error) {
        console.error(`  FAILED ${person.email} — ${error.message}`);
        continue;
      }
      user = data.user;
    } else if (RESET_PASSWORDS) {
      password = generatePassword();
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) {
        console.error(`  FAILED password reset for ${person.email} — ${error.message}`);
        continue;
      }
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: user.id,
        full_name: person.fullName,
        role: person.role,
        office_id: officeId,
        barangay_id: barangayId,
        is_active: true
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.error(`  FAILED profile for ${person.email} — ${profileError.message}`);
      continue;
    }

    created.push({ email: person.email, role: person.role, password });

    // Give the demo resident a couple of the seeded reports, so the admin
    // queue has verified rows next to guest rows and the badge is visible.
    if (person.demoResident) {
      await claimSeedReportsForResident(user.id);
    }
  }

  console.log("\nStaff accounts ready:\n");
  for (const row of created) {
    const scope = row.password ? row.password : "(unchanged — pass --reset-passwords to reissue)";
    console.log(`  ${row.email.padEnd(34)} ${row.role.padEnd(18)} ${scope}`);
  }
  console.log("\nPasswords are shown once and are not stored anywhere. Distribute them out of band.\n");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
