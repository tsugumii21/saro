import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  AlertTriangle, MapPin, Navigation, Camera, Mic, MicOff,
  Send, ChevronDown, CheckCircle2, X, Plus, WifiOff, Search, Check,
  Waves, Mountain, Wind, Ambulance, Car, Flame, Wrench, ShieldAlert, Droplets, Anchor,
  Lock, DoorOpen, UserPlus, BellRing, Zap, FileText, Siren, Upload
} from "lucide-react";
import { booleanPointInPolygon, point } from "@turf/turf";
import {
  getCategories, getBarangays, getOffices, createReport, addReportMedia,
  validateReportDraft, LEGAZPI_CENTER, CLIENT_STORAGE_KEYS, useAuth,
  detectEmergencyInDescription,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
} from "@saro/shared";
import { HazardMap } from "@saro/ui";
import ResidentAuthScreen from "../ResidentAuthScreen";
import ReportTicket from "../ReportTicket";

const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];
const LEGAZPI_BOUNDS = { minLat: 13.10, maxLat: 13.20, minLng: 123.70, maxLng: 123.78 };

function getDeviceFingerprint() {
  let fp = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
  if (!fp) {
    fp = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT, fp);
  }
  return fp;
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isInsideLegazpi(lat, lng) {
  return lat >= LEGAZPI_BOUNDS.minLat && lat <= LEGAZPI_BOUNDS.maxLat &&
         lng >= LEGAZPI_BOUNDS.minLng && lng <= LEGAZPI_BOUNDS.maxLng;
}

function getCategoryIcon(cat) {
  const id = cat.id || "";
  if (id.includes("flood")) return Waves;
  if (id.includes("landslide")) return Mountain;
  if (id.includes("debris")) return Wind;
  if (id.includes("medical")) return Ambulance;
  if (id.includes("accident")) return Car;
  if (id.includes("fire") || id.includes("gas")) return Flame;
  if (id.includes("pothole") || id.includes("drain") || id.includes("bridge")) return Wrench;
  if (id.includes("crime") || id.includes("traffic")) return ShieldAlert;
  if (id.includes("water")) return Droplets;
  if (id.includes("coastal")) return Anchor;
  return AlertTriangle;
}

/**
 * Desktop Report Form — Standardized 400px Left Panel + Flex-1 Pin Picker Map.
 *
 * Option 2A: Full-width drag-and-drop photo target zone, un-trapped category list,
 * prominent voice dictation bar, and high-contrast step headers.
 */
