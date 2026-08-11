import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  AlertTriangle, MapPin, Navigation, Camera, Mic, MicOff,
  Send, ChevronDown, CheckCircle2, X, Plus, WifiOff, Search, Check,
  Lock, DoorOpen, UserPlus, Zap, FileText, Siren
} from "lucide-react";
import { booleanPointInPolygon, point } from "@turf/turf";
import { getCategoryIcon } from "../../../lib/categoryIcons.js";
import {
  getCategories, getBarangays, getOffices, createReport, updateSosReportDetails, addReportMedia,
  validateReportDraft, LEGAZPI_CENTER, CLIENT_STORAGE_KEYS, useAuth,
  detectEmergencyInDescription,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
  getCategoryTier,
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

/**
 * Desktop Report Form — Standardized 400px Left Panel + Flex-1 Pin Picker Map.
 *
 * The panel runs the same flow, in the same order, with the same components as
 * the mobile ReportFormScreen: describe first, confirm the category second,
 * place the pin, attach photos, submit. Only the map differs — mobile inlines a
 * short picker, desktop hands the whole right-hand canvas to it.
 */
export default function ReportDesktop() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { isResident } = useAuth();
  const sosReport = location.state?.sosReport;
  const activeSosReportId = sosReport?.id || searchParams.get("sos_id") || "";
  const activeSosTrackingCode = sosReport?.tracking_code || searchParams.get("panic") || "";
  const activeSosCategoryId = sosReport?.category || searchParams.get("category") || "";
  const isSosDetailsFlow = Boolean(
    activeSosReportId && activeSosTrackingCode && activeSosCategoryId
  );

  const [showAuthWall, setShowAuthWall] = useState(false);
  const isGuest = !isResident;

  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState(
    activeSosCategoryId || location.state?.category_id || ""
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
    if (!speechSupported) {
      setValidationErrors((prev) => ({
        ...prev,
        description: "Voice dictation is not supported by your browser. Please type your description.",
      }));
      return;
    }
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch (err) {
        console.warn("Speech stop warning:", err);
      }
      setIsListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang ?? speechLang ?? "fil-PH";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript + " ";
        }
      }
      if (finalChunk.trim()) {
        const textToAppend = finalChunk.trim();
        setDescription((prev) => (prev ? `${prev} ${textToAppend}` : textToAppend));
        setValidationErrors((p) => ({ ...p, description: "" }));
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") {
        setValidationErrors((prev) => ({
          ...prev,
          description: "Microphone access denied. Please grant microphone permission in your browser.",
        }));
      } else if (event.error === "language-not-supported") {
        // Fallback to English if Tagalog is unsupported on this browser engine
        toggleSpeech("en-US");
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (err) {
      console.error("Speech start error:", err);
      setIsListening(false);
    }
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
    const writePayload = isSosDetailsFlow
      ? {
          report_id: activeSosReportId,
          tracking_code: activeSosTrackingCode,
          description: payload.description,
          lat: payload.lat,
          lng: payload.lng,
          barangay_id: payload.barangay_id,
          device_fingerprint: payload.device_fingerprint,
        }
      : payload;

    const queueId = await enqueueReport(writePayload, {
      kind: isSosDetailsFlow ? "sos_details" : "describe",
      operation: isSosDetailsFlow ? "update_sos" : "create",
    });
    requestBackgroundSync();

    if (!isOnline) {
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    const { data, error } = isSosDetailsFlow
      ? await updateSosReportDetails(writePayload)
      : await createReport(writePayload);
    if (error || !data) {
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    await removeFromOutbox(queueId);
    if (!isSosDetailsFlow) {
      await rememberReport({
        tracking_code: data.tracking_code,
        category: data.category,
        status: data.status,
        kind: "describe",
        created_at: data.created_at,
      });
    }

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

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">
      {/* ── Left Form Wizard Panel (Standardized 400px) ────────────────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">
            {isSosDetailsFlow ? "Add S.O.S. Details" : "Describe a Hazard"}
          </h1>
          <p className="text-xs text-ink-faint mt-0.5">
            {isSosDetailsFlow
              ? `Updating ${activeSosTrackingCode}; selected hazard and report ID stay unchanged`
              : "File a structured incident report for Legazpi City"}
          </p>
        </div>

        {/* ── Success / Queued view ───────────────────────────────────── */}
        {submitted ? (
          <div className="p-5 flex flex-col gap-4">
            <div>
              <span className="saro-stamp">
                {isSosDetailsFlow ? "Details added to S.O.S." : "Report received"}
              </span>
              <p className="text-xs text-ink-muted mt-2">
                {isSosDetailsFlow
                  ? `Your update stays under ${submitted.tracking_code}. No new report was created.`
                  : getAssignedOfficeName()
                  ? `${getAssignedOfficeName()} has been notified. Save this tracking code.`
                  : "Your report has reached Legazpi City DRRM. Save this tracking code."}
              </p>
            </div>
            <ReportTicket
              code={submitted.tracking_code}
              categoryLabel={selectedCategory?.name ?? "Hazard Report"}
              filedAt={submitted.created_at}
            />
            <button type="button" onClick={isSosDetailsFlow ? () => navigate("/") : clearForm} className="saro-btn saro-btn-primary saro-btn-block py-2.5">
              {isSosDetailsFlow ? "Done" : "File another report"}
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
              <h2 className="text-sm font-bold mt-2">
                {isSosDetailsFlow ? "S.O.S. details saved on this device" : "Saved on this device"}
              </h2>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                {isSosDetailsFlow
                  ? `They will update ${activeSosTrackingCode} when connection returns. No new report will be created.`
                  : "Your report will automatically send when connection is restored."}
              </p>
            </div>
            <button type="button" onClick={isSosDetailsFlow ? () => navigate("/") : clearForm} className="saro-btn saro-btn-primary saro-btn-block py-2.5">
              {isSosDetailsFlow ? "Done" : "File another report"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">

            {/* ── Step 1: say what is happening ───────────────────────────
             *
             * First, exactly as on mobile: it is the only thing the resident
             * actually knows on arrival. The category picker below is the
             * confirmation surface, not the entry point.
             */}
            <div>
              <label htmlFor="describe" className="t-label block text-ink-faint">
                What is happening? <span className="text-alert">*</span>
              </label>
              <p className="t-body-sm mt-1 text-ink-muted">
                Say where it is and what you can see.
              </p>

              <div className="relative mt-2">
                <textarea
                  id="describe"
                  rows={4}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setValidationErrors((prev) => ({ ...prev, description: "" }));
                  }}
                  placeholder="May baha sa tabi kan eskwelahan, abot tuhod na…"
                  className="w-full text-xs p-3 rounded-md border-2 border-line-strong hover:border-brand-edge focus:border-brand focus:ring-2 focus:ring-brand/20 bg-surface text-ink placeholder:text-ink-muted/80 resize-none leading-relaxed transition-all shadow-2xs outline-none font-medium"
                  aria-invalid={Boolean(validationErrors.description)}
                />
              </div>

              {speechSupported && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSpeech()}
                    aria-pressed={isListening}
                    className={`saro-btn saro-btn-sm flex items-center gap-1.5 ${
                      isListening ? "saro-btn-primary" : "saro-btn-secondary"
                    }`}
                  >
                    {isListening ? <MicOff width={13} height={13} /> : <Mic width={13} height={13} className="text-brand" />}
                    {isListening ? "Stop listening" : "Voice Input"}
                  </button>

                  {isListening && (
                    <span className="t-body-sm text-brand font-medium animate-pulse" role="status">Listening…</span>
                  )}
                </div>
              )}

              {validationErrors.description && (
                <p className="t-body-sm mt-1.5 text-alert">{validationErrors.description}</p>
              )}

              {/* The local fast-track, announced the instant the words appear. */}
              {keywordEmergency && isGuest && (
                <p
                  className="t-body-sm mt-3 flex items-start gap-2 border border-alert bg-alert-wash text-alert rounded-md p-3 font-medium shadow-2xs"
                  role="status"
                >
                  <AlertTriangle width={15} height={15} className="mt-0.5 shrink-0 text-alert" aria-hidden="true" />
                  <span>
                    Read as an emergency (“{keywordEmergency.matchedPhrase}”). You can file this
                    straight away — no account, no sign-in.
                  </span>
                </p>
              )}
            </div>

            {/* Active S.O.S. already has a category. Never reopen the normal picker. */}
            {isSosDetailsFlow ? (
              <div className="saro-card p-3.5" aria-label="Selected S.O.S. hazard">
                <span className="t-label text-ink-faint">S.O.S. hazard already selected</span>
                <div className="mt-1.5 flex min-w-0 items-center justify-between gap-3">
                  <span className="t-body-sm min-w-0 break-words font-bold text-ink">
                    {selectedCategory?.name || activeSosCategoryId}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-bold text-brand">
                    {activeSosTrackingCode}
                  </span>
                </div>
              </div>
            ) : (
            /* Thumb-Friendly Un-truncated Category Picker */
            <div>
              <div className="flex items-center justify-between mb-1">
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
              <p className="text-[11px] text-ink-muted leading-tight mb-2.5">
                Critical and Urgent hazards need no account. Routine hazards require signing in.
              </p>

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

              {/* ── Category Tier Filter Pills ─────────────────────────────── */}
              {(() => {
                const availableCategories = categories
                  .filter((cat) => cat.id !== "emergency_unspecified" && cat.category !== "emergency_unspecified")
                  .map((cat) => {
                    const tier = cat.tier || getCategoryTier(cat);
                    return { ...cat, tier, is_emergency: tier === "critical" || tier === "urgent" };
                  });

                const criticalCount = availableCategories.filter((c) => c.tier === "critical").length;
                const urgentCount = availableCategories.filter((c) => c.tier === "urgent").length;
                const routineCount = availableCategories.filter((c) => c.tier === "routine").length;

                const filterTabs = [
                  { id: "all", label: `All (${availableCategories.length})` },
                  { id: "critical", label: `Critical (${criticalCount})` },
                  { id: "urgent", label: `Urgent (${urgentCount})` },
                  { id: "routine", label: `Routine (${routineCount})` },
                ];

                const filteredCategories = availableCategories.filter((cat) => {
                  if (catTab !== "all" && cat.tier !== catTab) return false;
                  if (catSearch) {
                    const q = catSearch.toLowerCase();
                    return (
                      cat.name.toLowerCase().includes(q) ||
                      (cat.name_bikol || "").toLowerCase().includes(q) ||
                      (cat.name_tagalog || "").toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                const criticalGroup = filteredCategories.filter((c) => c.tier === "critical");
                const urgentGroup = filteredCategories.filter((c) => c.tier === "urgent");
                const routineGroup = filteredCategories.filter((c) => c.tier === "routine");

                const sections = [
                  {
                    tier: "critical",
                    title: "Critical Hazards",
                    subtitle: "Real-time alert · No account needed",
                    badge: "CRITICAL · IMMEDIATE ALERT",
                    icon: Siren,
                    items: criticalGroup,
                    edgeColor: "var(--color-panic)",
                    iconStyle: {
                      background: "var(--color-panic-wash)",
                      borderColor: "var(--color-panic)",
                      color: "var(--color-panic-strong)",
                    },
                    tagColor: "var(--color-panic-strong)",
                  },
                  {
                    tier: "urgent",
                    title: "Urgent Hazards",
                    subtitle: "Fast-tracked priority · No account needed",
                    badge: "URGENT · NO ACCOUNT NEEDED",
                    icon: Zap,
                    items: urgentGroup,
                    edgeColor: "#D97706",
                    iconStyle: {
                      background: "#FEF3C7",
                      borderColor: "#F59E0B",
                      color: "#B45309",
                    },
                    tagColor: "#B45309",
                  },
                  {
                    tier: "routine",
                    title: "Routine Hazards",
                    subtitle: isGuest ? "Standard queue · Sign in to file" : "Standard response queue",
                    badge: isGuest ? "ROUTINE · SIGN IN TO FILE" : "ROUTINE · STANDARD QUEUE",
                    icon: FileText,
                    items: routineGroup,
                    edgeColor: "var(--color-line-strong)",
                    iconStyle: {
                      background: "var(--color-sunken)",
                      borderColor: "var(--color-line)",
                      color: "var(--color-brand)",
                    },
                    tagColor: "var(--color-ink-muted)",
                  },
                ].filter((sec) => sec.items.length > 0);

                return (
                  <>
                    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none pb-0.5">
                      {filterTabs.map((tab) => {
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

                    <div className="flex flex-col gap-3">
                      {sections.length > 0 ? (
                        sections.map((section) => (
                          <div key={section.tier} className="flex flex-col gap-2">
                            <div className="flex items-center gap-1.5 px-1 py-1 border-b border-line/60">
                              <section.icon className="w-3.5 h-3.5 shrink-0" style={{ color: section.tagColor }} aria-hidden="true" />
                              <span className="text-xs font-bold text-ink uppercase tracking-wider">{section.title}</span>
                              <span className="text-[10px] text-ink-faint ml-auto font-medium">{section.subtitle}</span>
                            </div>

                            <div className="flex flex-col gap-2">
                              {section.items.map((cat) => {
                                const isSelected = selectedCategoryId === cat.id;
                                const IconComp = getCategoryIcon(cat);
                                const AccessIcon = section.tier === "routine" && isGuest ? Lock : DoorOpen;
                                const badgeLabel = section.tier === "critical"
                                  ? "CRITICAL · IMMEDIATE ALERT"
                                  : section.tier === "urgent"
                                  ? "URGENT · NO ACCOUNT NEEDED"
                                  : isGuest
                                  ? "ROUTINE · SIGN IN TO FILE"
                                  : "ROUTINE · STANDARD QUEUE";

                                return (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => {
                                      if (selectedCategoryId === cat.id) {
                                        setSelectedCategoryId("");
                                      } else {
                                        setSelectedCategoryId(cat.id);
                                        setValidationErrors((prev) => ({ ...prev, category: "" }));
                                        if (isGuest && cat.tier === "routine") {
                                          setShowAuthWall(true);
                                        }
                                      }
                                    }}
                                    aria-pressed={isSelected}
                                    className={`saro-card flex w-full items-start gap-3 p-3.5 pl-4 text-left transition-all duration-150 ease-out active:scale-[0.985] cursor-pointer rounded-md ${
                                      isSelected
                                        ? "bg-brand-wash border-2 border-brand text-brand font-bold shadow-2xs"
                                        : "bg-surface border-2 border-line hover:border-brand-edge text-ink"
                                    }`}
                                  >
                                    <span
                                      className={`flex h-10 w-10 shrink-0 items-center justify-center border rounded-md transition-colors ${
                                        isSelected
                                          ? "bg-brand-wash border-brand text-brand"
                                          : "bg-sunken border-line text-ink-muted"
                                      }`}
                                    >
                                      <IconComp width={20} height={20} aria-hidden="true" />
                                    </span>

                                    <span className="min-w-0 flex-1">
                                      <span className="t-subhead block font-bold leading-snug text-ink">
                                        {cat.name}
                                      </span>
                                      {cat.name_bikol && (
                                        <span className="t-body-sm mt-0.5 block text-ink-muted">
                                          {cat.name_bikol}
                                        </span>
                                      )}
                                      <span
                                        className={`t-label mt-1.5 flex items-center gap-1.5 text-[11px] font-bold ${
                                          isSelected ? "text-brand" : "text-ink-muted"
                                        }`}
                                      >
                                        <AccessIcon width={12} height={12} aria-hidden="true" />
                                        {badgeLabel}
                                      </span>
                                    </span>

                                    <span
                                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                                        isSelected
                                          ? "border-brand bg-brand text-white"
                                          : "border-line-strong bg-surface text-transparent"
                                      }`}
                                      aria-hidden="true"
                                    >
                                      {isSelected && <Check width={14} height={14} strokeWidth={3} className="animate-in fade-in zoom-in-75 duration-150" />}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-xs text-ink-faint bg-raised rounded-xs border border-line font-medium">
                          No matching hazard categories found. Try clearing your search.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

              {validationErrors.category && (
                <p className="text-xs text-alert mt-1.5 font-medium">{validationErrors.category}</p>
              )}
            </div>

            )}

            {/* Location Section */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1.5">
                Where Is It? <span className="text-alert">*</span>
              </label>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-line rounded-xs text-xs font-medium text-ink hover:bg-raised min-h-[44px]"
                >
                  <Navigation className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                  Use My Location
                </button>
                {/* Mobile inlines a short picker map here. Desktop already gives
                    the whole right-hand canvas to it, so this points at that. */}
                <span className="t-label text-ink-muted">or click the map on the right</span>
              </div>

              {boundsError && (
                <p className="text-xs text-alert mb-2 bg-alert-wash border border-alert rounded-xs px-3 py-2">
                  {boundsError}
                </p>
              )}

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

            {/* Photo Evidence — Multi-photo */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Photo Evidence <span className="text-ink-muted font-normal">(optional, up to 5)</span>
              </label>
              {photos.length > 0 && (
                <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar">
                  {photos.map((photo, i) => (
                    <div key={i} className="relative shrink-0 w-24 h-24">
                      <img
                        src={photo}
                        alt={`Evidence ${i + 1}`}
                        className="w-full h-full object-cover rounded-md border border-line"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute -top-1.5 -right-1.5 bg-ink text-white w-6 h-6 rounded-full flex items-center justify-center t-micro shadow-xs hover:bg-black transition-colors"
                        aria-label={`Remove photo ${i + 1}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {photos.length < 5 && (
                /* Same control as mobile; desktop keeps drag-and-drop on it
                   because a file manager is right there. */
                <label
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex items-center gap-2 px-4 py-3 border border-dashed rounded-md cursor-pointer min-h-[44px] transition-colors ${
                    isDragOver ? "border-brand bg-brand-wash/60" : "bg-white border-line hover:bg-raised"
                  }`}
                >
                  {photos.length > 0 ? (
                    <Plus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
                  ) : (
                    <Camera className="w-5 h-5 text-ink-muted" aria-hidden="true" />
                  )}
                  <span className="text-xs text-ink-muted font-medium">
                    {photos.length > 0 ? "Add Another Photo" : "Choose Photos or Drag Them Here"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePhoto}
                  />
                </label>
              )}
            </div>

            {/* ── Inline account-needed prompt ─────────────────────────────── */}
            {needsAccount && (
              <div className="mt-4 rounded-md border border-brand-edge bg-brand-wash p-4 flex flex-col gap-2.5 shadow-2xs">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    <UserPlus className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="text-[13px] font-bold text-ink block leading-tight">
                      Account needed for non-emergency reports
                    </span>
                    <span className="text-[11px] text-ink-muted block mt-1 leading-snug">
                      The city office may need to follow up with you about this report.
                      Your description, photos, and location are saved — nothing is lost when you sign in.
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setShowAuthWall(true)}
                    className="saro-btn saro-btn-primary saro-btn-sm flex-1 flex items-center justify-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    Sign In or Create Account
                  </button>
                </div>
                <p className="text-[10px] text-ink-faint leading-snug">
                  Emergencies never need an account — switch to an emergency category above to file immediately.
                </p>
              </div>
            )}

            {/* Submit Button (stays below form content) */}
            <div className="pt-4 pb-2">
              {!isOnline && (
                <div className="flex items-center gap-1.5 t-label text-status-assigned-ink bg-status-assigned-tab/10 border border-status-assigned-tab/30 rounded-xs px-3 py-1.5 mb-2 font-medium">
                  <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                  Offline — report will be queued for later submission
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                {submitting
                  ? (isSosDetailsFlow ? "Adding details..." : "Submitting...")
                  : isSosDetailsFlow
                  ? "Add details to S.O.S."
                  : isOnline
                  ? "Submit report"
                  : "Save report offline"}
              </button>
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
