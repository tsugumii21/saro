// Offices Seed Data
export const SEED_OFFICES = [
  {
    id: "off1_cdrrmo",
    short_name: "CDRRMO",
    full_name: "City Disaster Risk Reduction and Management Office",
    category_ids: ["cat_flood", "cat_landslide", "cat_typhoon_debris", "cat_storm_surge"]
  },
  {
    id: "off2_911",
    short_name: "Legazpi 911",
    full_name: "Legazpi 911 Emergency Command Center",
    category_ids: ["cat_medical", "cat_accident"]
  },
  {
    id: "off3_ceo",
    short_name: "City Engineering",
    full_name: "City Engineering Office",
    category_ids: ["cat_pothole", "cat_open_drain", "cat_bridge_damage"]
  },
  {
    id: "off4_pso",
    short_name: "Public Safety Office",
    full_name: "Public Safety Office (PSO)",
    category_ids: ["cat_traffic_obstruction"]
  },
  {
    id: "off5_bfp",
    short_name: "BFP Legazpi",
    full_name: "Bureau of Fire Protection - Legazpi Station",
    category_ids: ["cat_fire", "cat_gas_leak"]
  },
  {
    id: "off6_pnp",
    short_name: "PNP Legazpi",
    full_name: "Philippine National Police - Legazpi City Station",
    category_ids: ["cat_crime"]
  },
  {
    id: "off7_cho",
    short_name: "City Health Office",
    full_name: "City Health Office (CHO)",
    category_ids: ["cat_water_contam"]
  },
  {
    id: "off8_cg",
    short_name: "Coast Guard Station",
    full_name: "Philippine Coast Guard - Legazpi Station",
    category_ids: ["cat_coastal_hazard"]
  }
];

// Categories Seed Data
export const SEED_CATEGORIES = [
  {
    id: "cat_flood",
    name: "Flooding & Water Inundation",
    name_bikol: "Baha o Tubig sa Kalsada",
    name_tagalog: "Baha sa Daan",
    office_id: "off1_cdrrmo",
    is_emergency: true,
    sla_hours: 1,
    icon: "waves"
  },
  {
    id: "cat_landslide",
    name: "Landslide & Soil Erosion",
    name_bikol: "Guba nin Lupa o Anod",
    name_tagalog: "Pagsguho ng Lupa",
    office_id: "off1_cdrrmo",
    is_emergency: true,
    sla_hours: 2,
    icon: "mountain"
  },
  {
    id: "cat_typhoon_debris",
    name: "Typhoon Debris & Structural Damage",
    name_bikol: "Guba sa Bagyo o Basura sa Kalsada",
    name_tagalog: "Basura o Sira galing Bagyo",
    office_id: "off1_cdrrmo",
    is_emergency: false,
    sla_hours: 24,
    icon: "wind"
  },
  {
    id: "cat_medical",
    name: "Medical Emergency & Injury",
    name_bikol: "Emergency sa Salud o Disgrasya",
    name_tagalog: "Emergency sa Kalusugan",
    office_id: "off2_911",
    is_emergency: true,
    sla_hours: 1,
    icon: "ambulance"
  },
  {
    id: "cat_accident",
    name: "Vehicular Collision & Road Crash",
    name_bikol: "Disgrasya sa Kalsada",
    name_tagalog: "Aksidente sa Daan",
    office_id: "off2_911",
    is_emergency: true,
    sla_hours: 1,
    icon: "car"
  },
  {
    id: "cat_pothole",
    name: "Road Pothole & Surface Damage",
    name_bikol: "Luwag o Rara sa Kalsada",
    name_tagalog: "Lubak sa Kalsada",
    office_id: "off3_ceo",
    is_emergency: false,
    sla_hours: 72,
    icon: "construction"
  },
  {
    id: "cat_open_drain",
    name: "Uncovered Drain & Broken Manhole",
    name_bikol: "Open Canal o Nahulog na Takop",
    name_tagalog: "Buksan o Sira na Kanal",
    office_id: "off3_ceo",
    is_emergency: false,
    sla_hours: 24,
    icon: "box"
  },
  {
    id: "cat_bridge_damage",
    name: "Bridge & Seawall Damage",
    name_bikol: "Guba sa Tulay o Seawall",
    name_tagalog: "Sira sa Tulay o Seawall",
    office_id: "off3_ceo",
    is_emergency: true,
    sla_hours: 12,
    icon: "shield-alert"
  },
  {
    id: "cat_traffic_obstruction",
    name: "Road Obstruction & Signal Malfunction",
    name_bikol: "Bara sa Kalsada o Sira na Traffic Light",
    name_tagalog: "Bara sa Daan o Sirang Traffic Light",
    office_id: "off4_pso",
    is_emergency: false,
    sla_hours: 12,
    icon: "alert-triangle"
  },
  {
    id: "cat_fire",
    name: "Fire Outbreak & Structural Fire",
    name_bikol: "Cayo o Uswag nin Apoy",
    name_tagalog: "Sunog",
    office_id: "off5_bfp",
    is_emergency: true,
    sla_hours: 1,
    icon: "flame"
  },
  {
    id: "cat_gas_leak",
    name: "Gas Leak & Chemical Spill",
    name_bikol: "Singaw nin Gas o Kemikal",
    name_tagalog: "Kagipitan sa Gas o Kemikal",
    office_id: "off5_bfp",
    is_emergency: true,
    sla_hours: 1,
    icon: "zap"
  },
  {
    id: "cat_crime",
    name: "Public Order & Crime Incident",
    name_bikol: "Kagubot o Krimen",
    name_tagalog: "Gulo o Krimen",
    office_id: "off6_pnp",
    is_emergency: true,
    sla_hours: 1,
    icon: "shield"
  },
  {
    id: "cat_water_contam",
    name: "Water Contamination & Health Hazard",
    name_bikol: "Dumi sa Tubig Inomon",
    name_tagalog: "Maduming Tubig Inumin",
    office_id: "off7_cho",
    is_emergency: false,
    sla_hours: 24,
    icon: "droplet"
  },
  {
    id: "cat_coastal_hazard",
    name: "Coastal Storm Surge & Marine Emergency",
    name_bikol: "Baha sa Baybayon o Emergency sa Dagat",
    name_tagalog: "Emergency sa Baybayin",
    office_id: "off8_cg",
    is_emergency: true,
    sla_hours: 2,
    icon: "anchor"
  }
];

