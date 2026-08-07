import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  AlertTriangle, MapPin, Navigation, Camera, Mic, MicOff,
  Send, ChevronDown, Phone, Users, CheckCircle2, Copy, X, Plus, WifiOff, Search, Check,
  Waves, Mountain, Wind, Ambulance, Car, Flame, Wrench, ShieldAlert, Droplets, Anchor
} from "lucide-react";
import { booleanPointInPolygon, point } from "@turf/turf";
import {
  getCategories, getBarangays, getOffices, createReport, addReportMedia,
  validateReportDraft, LEGAZPI_CENTER, CLIENT_STORAGE_KEYS, useAuth
} from "@saro/shared";
import ResidentAuthScreen from "./ResidentAuthScreen";

const LEGAZPI_BOUNDS = { minLat: 13.10, maxLat: 13.20, minLng: 123.70, maxLng: 123.78 };
const OFFLINE_QUEUE_KEY = CLIENT_STORAGE_KEYS.OFFLINE_QUEUE;

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

const pinIcon = L.divIcon({
  className: "saro-pin",
  html: `<div style="width:20px;height:20px;background:#1B2E6B;border:2px solid #fff;box-shadow:0 1px 4px rgba(16,23,37,.4);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });
  return null;
}

function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 16, { duration: 0.8 });
  }, [position, map]);
  return null;
}

// Offline queue helpers
function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
  } catch { return []; }
}

function saveToOfflineQueue(payload) {
  const queue = getOfflineQueue();
  queue.push({ ...payload, queued_at: new Date().toISOString() });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export default function ReportFormScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { isResident } = useAuth();

  // The login wall, and the rules around it.
  //
  // A guest may always file an EMERGENCY report anonymously — that is the whole
  // reason Describe exists as a second channel next to Panic, and putting a
  // signup form in front of someone watching a fire would defeat it.
  //
  // Only a STANDARD, non-urgent report asks for an account, and only at the
  // moment of submit. Never on app open, never on category select, never while
  // typing.
  const [showAuthWall, setShowAuthWall] = useState(false);

  // Replaces the prototype's `guestBlock`, which showed a dead-end "verified
  // accounts arrive in a later phase" notice. The accounts exist now.
  const isGuest = !isResident;

  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState(
    searchParams.get("category") || location.state?.category_id || ""
  );
  const [catSearch, setCatSearch] = useState("");
  const [catTab, setCatTab] = useState("all"); // "all" | "emergency" | "standard"
  const [description, setDescription] = useState(
    searchParams.get("description") || location.state?.description_summary || ""
  );
  const [coords, setCoords] = useState(null);
  const [barangayId, setBarangayId] = useState("");
  const [barangayAutoDetected, setBarangayAutoDetected] = useState(false);
  const [photos, setPhotos] = useState([]); // Multiple photos support
  const [callbackNumber, setCallbackNumber] = useState("");
  const [isProxy, setIsProxy] = useState(false);

  const [boundsError, setBoundsError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueued, setOfflineQueued] = useState(false);

  // Speech recognition state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Online/offline detection
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

  // Load reference data
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

  // An emergency category is filed anonymously by anyone, always. Note this is
  // computed, not stored in state and not asserted anywhere in the UI while the
  // form is being filled — the guest only ever meets it at submit.
  const isEmergencyReport = Boolean(selectedCategory?.is_emergency);

  // Guests must sign in for standard reports only.
  const needsAccount = isGuest && Boolean(selectedCategory) && !isEmergencyReport;

  // Emergencies go in under a device id; everything else under the account.
  const fileAnonymously = isEmergencyReport || isGuest;

  // Auto-detect barangay
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
    if (!found) {
      setBarangayAutoDetected(false);
    }
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
          setBoundsError("Your current location appears to be outside Legazpi City. Please place the pin manually on the map.");
          return;
        }
        setCoords({ lat, lng });
      },
      () => {
        setBoundsError("Could not access your location. Please place the pin manually on the map.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Multi-photo attachment
  const handlePhoto = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const newPhotos = await Promise.all(files.map((f) => compressPhoto(f)));
      setPhotos((prev) => [...prev, ...newPhotos].slice(0, 5)); // max 5 photos
    } catch (err) {
      console.error("Photo compression failed:", err);
    }
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Web Speech API
  const toggleSpeech = () => {
    if (!speechSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-PH";
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

  // Validate form against the shared schema
  const validate = () => {
    const errors = validateReportDraft({
      categoryId: selectedCategoryId,
      coords,
      description,
      isProxy,
      callbackNumber
    });
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    // The only login prompt in the app, and it fires here — after the form is
    // filled and valid, never before. An emergency category walks straight
    // past it.
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
      callback_number: callbackNumber.trim() || null,
      is_proxy_report: isProxy,
      // Urgent reports stay anonymous even for signed-in residents: filing
      // fast should never mean attaching your name.
      anonymous: fileAnonymously,
      device_fingerprint: getDeviceFingerprint()
    };

    // Offline queuing
    if (!isOnline) {
      saveToOfflineQueue(payload);
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    const { data, error } = await createReport(payload);

    if (error) {
      setSubmitting(false);
      return;
    }

    // Save photo evidence if attached
    if (photos.length > 0 && data) {
      await Promise.all(photos.map((photo) => addReportMedia(data.id, photo, "evidence")));
    }

    setSubmitted(data);
    setSubmitting(false);
  };

  // Get assigned office name for success screen
  const getAssignedOfficeName = () => {
    if (!submitted) return "";
    const cat = categories.find((c) => c.id === submitted.category_id);
    const office = offices.find((o) => o.id === (cat?.office_id || submitted.office_id));
    return office?.short_name || office?.name || "";
  };

  // Offline queued confirmation
  // The login wall. Reached only from handleSubmit, only for a standard report
  // filed by a guest. Everything typed so far stays in state, so signing in
  // returns straight to a filled form rather than an empty one — and
  // "Continue without an account" backs out to the same place.
  if (showAuthWall) {
    return (
      <ResidentAuthScreen
        mode="sign-up"
        reason="Standard reports need an account so the office can follow up with you. Emergencies never do — pick an emergency category and you can file straight away, anonymously."
        onCancel={() => setShowAuthWall(false)}
        onSignedIn={() => setShowAuthWall(false)}
      />
    );
  }

  if (offlineQueued) {
    return (
      <div className="px-4 py-6 max-w-md mx-auto">
        <div className="bg-white rounded-xs border border-line p-5">
          <div className="flex items-center gap-2 text-status-assigned-tab font-semibold text-base mb-3">
            <WifiOff className="w-5 h-5" />
            Report saved offline
          </div>
          <p className="text-sm text-ink-muted mb-4">
            Your report has been saved locally and will be automatically submitted once your connection returns. You'll receive a tracking code after it syncs.
          </p>
          <div className="bg-status-assigned-tab/10 border border-status-assigned-tab/30 rounded-xs px-4 py-3 text-xs text-status-assigned-ink font-medium mb-4">
            Pending sync — {getOfflineQueue().length} report(s) queued
          </div>
          <button
            onClick={() => {
              setOfflineQueued(false);
              setSelectedCategoryId("");
              setDescription("");
              setCoords(null);
              setPhotos([]);
              setCallbackNumber("");
              setIsProxy(false);
            }}
            className="saro-btn-primary w-full"
          >
            File another report
          </button>
        </div>
      </div>
    );
  }

  // Success confirmation screen
  if (submitted) {
    return (
      <div className="px-4 py-6 max-w-md mx-auto">
        <div className="bg-white rounded-xs border border-line p-5">
          <div className="flex items-center gap-2 text-brand font-semibold text-base mb-3">
            <CheckCircle2 className="w-5 h-5" />
            Report received
          </div>

          <p className="text-sm text-ink-muted mb-2">
            Your report has been logged and will be routed to the appropriate office.
          </p>
          {getAssignedOfficeName() && (
            <p className="text-xs text-brand font-semibold mb-4">
              Assigned to: {getAssignedOfficeName()}
            </p>
          )}

          <div className="bg-raised rounded-xs p-4 border border-line mb-4 text-center">
            <div className="t-label uppercase text-ink-muted font-medium tracking-wider mb-1">Tracking Code</div>
            <div className="text-2xl font-bold text-ink tracking-widest font-mono mb-2">
              {submitted.tracking_code}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(submitted.tracking_code);
              }}
              className="inline-flex items-center gap-1.5 text-xs text-brand font-medium px-3 py-1.5 rounded border border-brand/30 active:bg-brand-wash"
              aria-label="Copy tracking code"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy code
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/track?code=${submitted.tracking_code}`)}
              className="saro-btn-primary flex-1"
            >
              Track this report
            </button>
            <button
              onClick={() => {
                setSubmitted(null);
                setSelectedCategoryId("");
                setDescription("");
                setCoords(null);
                setBarangayId("");
                setPhotos([]);
                setCallbackNumber("");
                setIsProxy(false);
                setValidationErrors({});
              }}
              className="flex-1 py-2.5 bg-raised text-ink rounded-xs text-sm font-semibold border border-line active:bg-sunken"
            >
              File another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 max-w-md mx-auto pb-24">
      <div className="mb-4">
        <h2 className="text-base font-bold text-ink">File a Hazard Report</h2>
        <p className="text-xs text-ink-muted mt-0.5">
          One front door for Legazpi City. We route your report to the correct office.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Thumb-Friendly Un-truncated Category Picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-bold text-ink uppercase tracking-wider">
              What Type of Hazard? <span className="text-alert">*</span>
            </label>
            {selectedCategory && (
              <span className="text-xs text-brand font-bold flex items-center gap-1 bg-brand-wash px-2 py-0.5 rounded border border-brand-edge">
                <CheckCircle2 className="w-3.5 h-3.5 text-brand" />
                {selectedCategory.name}
              </span>
            )}
          </div>

          {/* Scaled Search Bar */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-ink-faint" />
            <input
              type="text"
              placeholder="e.g. flood, fire, pothole, medical..."
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
              className="w-full text-sm pl-10 pr-9 py-2.5 rounded-xs border border-line bg-white text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 font-medium"
            />
            {catSearch && (
              <button
                type="button"
                onClick={() => setCatSearch("")}
                className="absolute right-3 top-2.5 text-xs text-ink-faint hover:text-ink font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* High Contrast Emergency / Non-Urgent Filter Pills */}
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none pb-0.5">
            {[
              { id: "all", label: `All (${categories.length})` },
              { id: "emergency", label: `Emergency (${categories.filter((c) => c.is_emergency).length})` },
              { id: "standard", label: `Non-Urgent (${categories.filter((c) => !c.is_emergency).length})` }
            ].map((tab) => {
              const isActive = catTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCatTab(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${
                    isActive
                      ? "bg-ink text-white shadow-sm border border-ink"
                      : "bg-sunken text-ink-muted border border-line hover:bg-line hover:text-ink"
                  }`}
                >
                  {isActive && <Check className="w-3.5 h-3.5 text-brand-edge stroke-[3]" />}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Thumb-Friendly Category Cards List (Un-truncated, multi-line wrapping, icons, colored left border) */}
          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {categories
              .filter((cat) => {
                if (catTab === "emergency" && !cat.is_emergency) return false;
                if (catTab === "standard" && cat.is_emergency) return false;
                if (catSearch) {
                  const q = catSearch.toLowerCase();
                  return (
                    cat.name.toLowerCase().includes(q) ||
                    (cat.name_bikol || "").toLowerCase().includes(q) ||
                    (cat.name_tagalog || "").toLowerCase().includes(q)
                  );
                }
                return true;
              })
              .map((cat) => {
                const isSelected = selectedCategoryId === cat.id;
                const IconComp = getCategoryIcon(cat);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setValidationErrors((prev) => ({ ...prev, category: "" }));
                    }}
                    className={`w-full text-left p-3.5 rounded-xs border-2 transition-all flex items-start justify-between gap-3 ${
                      cat.is_emergency ? "border-l-4 border-l-red-500" : "border-l-4 border-l-slate-400"
                    } ${
                      isSelected
                        ? "bg-brand-wash/80 border-brand shadow-sm"
                        : cat.is_emergency
                        ? "bg-alert-wash/20 border-line hover:border-alert hover:bg-alert-wash/40"
                        : "bg-white border-line hover:border-line-strong active:bg-raised"
                    }`}
                  >
                    {/* Left Icon Badge */}
                    <div className={`w-10 h-10 rounded-xs flex items-center justify-center shrink-0 mt-0.5 ${
                      cat.is_emergency ? "bg-alert-wash text-alert border border-alert" : "bg-sunken text-brand border border-line"
                    }`}>
                      <IconComp className="w-5 h-5" />
                    </div>

                    {/* Un-truncated Title & Subtitle */}
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-sm text-ink leading-snug">
                          {cat.name}
                        </span>
                        {cat.is_emergency ? (
                          <span className="inline-flex items-center gap-1 t-micro font-extrabold px-2 py-0.5 rounded bg-alert-wash text-alert border border-alert uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" /> Emergency
                          </span>
                        ) : (
                          <span className="inline-flex items-center t-micro font-bold px-2 py-0.5 rounded bg-sunken text-ink-muted border border-line uppercase tracking-wider">
                            Non-Urgent
                          </span>
                        )}
                      </div>

                      {cat.name_bikol && (
                        <p className="text-xs text-ink-muted font-medium leading-relaxed">
                          {cat.name_bikol}
                        </p>
                      )}
                    </div>

                    {/* Selection Radio Circle */}
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${
                      isSelected ? "border-brand bg-brand text-white" : "border-line-strong bg-white"
                    }`}>
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}

            {categories.filter((cat) => {
              if (catTab === "emergency" && !cat.is_emergency) return false;
              if (catTab === "standard" && cat.is_emergency) return false;
              if (catSearch) {
                const q = catSearch.toLowerCase();
                return cat.name.toLowerCase().includes(q) || (cat.name_bikol || "").toLowerCase().includes(q);
              }
              return true;
            }).length === 0 && (
              <div className="text-center py-6 text-xs text-ink-faint bg-raised rounded-xs border border-line font-medium">
                No matching hazard categories found. Try clearing your search.
              </div>
            )}
          </div>

          {validationErrors.category && (
            <p className="text-xs text-alert mt-1.5 font-medium">{validationErrors.category}</p>
          )}
        </div>

        {/* Nothing gates the form here on purpose. The prototype showed a
            dead-end notice the moment a guest picked a non-emergency category,
            which is a login prompt in all but name. The account is asked for at
            submit instead, once the person has decided what they are reporting. */}

        {/* Location Section */}
        <div>
          <label className="block text-xs font-semibold text-ink mb-1.5">
            Where is it? <span className="text-alert">*</span>
          </label>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={handleUseMyLocation}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-line rounded-xs text-xs font-medium text-ink active:bg-raised min-h-[44px]"
            >
              <Navigation className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              Use my location
            </button>
            <span className="t-label text-ink-muted">or tap the map below</span>
          </div>

          {boundsError && (
            <p className="text-xs text-alert mb-2 bg-alert-wash border border-alert rounded-xs px-3 py-2">
              {boundsError}
            </p>
          )}

          <div className="h-44 rounded-xs overflow-hidden border border-line relative">
            <MapContainer
              center={LEGAZPI_CENTER}
              zoom={14}
              scrollWheelZoom={true}
              className="w-full h-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />
              <MapClickHandler onSelect={handleMapSelect} />
              {coords && (
                <>
                  <Marker position={[coords.lat, coords.lng]} icon={pinIcon} />
                  <FlyTo position={coords} />
                </>
              )}
            </MapContainer>
          </div>

          {coords && (
            <p className="t-label text-ink-muted mt-1.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-brand" aria-hidden="true" />
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              {barangayAutoDetected && (
                <span className="text-brand font-medium">
                  &mdash; {barangays.find((b) => b.id === barangayId)?.name}
                </span>
              )}
            </p>
          )}
          {validationErrors.coords && (
            <p className="text-xs text-alert mt-1.5 font-medium">{validationErrors.coords}</p>
          )}
        </div>

        {/* Barangay Override */}
        {coords && !barangayAutoDetected && (
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Barangay <span className="text-ink-muted font-normal">(auto-detection missed; select manually)</span>
            </label>
            <div className="relative">
              <select
                value={barangayId}
                onChange={(e) => setBarangayId(e.target.value)}
                className="w-full text-xs py-2.5 px-3 rounded-xs border border-line bg-white text-ink font-medium appearance-none pr-8"
              >
                <option value="">Select barangay</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-ink-muted pointer-events-none" />
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            What happened? <span className="text-alert">*</span>
          </label>
          <div className="relative">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => { setDescription(e.target.value); setValidationErrors((prev) => ({ ...prev, description: "" })); }}
              placeholder="Describe what you see. Be specific about the location and danger."
              className="w-full text-sm p-3 rounded-xs border border-line bg-white text-ink placeholder:text-ink-muted resize-none"
            />
            {speechSupported && (
              <button
                type="button"
                onClick={toggleSpeech}
                className={`absolute bottom-2.5 right-2.5 p-2 rounded-full transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${
                  isListening
                    ? "bg-alert text-white animate-pulse"
                    : "bg-raised text-ink-muted active:bg-line"
                }`}
                title={isListening ? "Stop dictation" : "Speak to type"}
                aria-label={isListening ? "Stop dictation" : "Speak to type"}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
          </div>
          {validationErrors.description && (
            <p className="text-xs text-alert mt-1 font-medium">{validationErrors.description}</p>
          )}
        </div>

        {/* Photo Evidence — Multi-photo */}
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Photo evidence <span className="text-ink-muted font-normal">(optional, up to 5)</span>
          </label>
          {photos.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar">
              {photos.map((photo, i) => (
                <div key={i} className="relative shrink-0 w-24 h-24">
                  <img
                    src={photo}
                    alt={`Evidence ${i + 1}`}
                    className="w-full h-full object-cover rounded-xs border border-line"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1.5 -right-1.5 bg-ink text-white w-5 h-5 rounded-full flex items-center justify-center t-micro"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            <label className="flex items-center gap-2 px-4 py-3 bg-white border border-line border-dashed rounded-xs cursor-pointer active:bg-raised min-h-[44px]">
              {photos.length > 0 ? (
                <Plus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
              ) : (
                <Camera className="w-5 h-5 text-ink-muted" aria-hidden="true" />
              )}
              <span className="text-xs text-ink-muted font-medium">
                {photos.length > 0 ? "Add another photo" : "Take photo or choose from gallery"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhoto}
              />
            </label>
          )}
        </div>

        {/* Proxy Reporting Toggle */}
        <div className="bg-white rounded-xs border border-line p-3">
          <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={isProxy}
              onChange={(e) => setIsProxy(e.target.checked)}
              className="w-4 h-4 rounded border-line text-brand accent-brand"
            />
            <div>
              <span className="text-xs font-semibold text-ink flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-ink-muted" aria-hidden="true" />
                Reporting for someone else
              </span>
              <span className="t-label text-ink-muted block mt-0.5">
                They will need the tracking code. A callback number is required.
              </span>
            </div>
          </label>

          {isProxy && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-ink mb-1">
                Callback number <span className="text-alert">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-2.5 text-ink-muted" aria-hidden="true" />
                <input
                  type="tel"
                  value={callbackNumber}
                  onChange={(e) => { setCallbackNumber(e.target.value); setValidationErrors((prev) => ({ ...prev, callback: "" })); }}
                  placeholder="09XX-XXX-XXXX"
                  className="w-full text-sm py-2.5 pl-9 pr-3 rounded-xs border border-line bg-white text-ink placeholder:text-ink-muted"
                  required={isProxy}
                />
              </div>
              {validationErrors.callback && (
                <p className="text-xs text-alert mt-1 font-medium">{validationErrors.callback}</p>
              )}
            </div>
          )}
        </div>

        {/* Sticky Submit Button */}
        <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 bg-gradient-to-t from-canvas via-canvas/95 to-transparent pt-4">
          <div className="max-w-md mx-auto">
            {!isOnline && (
              <div className="flex items-center gap-1.5 t-label text-status-assigned-ink bg-status-assigned-tab/10 border border-status-assigned-tab/30 rounded-xs px-3 py-1.5 mb-2 font-medium">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                Offline — report will be queued for later submission
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="saro-btn-primary w-full"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              {submitting ? "Submitting..." : isOnline ? "Submit report" : "Save report offline"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
