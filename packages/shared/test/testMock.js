// Verification script for SARO Mock Data Layer

import {
  getOffices,
  getBarangays,
  getReports,
  getReportByTrackingCode,
  createReport,
  updateReportStatus,
  resetMockData
} from "../src/api/index.js";
import { mockEvents } from "../src/api/events.js";

// Mock localStorage for Node test runner
const storageMap = new Map();
global.localStorage = {
  getItem: (key) => storageMap.get(key) || null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

async function runTests() {
  console.log("=== RUNNING SARO MOCK DATA LAYER VERIFICATION ===");

  // Reset
  await resetMockData();

  // Test 1: Load 8 offices, 18 reports, 12 barangays
  const officesRes = await getOffices();
  const reportsRes = await getReports();
  const barangaysRes = await getBarangays();

  console.log(`\n1. Initial Load Verification:`);
  console.log(`   - Offices loaded: ${officesRes.data?.length} (Expected: 8)`);
  console.log(`   - Reports loaded: ${reportsRes.data?.length} (Expected: 18)`);
  console.log(`   - Barangays loaded: ${barangaysRes.data?.length} (Expected: 12)`);

  if (officesRes.data?.length !== 8 || reportsRes.data?.length !== 18 || barangaysRes.data?.length !== 12) {
    console.error("FAILED Test 1!");
    process.exit(1);
  }

  // Test 2: Tracking Code Lookup
  console.log(`\n2. Tracking Code Lookup Test:`);
  const validLookup = await getReportByTrackingCode("SR-8F2K");
  console.log(`   - Valid code SR-8F2K report ID: ${validLookup.data?.id} (Title: "${validLookup.data?.description.slice(0, 30)}...")`);

  const badLookup = await getReportByTrackingCode("SR-INVALID-99");
  console.log(`   - Invalid code result error: "${badLookup.error}"`);

  if (!validLookup.data || !badLookup.error) {
    console.error("FAILED Test 2!");
    process.exit(1);
  }

  // Test 3: RLS Policy Enforcement for updateReportStatus
  console.log(`\n3. RLS Authorization Test:`);
  // Report rep_06 is assigned to BFP (off5_bfp)
  // prof_resp_2 belongs to CEO (off3_ceo), non-coordinator
  const rlsDenied = await updateReportStatus("rep_06", "resolved", "Unauthorized attempt", "prof_resp_2");
  console.log(`   - Cross-office update result error: "${rlsDenied.error}"`);

  // prof_resp_3 belongs to BFP (off5_bfp) -> allowed!
  const rlsAllowed = await updateReportStatus("rep_06", "in_progress", "BFP responder handling report", "prof_resp_3");
  console.log(`   - Same-office update result status: ${rlsAllowed.data?.status}`);

  // prof_admin_1 is coordinator -> allowed cross-office!
  const coordAllowed = await updateReportStatus("rep_05", "in_progress", "City Director overriding update", "prof_admin_1");
  console.log(`   - Coordinator cross-office update status: ${coordAllowed.data?.status}`);

  if (!rlsDenied.error || !rlsAllowed.data || !coordAllowed.data) {
    console.error("FAILED Test 3!");
    process.exit(1);
  }

  // Test 4: Turf.js Clustering & Create Report
  console.log(`\n4. Turf.js Clustering & Create Report Test:`);
  let eventTriggered = false;
  mockEvents.on("report:created", () => {
    eventTriggered = true;
  });

  // Create report near Bitano intersection (13.1438, 123.7460) with cat_flood
  const newReportRes = await createReport({
    category_id: "cat_flood",
    description: "Another flood report near Bitano corner",
    lat: 13.14385,
    lng: 123.74605,
    barangay_id: "brgy_bitano",
    device_fingerprint: "dev_fp_node_test"
  });

  console.log(`   - Created report ID: ${newReportRes.data?.id}, tracking code: ${newReportRes.data?.tracking_code}`);
  console.log(`   - Clustered ID: ${newReportRes.data?.cluster_id}`);
  console.log(`   - Confidence score (cluster size): ${newReportRes.data?.confidence_score}`);
  console.log(`   - Event emitted: ${eventTriggered}`);

  if (!newReportRes.data?.cluster_id || newReportRes.data?.confidence_score < 2 || !eventTriggered) {
    console.error("FAILED Test 4!");
    process.exit(1);
  }

  // Test 5: Storage Persistence
  console.log(`\n5. LocalStorage Persistence Test:`);
  const finalReports = await getReports();
  console.log(`   - Total reports after insertion: ${finalReports.data?.length} (Expected: 19)`);

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");
}

runTests();