// Helper to create approximate polygon box around center
function makePoly(clat, clng, offset = 0.008) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [clng - offset, clat - offset],
        [clng + offset, clat - offset],
        [clng + offset, clat + offset],
        [clng - offset, clat + offset],
        [clng - offset, clat - offset]
      ]
    ]
  };
}

// Barangays Seed Data (12 Representative Legazpi Barangays)
export const SEED_BARANGAYS = [
  { id: "brgy_bitano", name: "Bitano", is_coastal: false, geo_bounds: makePoly(13.1438, 123.7448) },
  { id: "brgy_rawis", name: "Rawis", is_coastal: true, geo_bounds: makePoly(13.1610, 123.7510) },
  { id: "brgy_gogon", name: "Gogon", is_coastal: false, geo_bounds: makePoly(13.1490, 123.7380) },
  { id: "brgy_ems", name: "Em's Barrio", is_coastal: false, geo_bounds: makePoly(13.1415, 123.7410) },
  { id: "brgy_puro", name: "Puro", is_coastal: true, geo_bounds: makePoly(13.1320, 123.7560) },
  { id: "brgy_victory", name: "Victory Village", is_coastal: true, geo_bounds: makePoly(13.1420, 123.7540) },
  { id: "brgy_taysan", name: "Taysan", is_coastal: false, geo_bounds: makePoly(13.1200, 123.7100) },
  { id: "brgy_bonot", name: "Bonot", is_coastal: true, geo_bounds: makePoly(13.1500, 123.7490) },
  { id: "brgy_cruzada", name: "Cruzada", is_coastal: false, geo_bounds: makePoly(13.1480, 123.7350) },
  { id: "brgy_homapon", name: "Homapon", is_coastal: false, geo_bounds: makePoly(13.1050, 123.7150) },
  { id: "brgy_dapitan", name: "Dap-Dap", is_coastal: true, geo_bounds: makePoly(13.1460, 123.7520) },
  { id: "brgy_orog", name: "Oro Site", is_coastal: false, geo_bounds: makePoly(13.1380, 123.7390) }
];

// Profiles Seed Data
export const SEED_PROFILES = [
  {
    id: "prof_admin",
    full_name: "Director Arnel Ramos",
    mobile_number: "09170001111",
    role: "responder",
    office_id: "off1_cdrrmo",
    is_coordinator: true,
    created_at: new Date().toISOString()
  },
  {
    id: "prof_santos",
    full_name: "Officer Mark Santos",
    mobile_number: "09170002222",
    role: "responder",
    office_id: "off1_cdrrmo",
    is_coordinator: false,
    created_at: new Date().toISOString()
  },
  {
    id: "prof_cruz",
    full_name: "Engr. Danilo Cruz",
    mobile_number: "09170003333",
    role: "responder",
    office_id: "off3_ceo",
    is_coordinator: false,
    created_at: new Date().toISOString()
  },
  {
    id: "prof_clara",
    full_name: "Capt. Maria Clara",
    mobile_number: "09170004444",
    role: "responder",
    office_id: "off5_bfp",
    is_coordinator: false,
    created_at: new Date().toISOString()
  },
  {
    id: "prof_res_01",
    full_name: "Juan Dela Cruz",
    mobile_number: "09181112233",
    role: "resident",
    office_id: null,
    is_coordinator: false,
    created_at: new Date().toISOString()
  }
];