export default function ReportDesktop() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { isResident } = useAuth();

  const [showAuthWall, setShowAuthWall] = useState(false);
  const isGuest = !isResident;

  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState(
    searchParams.get("category") || location.state?.category_id || ""
  );
  const [catSearch, setCatSearch] = useState("");
  const [catTab, setCatTab] = useState("all");
  const [description, setDescription] = useState(
    searchParams.get("description") || location.state?.description_summary || ""
  );
  const [coords, setCoords] = useState(null);
  const [barangayId, setBarangayId] = useState("");
  const [barangayAutoDetected, setBarangayAutoDetected] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [boundsError, setBoundsError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueued, setOfflineQueued] = useState(false);

  // Speech recognition
  const [isListening, setIsListening] = useState(false);
  const [speechLang] = useState("fil-PH");
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const keywordEmergency = detectEmergencyInDescription(description);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [cRes, bRes, oRes] = await Promise.all([getCategories(), getBarangays(), getOffices()]);
      if (cRes.data) setCategories(cRes.data);
      if (bRes.data) setBarangays(bRes.data);
      if (oRes.data) setOffices(oRes.data);
    })();
  }, []);

  useEffect(() => {
    const preCategory = searchParams.get("category") || location.state?.category_id;
    const preDesc = searchParams.get("description") || location.state?.description_summary;
    if (preCategory) setSelectedCategoryId(preCategory);
    if (preDesc) setDescription(preDesc);
  }, [searchParams, location]);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  const isEmergencyReport =
    Boolean(selectedCategory?.is_emergency) ||
    Boolean(keywordEmergency);

  const needsAccount = isGuest && Boolean(selectedCategory) && !isEmergencyReport;
  const fileAnonymously = isEmergencyReport || isGuest;

  // Auto-detect barangay from coords
  useEffect(() => {
    if (!coords || barangays.length === 0) return;
    const pt = point([coords.lng, coords.lat]);
    let found = false;
    for (const brgy of barangays) {
      if (brgy.geom && booleanPointInPolygon(pt, brgy.geom)) {
        setBarangayId(brgy.id);
        setBarangayAutoDetected(true);
        found = true;
        break;
      }
    }
    if (!found) setBarangayAutoDetected(false);
  }, [coords, barangays]);

  const handleMapSelect = useCallback((pos) => {
    setBoundsError("");
    setValidationErrors((prev) => ({ ...prev, coords: "" }));
    if (!isInsideLegazpi(pos.lat, pos.lng)) {
      setBoundsError("That location is outside Legazpi City. Please place the pin within city bounds.");
      return;
    }
    setCoords(pos);
  }, []);

  const handleUseMyLocation = () => {
    setBoundsError("");
    if (!navigator.geolocation) {
      setBoundsError("Geolocation is not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!isInsideLegazpi(lat, lng)) {
          setBoundsError("Your current location appears to be outside Legazpi City.");
          return;
        }
        setCoords({ lat, lng });
      },
      () => setBoundsError("Could not access your location. Please click on the map to set pin."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const processFileList = async (files) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (validFiles.length === 0) return;
    try {
      const newPhotos = await Promise.all(validFiles.map((f) => compressPhoto(f)));
      setPhotos((prev) => [...prev, ...newPhotos].slice(0, 5));
    } catch (err) {
      console.error("Photo compression failed:", err);
    }
  };

  const handlePhoto = (e) => {
    processFileList(e.target.files || []);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    processFileList(e.dataTransfer.files || []);
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleSpeech = (lang) => {
    if (!speechSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang ?? speechLang;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setDescription((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const validate = () => {
    const errors = validateReportDraft({
      categoryId: selectedCategoryId,
      coords,
      description,
    });
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    if (needsAccount) {
      setShowAuthWall(true);
      return;
    }

    setSubmitting(true);

    const payload = {
      category_id: selectedCategoryId,
      description: description.trim(),
      lat: coords.lat,
      lng: coords.lng,
      barangay_id: barangayId || null,
      anonymous: fileAnonymously,
      device_fingerprint: getDeviceFingerprint(),
    };

    const queueId = await enqueueReport(payload, { kind: "describe" });
    requestBackgroundSync();

    if (!isOnline) {
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    const { data, error } = await createReport(payload);
    if (error || !data) {
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    await removeFromOutbox(queueId);
    await rememberReport({
      tracking_code: data.tracking_code,
      category: data.category,
      status: data.status,
      kind: "describe",
      created_at: data.created_at,
    });

    if (photos.length > 0) {
      await Promise.all(photos.map((photo) => addReportMedia(data.id, photo, "evidence")));
    }

    setSubmitted(data);
    setSubmitting(false);
  };

  const getAssignedOfficeName = () => {
    if (!submitted) return "";
    const cat = categories.find((c) => c.id === submitted.category_id);
    const office = offices.find((o) => o.id === (cat?.office_id || submitted.office_id));
    return office?.short_name || office?.name || "";
  };

  const clearForm = () => {
    setSubmitted(null);
    setOfflineQueued(false);
    setSelectedCategoryId("");
    setDescription("");
    setCoords(null);
    setBarangayId("");
    setPhotos([]);
    setValidationErrors({});
  };

  const filteredCategories = categories.filter((c) => {
    const matchesSearch = !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase());
    if (catTab === "emergency") return matchesSearch && c.is_emergency;
    if (catTab === "standard") return matchesSearch && !c.is_emergency;
    return matchesSearch;
  });

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">
      {/* ── Left Form Wizard Panel (Standardized 400px) ────────────────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">Describe a Hazard</h1>
          <p className="text-xs text-ink-faint mt-0.5">File a structured incident report for Legazpi City</p>
        </div>

        {/* ── Success / Queued view ───────────────────────────────────── */}
        {submitted ? (
          <div className="p-5 flex flex-col gap-4">
            <div>
              <span className="saro-stamp">Report received</span>
              <p className="text-xs text-ink-muted mt-2">
                {getAssignedOfficeName()
                  ? `${getAssignedOfficeName()} has been notified. Save this tracking code.`
                  : "Your report has reached Legazpi City DRRM. Save this tracking code."}
              </p>
            </div>
            <ReportTicket
              code={submitted.tracking_code}
              categoryLabel={selectedCategory?.name ?? "Hazard Report"}
              filedAt={submitted.created_at}
            />
            <button type="button" onClick={clearForm} className="saro-btn saro-btn-primary saro-btn-block py-2.5">
              File another report
            </button>
            <button type="button" onClick={() => navigate("/track")} className="saro-btn saro-btn-ghost saro-btn-block py-2.5">
              Go to Check a report
            </button>
          </div>
        ) : offlineQueued ? (
          <div className="p-5 flex flex-col gap-4">
            <div className="saro-clip saro-card p-4" style={{ borderColor: "var(--color-ink)" }}>
              <span className="t-label flex items-center gap-2 text-ink-faint">
                <WifiOff width={14} height={14} />
                Waiting to send
              </span>
              <h2 className="text-sm font-bold mt-2">Saved on this device</h2>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                Your report will automatically send when connection is restored.
              </p>
            </div>
            <button type="button" onClick={clearForm} className="saro-btn saro-btn-primary saro-btn-block py-2.5">
              File another report
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-5">

            {/* 1. Category Selection */}
            <div className="flex flex-col gap-2.5">
              <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center justify-between">
                <span>1. Hazard Category</span>
                <span className="text-alert text-xs font-bold">*Required</span>
              </label>

              {/* Emergency vs Standard Filter Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-sunken rounded-md border border-line">
                {[
                  { id: "all", label: "All" },
                  { id: "emergency", label: "🚨 Emergency" },
                  { id: "standard", label: "📋 Standard" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCatTab(tab.id)}
                    className={`flex-1 py-1.5 px-2 rounded text-xs font-bold transition-all ${
                      catTab === tab.id
                        ? "bg-white text-ink shadow-2xs"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Category Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-ink-faint" />
                <input
                  type="text"
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder="Search categories (e.g. flood, drain, debris)..."
                  className="saro-input pl-8 py-2 text-xs w-full"
                />
              </div>

              {validationErrors.category && (
                <p className="text-xs font-bold text-alert">{validationErrors.category}</p>
              )}

              {/* Category Options List — Natural Flow Without Inner Scroll Trap */}
              <div className="grid grid-cols-1 gap-2 pt-1">
                {filteredCategories.map((cat) => {
                  const Icon = getCategoryIcon(cat);
                  const isSelected = selectedCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        if (selectedCategoryId === cat.id) {
                          setSelectedCategoryId("");
                        } else {
                          setSelectedCategoryId(cat.id);
                          setValidationErrors((p) => ({ ...p, category: "" }));
                        }
                      }}
                      className={`flex items-center justify-between p-3 rounded-md text-left transition-all duration-150 ease-out active:scale-[0.985] cursor-pointer ${
                        isSelected
                          ? "bg-brand-wash border-2 border-brand text-brand font-bold shadow-2xs"
                          : "bg-surface border-2 border-line hover:border-brand-edge text-ink"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Icon className={`w-4 h-4 shrink-0 transition-colors duration-150 ${isSelected ? "text-brand" : cat.is_emergency ? "text-panic" : "text-brand"}`} />
                        <span className="text-xs leading-tight truncate">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {cat.is_emergency && !isSelected && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-panic/10 text-panic border border-panic/20 rounded">
                            Urgent
                          </span>
                        )}
                        {isSelected && (
                          <CheckCircle2 className="w-4 h-4 text-brand shrink-0 animate-in fade-in zoom-in-75 duration-150" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Location Selection */}
            <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
              <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center justify-between">
                <span>2. Location Pin</span>
                <span className="text-alert text-xs font-bold">*Required</span>
              </label>

              <button
                type="button"
                onClick={handleUseMyLocation}
                className="saro-btn saro-btn-secondary saro-btn-sm py-2 flex items-center justify-center gap-2"
              >
                <Navigation className="w-4 h-4 text-brand" />
                <span>Use My GPS Position</span>
              </button>

              {coords ? (
                <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <MapPin className="w-4 h-4 text-emerald-700 shrink-0" />
                    <div>
                      <span className="font-bold block">Incident Location Fixed</span>
                      <span className="text-[11px] font-mono text-emerald-800">
                        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-emerald-700" />
                </div>
              ) : (
                <div className="p-3 rounded bg-raised border border-line text-xs text-ink-muted flex items-center gap-2.5">
                  <MapPin className="w-4 h-4 text-brand shrink-0 animate-bounce" />
                  <span>Click anywhere on the right-hand map canvas to set pin.</span>
                </div>
              )}

              {boundsError && <p className="text-xs font-bold text-alert">{boundsError}</p>}
              {validationErrors.coords && <p className="text-xs font-bold text-alert">{validationErrors.coords}</p>}

              {/* Barangay Dropdown */}
              {barangays.length > 0 && (
                <div className="mt-1">
                  <span className="text-[11px] font-semibold text-ink-faint block mb-1">Barangay (Optional)</span>
                  <select
                    value={barangayId}
                    onChange={(e) => {
                      setBarangayId(e.target.value);
                      setBarangayAutoDetected(false);
                    }}
                    className="saro-input text-xs w-full py-2"
                  >
                    <option value="">-- Select Barangay --</option>
                    {barangays.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 3. Description & Voice Dictation Bar */}
            <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
              <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center justify-between">
                <span>3. Incident Description</span>
                <span className="text-alert text-xs font-bold">*Required</span>
              </label>

              {/* Prominent Voice Dictation Bar */}
              {speechSupported && (
                <div className="p-2.5 rounded-md bg-sunken border border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-brand" />
                    <span className="text-xs font-bold text-ink">Bikol / Tagalog Voice Input</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSpeech()}
                    className={`saro-btn saro-btn-sm text-xs py-1 px-3 ${
                      isListening ? "bg-panic text-white animate-pulse" : "saro-btn-secondary"
                    }`}
                  >
                    {isListening ? "Listening... Stop" : "Start Voice"}
                  </button>
                </div>
              )}

              <textarea
                rows={4}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setValidationErrors((p) => ({ ...p, description: "" }));
                }}
                placeholder="Describe details: flood depth, road blockage, structural damage..."
                className="w-full text-xs p-3 rounded-md border-2 border-line-strong hover:border-brand-edge focus:border-brand focus:ring-2 focus:ring-brand/20 bg-surface text-ink placeholder:text-ink-muted/80 resize-none leading-relaxed transition-all shadow-2xs outline-none font-medium"
              />

              {keywordEmergency && (
                <div className="p-2.5 rounded bg-panic-wash border border-panic/30 text-panic text-xs font-bold flex items-center gap-2">
                  <Siren className="w-4 h-4 shrink-0 text-panic" />
                  <span>Emergency words detected — files immediately &amp; anonymously.</span>
                </div>
              )}

              {validationErrors.description && (
                <p className="text-xs font-bold text-alert">{validationErrors.description}</p>
              )}
            </div>

            {/* 4. Desktop Drag & Drop Photo Upload Zone (Option 2A) */}
            <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
              <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center justify-between">
                <span>4. Photo Evidence (Optional)</span>
                <span className="text-xs text-ink-faint font-normal">Max 5 photos</span>
              </label>

              {/* Drag & Drop Target Box */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative p-5 rounded-md border-2 border-dashed transition-all text-center flex flex-col items-center justify-center gap-2 cursor-pointer ${
                  isDragOver
                    ? "border-brand bg-brand-wash/60"
                    : "border-line bg-raised hover:border-brand-edge hover:bg-brand-wash/20"
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhoto}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="w-10 h-10 rounded-full bg-brand-wash text-brand border border-brand-edge flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-ink block">Drag &amp; drop photos here</span>
                  <span className="text-[11px] text-ink-muted block mt-0.5">
                    or click to browse files from your computer
                  </span>
                </div>
              </div>

              {/* Photo Previews */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {photos.map((p, idx) => (
                    <div key={idx} className="relative aspect-square rounded border border-line overflow-hidden bg-sunken group shadow-2xs">
                      <img src={p} alt={`Evidence ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 bg-black/70 hover:bg-panic text-white p-1 rounded-full transition-colors"
                        title="Remove photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit CTA */}
            <div className="pt-3 border-t border-line">
              <button
                type="submit"
                disabled={submitting}
                className="saro-btn saro-btn-primary saro-btn-block flex items-center justify-center gap-2 py-3 text-sm font-bold shadow-md"
              >
                <Send className="w-4.5 h-4.5" />
                <span>{submitting ? "Submitting Report..." : "Submit Hazard Report"}</span>
              </button>

              <p className="text-xs text-ink-faint text-center mt-2 leading-tight">
                {needsAccount
                  ? "Standard report: Requires sign-in on submit."
                  : "Urgent emergency: Files anonymously without account."}
              </p>
            </div>
          </form>
        )}
      </aside>

      {/* ── Right Panel: Live Map Picker (flex-1) ────────────────────── */}
      <div className="relative min-w-0 flex-1 h-full overflow-hidden">
        {/* Map Header Instruction Banner */}
        <div className="absolute top-3 left-4 right-4 z-20 bg-surface/95 backdrop-blur border border-line px-4 py-2.5 rounded-md shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-brand" />
            <span className="text-xs font-bold text-ink">Incident Pin Location</span>
            <span className="text-xs text-ink-muted">· Click anywhere on the map canvas to set pin</span>
          </div>
          {coords && (
            <span className="text-xs font-mono font-bold text-brand bg-brand-wash px-2.5 py-1 rounded border border-brand-edge">
              Pin set: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </span>
          )}
        </div>

        <HazardMap
          className="h-full w-full"
          center={coords ? [coords.lng, coords.lat] : LEGAZPI_CENTER_LNGLAT}
          zoom={13}
          onPick={handleMapSelect}
          onSelectLocation={handleMapSelect}
          reports={
            coords
              ? [
                  {
                    id: "draft-pin",
                    lat: coords.lat,
                    lng: coords.lng,
                    priority: "high",
                    color: "var(--color-panic)",
                  },
                ]
              : []
          }
        />
      </div>

      {/* Auth Modal Wall for Standard Reports */}
      {showAuthWall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm">
          <div className="relative z-10 w-full max-w-md bg-surface shadow-xl border border-line rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-line bg-surface">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">Account Required</span>
              <button onClick={() => setShowAuthWall(false)} className="p-1 hover:bg-raised rounded">
                <X className="w-4 h-4 text-ink-muted" />
              </button>
            </div>
            <ResidentAuthScreen
              mode="sign-in"
              reason="Standard non-emergency reports require a resident account so city offices can send resolution updates."
              onCancel={() => setShowAuthWall(false)}
              onSignedIn={() => {
                setShowAuthWall(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
