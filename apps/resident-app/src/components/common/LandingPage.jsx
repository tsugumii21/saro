import React, { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import {Shield, AlertTriangle, ArrowRight, Phone, Clock, MapPin, Radio, Flame, Waves, Construction, Activity, HeartPulse, Droplet, Anchor, Share2, X} from "lucide-react";
import { Wordmark, StatusTag } from "@saro/ui";
import { getPublicMapReports, getCategories, LEGAZPI_CENTER } from "@saro/shared";
import { saroEvents } from "@saro/shared";

const LEGAZPI_BOUNDS = [
  [13.10, 123.70],
  [13.20, 123.78]
];


const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E"
};

function makeMapMarkerIcon(color, isResolved, clusterCount) {
  const opacity = isResolved ? 0.45 : 1;
  const size = clusterCount > 1 ? 26 : 18;
  const ring = clusterCount > 1 ? `box-shadow:0 0 0 4px ${color}35;` : `box-shadow:0 1px 4px rgba(0,0,0,.4);`;

  return L.divIcon({
    className: "saro-marker",
    html: `<div style="position:relative;width:${size}px;height:${size}px;opacity:${opacity};">
      <div style="background:${color};width:100%;height:100%;border-radius:50%;border:2px solid #fff;${ring}"></div>
      ${clusterCount > 1 ? `<span style="position:absolute;top:-6px;right:-6px;background:#0F172A;color:#fff;font-size:9px;font-weight:800;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff;">${clusterCount}</span>` : ""}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function BoundsController() {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(L.latLngBounds(LEGAZPI_BOUNDS).pad(0.1));
    map.setMinZoom(12);
  }, [map]);
  return null;
}

export default function LandingPage({ onSelectResident, onSelectOfficer }) {
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  const loadData = useCallback(async () => {
    const [rRes, cRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
    ]);
    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
  }, []);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    return () => { u1(); u2(); };
  }, [loadData]);

  const getCatName = (id) => categories.find((c) => c.id === id)?.name || id;

  // Deduplicate clustered reports for live preview
  const clusterMap = new Map();
  const displayReports = [];

  reports.forEach((r) => {
    if (!r.lat || !r.lng) return;
    if (r.cluster_id) {
      if (!clusterMap.has(r.cluster_id)) {
        clusterMap.set(r.cluster_id, { report: r, count: r.confidence_score || 1 });
      }
    } else {
      displayReports.push({ report: r, count: 1 });
    }
  });
  clusterMap.forEach((val) => displayReports.push(val));

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans flex flex-col justify-between selection:bg-brand-wash selection:text-brand">
      {/* Top Header / Navigation */}
      <header className="bg-white border-b border-line sticky top-0 z-50 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Wordmark variant="teal" size="md" />

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-ink-muted">
              <a href="#how-it-works" className="hover:text-brand transition-colors">How It Works</a>
              <a href="#agencies" className="hover:text-brand transition-colors">Connected Offices</a>
              <a href="#hotlines" className="hover:text-brand transition-colors">Emergency Hotlines</a>
            </nav>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            <button
              onClick={onSelectOfficer}
              className="text-xs font-bold text-ink-muted hover:text-ink bg-raised hover:bg-line border border-line px-3.5 py-2 rounded-xs transition-colors flex items-center gap-1.5 min-h-[40px]"
            >
              <Shield className="w-3.5 h-3.5 text-brand" />
              <span>Officer Portal</span>
            </button>

            <button
              onClick={onSelectResident}
              className="saro-btn-primary text-xs py-2 px-4 shadow-sm min-h-[40px]"
            >
              <span>Report a Hazard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Landing Page Content */}
      <main className="flex-1">

        {/* Hero Section with Live Dark Map Preview & Single Primary CTA */}
        <section className="bg-gradient-to-br from-ink via-brand-strong to-ink text-white relative overflow-hidden py-14 md:py-24 border-b border-brand-strong/50">
          
          {/* Legazpi Contour Lines SVG Background Overlay */}
          <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none stroke-brand-edge/40" fill="none" strokeWidth="1.2">
            <path d="M-100 180 C 150 120, 350 420, 700 220 C 1000 80, 1300 320, 1700 180" />
            <path d="M-100 260 C 180 190, 380 480, 740 280 C 1040 140, 1340 380, 1740 240" />
            <path d="M-100 340 C 210 260, 410 540, 780 340 C 1080 200, 1380 440, 1780 300" />
            <circle cx="82%" cy="32%" r="200" strokeDasharray="4 4" />
            <circle cx="82%" cy="32%" r="300" strokeDasharray="6 6" />
          </svg>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 grid md:grid-cols-12 gap-10 items-center">
            
            {/* Left Hero Text Column */}
            <div className="md:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-bright/20 text-brand-edge border border-brand-bright/30 text-xs font-bold shadow-xs">
                <Radio className="w-3.5 h-3.5 text-brand-edge animate-pulse" />
                Legazpi City Official Civic Hazard Portal
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
                One front door for civic hazard & emergency reporting.
              </h1>

              <p className="text-sm sm:text-base text-brand-wash/90 leading-relaxed max-w-xl font-normal">
                <strong className="text-white font-semibold">"SARO"</strong> means <strong className="text-brand-edge font-semibold italic">"One"</strong> in Bikol. We replace disconnected hotlines with automated department routing and end-to-end report transparency for all Legazpi residents.
              </p>

              {/* Single Confident Primary CTA (Officer login moved to top nav / footer per request) */}
              <div className="pt-2">
                <button
                  onClick={onSelectResident}
                  className="saro-btn-primary text-sm py-4 px-8 shadow-none rounded-xs font-extrabold inline-flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <AlertTriangle className="w-5 h-5" />
                  <span>Report a Hazard (Public)</span>
                  <ArrowRight className="w-5 h-5 ml-1" />
                </button>
              </div>

            </div>

            {/* Right Side: Real Live Dark Map Preview */}
            <div className="md:col-span-6">
              <div className="bg-ink/90 backdrop-blur-xl border border-brand-bright/30 rounded-xs shadow-none overflow-hidden relative flex flex-col h-[360px] sm:h-[420px]">
                
                {/* Live EOC Overlay Header */}
                <div className="bg-ink/95 border-b border-brand-bright/30 px-4 py-3 z-[500] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-status-resolved-tab animate-pulse" />
                    <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                      LIVE EOC INCIDENT MAP
                    </span>
                  </div>
                  <span className="t-micro bg-brand-bright/20 text-brand-edge border border-brand-edge/30 px-2.5 py-0.5 rounded font-mono font-bold">
                    {reports.length} Active Incident Pins
                  </span>
                </div>

                {/* Dark CartoDB Leaflet Map */}
                <div className="flex-1 relative w-full h-full">
                  <MapContainer
                    center={LEGAZPI_CENTER}
                    zoom={13}
                    zoomControl={false}
                    scrollWheelZoom={false}
                    className="w-full h-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                    />
                    <BoundsController />

                    {displayReports.map(({ report: r, count }) => {
                      const isResolved = r.status === "resolved";
                      const color = STATUS_COLORS[r.status] || STATUS_COLORS.received;
                      return (
                        <Marker
                          key={r.cluster_id || r.id}
                          position={[r.lat, r.lng]}
                          icon={makeMapMarkerIcon(color, isResolved, count)}
                          eventHandlers={{
                            click: () => setSelectedReport({ ...r, clusterCount: count })
                          }}
                        />
                      );
                    })}
                  </MapContainer>

                  {/* Selected Incident Floating Detail Card */}
                  {selectedReport ? (
                    <div className="absolute bottom-3 left-3 right-3 z-[500] bg-ink/95 backdrop-blur-md border border-brand-bright/40 rounded-xs p-3.5 text-xs text-white shadow-none animate-slide-up">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-brand-edge">{selectedReport.tracking_code}</span>
                          <StatusTag status={selectedReport.status} />
                        </div>
                        <button onClick={() => setSelectedReport(null)} className="text-brand-edge/60 hover:text-white">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="font-bold text-white text-xs mb-1">
                        {getCatName(selectedReport.category_id)}
                      </div>
                      <div className="t-label text-brand-edge/70 mb-2 truncate">
                        {selectedReport.description}
                      </div>
                      <button
                        onClick={onSelectResident}
                        className="saro-btn-primary w-full t-label py-1.5"
                      >
                        Report in this area →
                      </button>
                    </div>
                  ) : (
                    <div className="absolute bottom-3 left-3 z-[500] bg-ink/80 backdrop-blur-md border border-white/10 rounded-xs px-3 py-1.5 t-label text-brand-edge/80 font-mono pointer-events-none">
                      Tap pins to preview incident status
                    </div>
                  )}
                </div>

              </div>
            </div>

          </div>
        </section>

        {/* Editorial Focal Stats Banner (Non-Uniform Asymmetric Layout) */}
        <section className="bg-raised border-b border-line py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-12 gap-4 items-center">
              
              {/* Highlighted Hero Focal Metric: SLA Speed */}
              <div className="md:col-span-5 bg-gradient-to-br from-ink to-brand-strong text-white rounded-xs p-6 border border-brand/60 shadow-md relative overflow-hidden flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <span className="t-label font-mono uppercase tracking-wider text-brand-edge font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-brand-bright" />
                    Target Dispatch SLA
                  </span>
                  <span className="t-micro border border-line-strong px-2 py-1 text-ink-muted">1-hour target</span>
                </div>
                <div className="text-4xl font-extrabold text-white font-mono tracking-tight my-1">
                  &lt; 60 Mins
                </div>
                <p className="text-xs text-brand-wash/80 leading-relaxed">
                  Maximum response window for critical emergency hazard reports across all 12 Legazpi barangays.
                </p>
              </div>

              {/* Secondary Metrics Stack */}
              <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-line rounded-xs p-4 shadow-2xs space-y-1">
                  <div className="text-2xl font-black text-brand font-mono">8</div>
                  <div className="text-xs font-bold text-ink">Municipal Offices</div>
                  <div className="t-label text-ink-muted leading-tight">CDRRMO, 911, BFP, PNP, CEO connected</div>
                </div>

                <div className="bg-white border border-line rounded-xs p-4 shadow-2xs space-y-1">
                  <div className="text-2xl font-black text-brand font-mono">14</div>
                  <div className="text-xs font-bold text-ink">Hazard Types</div>
                  <div className="t-label text-ink-muted leading-tight">Floods, fires, landslides & accidents</div>
                </div>

                <div className="bg-white border border-line rounded-xs p-4 shadow-2xs space-y-1">
                  <div className="text-2xl font-black text-brand font-mono">100%</div>
                  <div className="text-xs font-bold text-ink">Transparent Tracking</div>
                  <div className="t-label text-ink-muted leading-tight">Unique tracking codes for residents</div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Connected Process Flow Timeline */}
        <section id="how-it-works" className="py-16 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <span className="text-xs font-bold text-brand uppercase tracking-wider block mb-1">Simple & Direct</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-ink">How SARO processes citizen hazard reports</h2>
          </div>

          <div className="relative">
            {/* Desktop Connecting Line */}
            <div className="hidden md:block absolute top-1/2 left-10 right-10 h-0.5 bg-gradient-to-r from-brand-edge via-brand to-ink-faint -translate-y-6 z-0" />

            <div className="grid md:grid-cols-3 gap-6 relative z-10">
              
              {/* Step 1: Report */}
              <div className="bg-white border border-line rounded-xs p-6 shadow-xs space-y-4 hover:border-brand/40 transition-all">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-brand-wash text-brand border border-brand-wash flex items-center justify-center">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-ink-muted bg-raised px-2.5 py-1 rounded-full border border-line">STEP 01</span>
                </div>
                <h3 className="text-base font-bold text-ink">1. Pin & Describe Hazard</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Pin exact location on the Legazpi map, attach photo evidence, or use voice dictation. Works offline if disconnected.
                </p>
              </div>

              {/* Step 2: Route */}
              <div className="bg-brand-wash/40 border-2 border-brand/30 rounded-xs p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-brand text-white flex items-center justify-center shadow-md">
                    <Share2 className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-brand bg-white px-2.5 py-1 rounded-full border border-brand-edge">STEP 02</span>
                </div>
                <h3 className="text-base font-bold text-ink">2. Automated Smart Dispatch</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  SARO's routing engine instantly assigns the report to CDRRMO, BFP, 911, or City Engineering based on hazard type and barangay.
                </p>
              </div>

              {/* Step 3: Track */}
              <div className="bg-ink text-white border border-ink rounded-xs p-6 shadow-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-ink text-brand-edge border border-brand-bright/30 flex items-center justify-center">
                    <Activity className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-brand-edge bg-ink px-2.5 py-1 rounded-full border border-brand-bright/30">STEP 03</span>
                </div>
                <h3 className="text-base font-bold text-white">3. Track Until Resolved</h3>
                <p className="text-xs text-brand-wash/80 leading-relaxed">
                  Follow live responder status updates with your unique tracking code until the hazard is verified resolved.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* Connected Agencies with Category Color-Coded Accents */}
        <section id="agencies" className="py-16 bg-white border-y border-line">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-xl mx-auto mb-10">
              <span className="text-xs font-bold text-brand uppercase tracking-wider block mb-1">Unified Response</span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-ink">Connected Legazpi City Emergency Offices</h2>
            </div>

            {/* Primary Responders (Prominent Highlight Cards) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              
              <div className="bg-brand-wash/50 border border-brand-edge border-l-4 border-l-brand rounded-xs p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-ink">CDRRMO</span>
                  <Waves className="w-4 h-4 text-brand" />
                </div>
                <div className="text-xs font-bold text-brand">City Disaster Risk Reduction</div>
                <div className="t-label text-ink-muted leading-tight">Flooding, Landslides & Typhoon Debris</div>
              </div>

              <div className="bg-alert-wash/50 border border-alert border-l-4 border-l-alert rounded-xs p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-ink">Legazpi 911</span>
                  <HeartPulse className="w-4 h-4 text-alert" />
                </div>
                <div className="text-xs font-bold text-alert">911 Command Center</div>
                <div className="t-label text-ink-muted leading-tight">Medical Emergency & Vehicular Collisions</div>
              </div>

              <div className="bg-status-assigned-wash/50 border border-status-assigned-tab border-l-4 border-l-status-assigned-tab rounded-xs p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-ink">BFP Legazpi</span>
                  <Flame className="w-4 h-4 text-status-assigned-tab" />
                </div>
                <div className="text-xs font-bold text-status-assigned-ink">Bureau of Fire Protection</div>
                <div className="t-label text-ink-muted leading-tight">Fire Outbreaks & Gas Leaks</div>
              </div>

              <div className="bg-indigo-50/50 border border-indigo-200 border-l-4 border-l-indigo-600 rounded-xs p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-ink">PNP Legazpi</span>
                  <Shield className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-xs font-bold text-indigo-900">National Police Station</div>
                <div className="t-label text-ink-muted leading-tight">Public Order & Crime Incidents</div>
              </div>

            </div>

            {/* Secondary Support Offices */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { name: "City Engineering", desc: "Road Potholes, Bridges & Drainage", icon: Construction },
                { name: "Public Safety (PSO)", desc: "Traffic & Signal Malfunctions", icon: Radio },
                { name: "City Health (CHO)", desc: "Water Quality & Health Hazards", icon: Droplet },
                { name: "Coast Guard", desc: "Coastal Surge & Marine Emergency", icon: Anchor }
              ].map((office, i) => {
                const IconComponent = office.icon;
                return (
                  <div key={i} className="bg-raised border border-line rounded-xs p-3.5 text-left space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink">{office.name}</span>
                      <IconComponent className="w-3.5 h-3.5 text-ink-muted" />
                    </div>
                    <div className="t-label text-ink-muted leading-tight">{office.desc}</div>
                  </div>
                );
              })}
            </div>

          </div>
        </section>

        {/* Emergency Hotlines Banner */}
        <section id="hotlines" className="py-14 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="bg-gradient-to-r from-brand-strong to-ink rounded-xs p-6 sm:p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-none">
            <div className="space-y-2">
              <div className="text-xs font-bold text-brand-edge uppercase tracking-wider">Immediate Life Threat?</div>
              <h3 className="text-xl sm:text-2xl font-extrabold">Call Legazpi City Emergency Hotlines</h3>
              <p className="text-xs text-brand-wash/80 max-w-lg">
                For life-threatening emergencies requiring immediate rescue or fire response, call hotlines directly or file a report.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <a
                href="tel:911"
                className="px-5 py-3 bg-alert hover:bg-alert text-white font-extrabold text-xs rounded-xs shadow-md flex items-center gap-2 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call 911
              </a>
              <button
                onClick={onSelectResident}
                className="saro-btn-primary py-3 px-5 text-xs font-bold"
              >
                File Emergency Report
              </button>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-ink text-ink-faint border-t border-ink py-10 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Wordmark variant="white" size="md" />
            <div className="flex items-center gap-6 text-line-strong font-semibold">
              <button onClick={onSelectResident} className="hover:text-white transition-colors">Resident Portal</button>
              <button onClick={onSelectOfficer} className="hover:text-white transition-colors">Officer Portal</button>
              <a href="#hotlines" className="hover:text-white transition-colors">Hotlines</a>
            </div>
          </div>

          <div className="border-t border-ink pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 t-label text-ink-faint">
            <div>
              Legazpi City Emergency Operations Center &bull; Heroes of Innovation Challenge 2026
            </div>
            <div>
              Fellowship of the One Door &bull; Dedicated to Isaiah Jotham Reonal
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