// Cluster IDs for grouping duplicate reports
const CLUSTER_BITANO = "cluster_bitano_flood_2026";

// Initial Seed Reports (Expanded & Realistic across Legazpi City)
export const SEED_REPORTS = [
  {
    id: "rep_01",
    tracking_code: "SR-8F2K",
    category_id: "cat_flood",
    office_id: "off1_cdrrmo",
    description: "Flooding near Bitano market line. Water level rising rapidly near bakery line.",
    lat: 13.1438,
    lng: 123.7448,
    barangay_id: "brgy_bitano",
    status: "in_progress",
    reporter_id: "prof_res_01",
    callback_number: "09181112233",
    device_fingerprint: "dev_fp_101",
    is_proxy_report: false,
    cluster_id: CLUSTER_BITANO,
    confidence_score: 4,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_02",
    tracking_code: "SR-3P2N",
    category_id: "cat_flood",
    office_id: "off1_cdrrmo",
    description: "Submerged sidewalk and blocked culvert near Bitano elemental school.",
    lat: 13.1441,
    lng: 123.7450,
    barangay_id: "brgy_bitano",
    status: "assigned",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_102",
    is_proxy_report: false,
    cluster_id: CLUSTER_BITANO,
    confidence_score: 4,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_03",
    tracking_code: "SR-3P2M",
    category_id: "cat_flood",
    office_id: "off1_cdrrmo",
    description: "High water line on Bitano main road. Light cars stalling.",
    lat: 13.1435,
    lng: 123.7442,
    barangay_id: "brgy_bitano",
    status: "in_progress",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_103",
    is_proxy_report: false,
    cluster_id: CLUSTER_BITANO,
    confidence_score: 4,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_04",
    tracking_code: "SR-8F2L",
    category_id: "cat_flood",
    office_id: "off1_cdrrmo",
    description: "Water reaching knee deep near Bitano barangay hall plaza.",
    lat: 13.1445,
    lng: 123.7452,
    barangay_id: "brgy_bitano",
    status: "in_progress",
    reporter_id: null,
    callback_number: "09193334455",
    device_fingerprint: "dev_fp_104",
    is_proxy_report: false,
    cluster_id: CLUSTER_BITANO,
    confidence_score: 4,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_05",
    tracking_code: "SR-3A9P",
    category_id: "cat_pothole",
    office_id: "off3_ceo",
    description: "Malaking lubak sa kalsada malapit sa Cruzada chapel. Dangerous for motorbikes.",
    lat: 13.1480,
    lng: 123.7350,
    barangay_id: "brgy_cruzada",
    status: "received",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_105",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_06",
    tracking_code: "SR-9K4M",
    category_id: "cat_fire",
    office_id: "off5_bfp",
    description: "Overheated transformer sparking near Rawis elementary school gate.",
    lat: 13.1610,
    lng: 123.7510,
    barangay_id: "brgy_rawis",
    status: "assigned",
    reporter_id: null,
    callback_number: "09204445566",
    device_fingerprint: "dev_fp_106",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_07",
    tracking_code: "SR-2X7W",
    category_id: "cat_medical",
    office_id: "off2_911",
    description: "Elderly resident collapsed near Gogon barangay hall. Needs immediate transport.",
    lat: 13.1490,
    lng: 123.7380,
    barangay_id: "brgy_gogon",
    status: "resolved",
    reporter_id: null,
    callback_number: "09215556677",
    device_fingerprint: "dev_fp_107",
    is_proxy_report: true,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 180).toISOString()
  },
  {
    id: "rep_08",
    tracking_code: "SR-4M8Q",
    category_id: "cat_open_drain",
    office_id: "off3_ceo",
    description: "Open drainage cover in Em's Barrio along pedestrian walkway.",
    lat: 13.1415,
    lng: 123.7410,
    barangay_id: "brgy_ems",
    status: "in_progress",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_108",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_09",
    tracking_code: "SR-7V1N",
    category_id: "cat_traffic_obstruction",
    office_id: "off4_pso",
    description: "Stalled delivery truck blocking two lanes at Puro coastal road.",
    lat: 13.1320,
    lng: 123.7560,
    barangay_id: "brgy_puro",
    status: "resolved",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_109",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 400).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 350).toISOString()
  },
  {
    id: "rep_10",
    tracking_code: "SR-1C5D",
    category_id: "cat_coastal_hazard",
    office_id: "off8_cg",
    description: "High surge waves overflowing seawall barrier at Victory Village.",
    lat: 13.1420,
    lng: 123.7540,
    barangay_id: "brgy_victory",
    status: "in_progress",
    reporter_id: null,
    callback_number: "09226667788",
    device_fingerprint: "dev_fp_110",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_11",
    tracking_code: "SR-6Y3T",
    category_id: "cat_landslide",
    office_id: "off1_cdrrmo",
    description: "Soil movement and minor mudslide along hillside slope in Taysan.",
    lat: 13.1200,
    lng: 123.7100,
    barangay_id: "brgy_taysan",
    status: "assigned",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_111",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 110).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_12",
    tracking_code: "SR-5L9K",
    category_id: "cat_typhoon_debris",
    office_id: "off1_cdrrmo",
    description: "Uprooted acacia tree branch and storm debris cleared along Bonot coastal access road.",
    lat: 13.1500,
    lng: 123.7490,
    barangay_id: "brgy_bonot",
    status: "resolved",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_112",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 500).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 450).toISOString()
  },
  {
    id: "rep_13",
    tracking_code: "SR-9X2F",
    category_id: "cat_accident",
    office_id: "off2_911",
    description: "Motorcycle vs tricycle collision near Peñaranda park roundabout.",
    lat: 13.1385,
    lng: 123.7395,
    barangay_id: "brgy_orog",
    status: "received",
    reporter_id: null,
    callback_number: "09237778899",
    device_fingerprint: "dev_fp_113",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_14",
    tracking_code: "SR-4B7H",
    category_id: "cat_water_contam",
    office_id: "off7_cho",
    description: "Cloudy water with sulfur smell reported from residential tap line.",
    lat: 13.1050,
    lng: 123.7150,
    barangay_id: "brgy_homapon",
    status: "assigned",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_114",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 150).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_15",
    tracking_code: "SR-7K1W",
    category_id: "cat_gas_leak",
    office_id: "off5_bfp",
    description: "Strong LPG gas odor leaking from commercial eatery kitchen.",
    lat: 13.1460,
    lng: 123.7520,
    barangay_id: "brgy_dapitan",
    status: "in_progress",
    reporter_id: null,
    callback_number: "09248889900",
    device_fingerprint: "dev_fp_115",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_16",
    tracking_code: "SR-2R8M",
    category_id: "cat_bridge_damage",
    office_id: "off3_ceo",
    description: "Concrete railing crack on Sagumayon bridge after heavy rainfall.",
    lat: 13.1410,
    lng: 123.7420,
    barangay_id: "brgy_ems",
    status: "assigned",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_116",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 210).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_17",
    tracking_code: "SR-6J5T",
    category_id: "cat_typhoon_debris",
    office_id: "off1_cdrrmo",
    description: "Uprooted acacia tree branch hanging over high voltage lines.",
    lat: 13.1475,
    lng: 123.7345,
    barangay_id: "brgy_cruzada",
    status: "in_progress",
    reporter_id: null,
    callback_number: null,
    device_fingerprint: "dev_fp_117",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    resolved_at: null
  },
  {
    id: "rep_18",
    tracking_code: "SR-1W3K",
    category_id: "cat_traffic_obstruction",
    office_id: "off4_pso",
    description: "Traffic light stuck on red at Quezon avenue intersection causing gridlock.",
    lat: 13.1390,
    lng: 123.7400,
    barangay_id: "brgy_orog",
    status: "assigned",
    reporter_id: null,
    callback_number: "09259990011",
    device_fingerprint: "dev_fp_118",
    is_proxy_report: false,
    cluster_id: null,
    confidence_score: 1,
    is_false_report: false,
    created_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    resolved_at: null
  }
];

export const SEED_REPORT_MEDIA = [];
export const SEED_STATUS_HISTORY = [];
export const SEED_ASSISTANT_LOGS = [];
export const SEED_DEVICES = [];

// Knowledge Base Unanswered Questions (Admin Feature)
export const SEED_KNOWLEDGE_BASE = [
  {
    id: "kb_01",
    question: "Saino kaya pwede mag-report nin sirang street light sa Rizal street?",
    question_bikol: "Saino kaya pwede mag-report nin sirang street light sa Rizal street?",
    category: "Public Safety",
    ask_count: 5,
    answer: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()
  },
  {
    id: "kb_02",
    question: "How long does it take for CDRRMO to respond to flood reports in Bitano?",
    question_bikol: "Pira ka oras bago mag-responde ang CDRRMO sa baha sa Bitano?",
    category: "Flooding",
    ask_count: 8,
    answer: "Emergency flood reports have a 1-hour SLA target for initial dispatch.",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: "kb_03",
    question: "Can I report an emergency anonymously without registering?",
    question_bikol: "Pwede man mag-report nin libre maski dae mag-login?",
    category: "General",
    ask_count: 12,
    answer: "Yes, you can click 'Continue as Guest' to file an immediate hazard report.",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
  }
];
