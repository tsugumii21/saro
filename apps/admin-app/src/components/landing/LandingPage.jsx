import React, { useState, useEffect, useCallback } from "react";
import { Shield, ArrowRight, Phone, Clock, MapPin, Radio, Flame, Waves, Construction, Activity, HeartPulse, Droplet, Anchor, Share2, X, Lock } from "lucide-react";
import { Wordmark, StatusTag, HazardMap } from "@saro/ui";
import { getPublicMapReports, getCategories, LEGAZPI_CENTER, saroEvents } from "@saro/shared";

/** MapLibre takes [lng, lat]. */
const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E"
};

export default function LandingPage({ onOpenLogin }) {
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

          {/* Single Generalized Login Action for Staff & Officials */}
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenLogin}
              className="saro-btn-primary text-xs py-2 px-4 shadow-sm min-h-[40px] font-bold inline-flex items-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Login</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Landing Page Content */}
      <main className="flex-1">

        {/* Hero Section with Live Dark Map Preview & Single Login Primary CTA */}
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
                Legazpi City Operations & Dispatch Portal
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
                Unified Operations for City Emergency Response.
              </h1>

              <p className="text-sm sm:text-base text-brand-wash/90 leading-relaxed max-w-xl font-normal">
                <strong className="text-white font-semibold">"SARO"</strong> means <strong className="text-brand-edge font-semibold italic">"One"</strong> in Bikol. Streamlining automated department routing, real-time incident triage, and transparent coordination across all Legazpi offices.
              </p>

              {/* Generalized Login Primary CTA */}
              <div className="pt-2">
                <button
                  onClick={onOpenLogin}
                  className="saro-btn-primary text-sm py-4 px-8 shadow-none rounded-xs font-extrabold inline-flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Shield className="w-5 h-5" />
                  <span>Login to Operations Portal</span>
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

                {/* Dark Map Preview */}
                <div className="flex-1 relative w-full h-full">
                  <HazardMap
                    className="h-full w-full"
                    center={LEGAZPI_CENTER_LNGLAT}
                    zoom={13}
                    showToggles={false}
                    hidden={["rain"]}
                    reports={displayReports.map(({ report: r, count }) => ({
                      id: r.cluster_id || r.id,
                      lat: typeof r.lat === "string" ? parseFloat(r.lat) : r.lat,
                      lng: typeof r.lng === "string" ? parseFloat(r.lng) : r.lng,
                      priority: r.priority,
                      color: STATUS_COLORS[r.status] || STATUS_COLORS.received,
                      onSelect: () => setSelectedReport({ ...r, clusterCount: count }),
                    }))}
                  />

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
                      <div className="t-label text-brand-edge/70 truncate">
                        {selectedReport.description}
                      </div>
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

        {/* Editorial Focal Stats Banner */}
        <section className="bg-raised border-b border-line py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-12 gap-4 items-center">

              {/* SLA Speed Metric */}
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
                  Maximum response window for critical emergency hazard reports across all Legazpi barangays.
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
                  <div className="t-label text-ink-muted leading-tight">Automated audit log & verification</div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Connected Process Flow Timeline */}
        <section id="how-it-works" className="py-16 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <span className="text-xs font-bold text-brand uppercase tracking-wider block mb-1">Simple & Direct</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-ink">How SARO Dispatch Workflow Works</h2>
          </div>

          <div className="relative">
            <div className="hidden md:block absolute top-1/2 left-10 right-10 h-0.5 bg-gradient-to-r from-brand-edge via-brand to-ink-faint -translate-y-6 z-0" />

            <div className="grid md:grid-cols-3 gap-6 relative z-10">

              <div className="bg-white border border-line rounded-xs p-6 shadow-xs space-y-4 hover:border-brand/40 transition-all">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-brand-wash text-brand border border-brand-wash flex items-center justify-center">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-ink-muted bg-raised px-2.5 py-1 rounded-full border border-line">STEP 01</span>
                </div>
                <h3 className="text-base font-bold text-ink">1. Incident Arrival</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Citizen reports land with geo-location, photos, or voice notes. Duplicates are auto-clustered within 150m.
                </p>
              </div>

              <div className="bg-brand-wash/40 border-2 border-brand/30 rounded-xs p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-brand text-white flex items-center justify-center shadow-md">
                    <Share2 className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-brand bg-white px-2.5 py-1 rounded-full border border-brand-edge">STEP 02</span>
                </div>
                <h3 className="text-base font-bold text-ink">2. Automated Smart Dispatch</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  SARO's routing engine assigns incidents to CDRRMO, BFP, 911, or City Engineering based on hazard type and barangay.
                </p>
              </div>

              <div className="bg-ink text-white border border-ink rounded-xs p-6 shadow-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xs bg-ink text-brand-edge border border-brand-bright/30 flex items-center justify-center">
                    <Activity className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-mono font-bold text-brand-edge bg-ink px-2.5 py-1 rounded-full border border-brand-bright/30">STEP 03</span>
                </div>
                <h3 className="text-base font-bold text-white">3. Resolution & Audit</h3>
                <p className="text-xs text-brand-wash/80 leading-relaxed">
                  Responders attach photo proof to close incidents. City directors inspect live SLA metrics and aging queues.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* Connected Agencies */}
        <section id="agencies" className="py-16 bg-white border-y border-line">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-xl mx-auto mb-10">
              <span className="text-xs font-bold text-brand uppercase tracking-wider block mb-1">Unified Response</span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-ink">Connected Legazpi City Emergency Offices</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              {[
                {
                  name: "CDRRMO", Icon: Waves, full: "City Disaster Risk Reduction",
                  handles: "Flooding, Landslides & Typhoon Debris"
                },
                {
                  name: "Legazpi 911", Icon: HeartPulse, full: "911 Command Center",
                  handles: "Medical Emergency & Vehicular Collisions"
                },
                {
                  name: "BFP Legazpi", Icon: Flame, full: "Bureau of Fire Protection",
                  handles: "Fire Outbreaks & Gas Leaks"
                },
                {
                  name: "PNP Legazpi", Icon: Shield, full: "National Police Station",
                  handles: "Public Order & Crime Incidents"
                },
              ].map(({ name, Icon, full, handles }) => (
                <div key={name} className="saro-card space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <span className="t-subhead font-bold text-ink">{name}</span>
                    <Icon className="h-4 w-4 text-brand" aria-hidden="true" />
                  </div>
                  <div className="t-body-sm font-bold text-brand">{full}</div>
                  <div className="t-label leading-tight text-ink-muted">{handles}</div>
                </div>
              ))}
            </div>

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
                For life-threatening emergencies requiring immediate rescue or fire response, call hotlines directly or sign in to dispatch.
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
                onClick={onOpenLogin}
                className="saro-btn-primary py-3 px-5 text-xs font-bold flex items-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>Staff Login</span>
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
              <button onClick={onOpenLogin} className="hover:text-white transition-colors flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-brand-edge" />
                <span>Staff Login</span>
              </button>
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
