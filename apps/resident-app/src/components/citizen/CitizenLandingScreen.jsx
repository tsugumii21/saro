import { useNavigate } from "react-router-dom";
import { PlusCircle, Search, PhoneCall, ShieldCheck, Clock, Building2, MapPin, Lock, ChevronRight } from "lucide-react";
import { Wordmark } from "@saro/ui";

export default function CitizenLandingScreen({ onStartReport, onTrackReport, onStaffLogin }) {
  const navigate = useNavigate();

  const handleStartReport = () => {
    if (onStartReport) onStartReport();
    else navigate("/report");
  };

  const handleTrackReport = () => {
    if (onTrackReport) onTrackReport();
    else navigate("/track");
  };

  const handleStaffLogin = () => {
    if (onStaffLogin) onStaffLogin();
    else navigate("/login");
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 font-sans flex flex-col justify-between p-4 max-w-md mx-auto pb-8">
      
      {/* 1. Header Bar */}
      <div className="space-y-4">
        <header className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between shadow-2xs">
          <Wordmark variant="teal" size="md" />
          <div className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full text-[11px] font-bold text-teal-800">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
            <span>Legazpi CDRRMO</span>
          </div>
        </header>

        {/* Official City Status Badge */}
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Official Civic Portal &bull; City Government of Legazpi
        </div>

        {/* 2. Hero Section */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xs">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 leading-tight">
              Report a Hazard in Seconds
            </h1>
            <p className="text-xs text-slate-600 font-medium leading-relaxed mt-2">
              One public front door for Legazpi City. Your report is automatically routed to CDRRMO, Legazpi 911, BFP, PNP, or City Engineering based on hazard type.
            </p>
          </div>

          {/* 3. Primary CTA Button */}
          <button
            onClick={handleStartReport}
            className="w-full min-h-[52px] bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold text-base rounded-xl transition-all shadow-md flex items-center justify-center gap-2.5 active:scale-[0.98]"
          >
            <PlusCircle className="w-5 h-5 stroke-[2.5]" />
            <span>Report a Hazard</span>
          </button>

          {/* 4. Secondary CTA Button */}
          <button
            onClick={handleTrackReport}
            className="w-full min-h-[48px] bg-white border-2 border-slate-300 hover:border-teal-700 text-slate-800 font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 active:bg-slate-50"
          >
            <Search className="w-4 h-4 text-slate-600" />
            <span>Track My Report</span>
          </button>
        </div>

        {/* 5. Emergency Hotline Shortcut Strip */}
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-red-800 uppercase tracking-wider flex items-center gap-1.5">
              <PhoneCall className="w-4 h-4 text-red-600" />
              Immediate Life Emergency?
            </span>
            <span className="text-[10px] font-extrabold bg-red-200 text-red-900 px-2 py-0.5 rounded uppercase">
              24/7 Hotline
            </span>
          </div>

          <p className="text-xs text-red-700 font-medium leading-relaxed">
            For critical accidents or active fires needing instant dispatch, call directly:
          </p>

          <div className="flex items-center gap-2 pt-1">
            <a
              href="tel:911"
              className="flex-1 min-h-[44px] bg-red-700 hover:bg-red-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              Call 911 Direct
            </a>
            <a
              href="tel:0524801911"
              className="flex-1 min-h-[44px] bg-white border border-red-300 text-red-800 hover:bg-red-100 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-colors"
            >
              (052) 480-1911
            </a>
          </div>
        </div>

        {/* 6. Trust & Coverage Inline Stats Strip */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            System Operational Stats & Coverage
          </span>

          <div className="grid grid-cols-3 gap-2 text-center divide-x divide-slate-200">
            <div className="px-1">
              <div className="font-mono text-sm font-extrabold text-teal-800">&lt; 3 Mins</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Avg Dispatch</div>
            </div>
            <div className="px-1">
              <div className="font-mono text-sm font-extrabold text-slate-900">70 Barangays</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Citywide Coverage</div>
            </div>
            <div className="px-1">
              <div className="font-mono text-sm font-extrabold text-slate-900">8 Offices</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Connected EOC</div>
            </div>
          </div>
        </div>

      </div>

      {/* 7. Footer */}
      <footer className="pt-6 border-t border-slate-200 text-center space-y-1 mt-4">
        <p className="text-[11px] text-slate-500 font-semibold">
          SARO Hazard Reporting &bull; CDRRMO EOC Legazpi City
        </p>
        <p className="text-[10px] text-slate-400 font-medium">
          Official Civic Emergency Portal
        </p>
      </footer>

    </div>
  );
}
