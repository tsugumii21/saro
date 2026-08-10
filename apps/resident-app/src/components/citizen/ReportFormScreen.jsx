import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  AlertTriangle, MapPin, Navigation, Camera, Mic, MicOff,
  Send, ChevronDown, CheckCircle2, X, Plus, WifiOff, Search, Check,
  Waves, Mountain, Wind, Ambulance, Car, Flame, Wrench, ShieldAlert, Droplets, Anchor,
  Lock, DoorOpen, UserPlus, BellRing, Zap, FileText, Siren
} from "lucide-react";
import { booleanPointInPolygon, point } from "@turf/turf";
import {
  getCategories, getBarangays, getOffices, createReport, addReportMedia,
  validateReportDraft, LEGAZPI_CENTER, CLIENT_STORAGE_KEYS, useAuth,
  detectEmergencyInDescription,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
  getCategoryTier, isEmergencyCategory,
} from "@saro/shared";
import { HazardMap } from "@saro/ui";
import ResidentAuthScreen from "./ResidentAuthScreen";
import ReportTicket from "./ReportTicket";

/** MapLibre takes [lng, lat]. */
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

// The localStorage offline queue that used to live here is gone. It could not
// survive being closed mid-storm — nothing ever retried it, there was no
// service worker to drain it, and a queued report simply sat in a string until
// somebody happened to reopen the app on the same browser. Reports now go to
// IndexedDB via enqueueReport() and are delivered by background sync. See
// packages/shared/src/offline/.

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

  const [boundsError, setBoundsError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueued, setOfflineQueued] = useState(false);

  // Speech recognition state
  const [isListening, setIsListening] = useState(false);
  const [speechLang] = useState("fil-PH");
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  /**
   * The emergency fast-track, decided in this browser, on every keystroke.
   *
   * This is the check that governs. It is synchronous, costs nothing, and runs
   * whether or not the Edge Function is reachable — so somebody typing "may
   * sunog sa kanto" is on the anonymous path before any request is made, and
   * stays there if Gemini is down, rate-limited, or slow. The AI result can
   * only ever add to this, never subtract from it.
   */
  const keywordEmergency = detectEmergencyInDescription(description);

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
  //
  // Three independent signals, OR'd. Any one of them opens the anonymous path:
  //
  //   the chosen category is an emergency one
  //   the resident's own words contain an emergency keyword  (browser, instant)
  //   the model classified it as an emergency                (network, optional)
  //
  // The order matters for what happens when things break. The first two need
  // nothing but the device. Only the third can fail, and it can only ever add.
  const isEmergencyReport =
    Boolean(selectedCategory?.is_emergency) ||
    Boolean(keywordEmergency);

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

  // Validate form against the shared schema
  const validate = () => {
    const errors = validateReportDraft({
      categoryId: selectedCategoryId,
      coords,
      description,
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
      // Urgent reports stay anonymous even for signed-in residents: filing
      // fast should never mean attaching your name.
      anonymous: fileAnonymously,
      device_fingerprint: getDeviceFingerprint()
    };

    // The report is written to IndexedDB before the network is touched, every
    // time — not only when `navigator.onLine` says we are offline. onLine is a
    // notoriously optimistic signal: it reports true behind a captive portal,
    // on a connected-but-dead cell, and on a phone that has just walked into a
    // parking structure. Queueing unconditionally means a request that dies
    // halfway is indistinguishable from one that never started.
    const queueId = await enqueueReport(payload, { kind: "describe" });
    requestBackgroundSync();

    if (!isOnline) {
      setOfflineQueued(true);
      setSubmitting(false);
      return;
    }

    const { data, error } = await createReport(payload);

    if (error || !data) {
      // Still queued, so this is a delay rather than a loss, and it is worded
      // as one.
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

    // Save photo evidence if attached
    if (photos.length > 0) {
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

  // The auth wall is now a modal overlay (rendered at the bottom of the JSX)
  // so the form stays visible and all typed data is preserved in state.

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

  /* ── Queued: the report exists, it just has not arrived yet ────────────── */
  if (offlineQueued) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <div className="saro-clip saro-card p-5" style={{ borderColor: "var(--color-ink)" }}>
          <span className="t-label flex items-center gap-2 text-ink-faint">
            <WifiOff width={14} height={14} aria-hidden="true" />
            Waiting to send
          </span>
          <h1 className="t-heading mt-2">Your report is saved on this phone</h1>
          <p className="t-body-sm mt-2 text-ink-muted">
            It is stored on the device, not lost. SARO keeps trying and sends it the moment
            signal returns — you do not have to leave this app open, and you do not have to
            do anything.
          </p>
          <p className="t-body-sm mt-3 text-ink-muted">
            A tracking code is issued when it reaches the city. It will appear under
            <strong className="font-bold"> Check a report</strong> as soon as it does.
          </p>
        </div>

        <button type="button" onClick={clearForm} className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block">
          File another report
        </button>
        <button
          type="button"
          onClick={() => navigate("/track")}
          className="saro-btn saro-btn-ghost saro-btn-block"
        >
          Go to Check a report
        </button>
      </div>
    );
  }

  /* ── Filed ─────────────────────────────────────────────────────────────── */
  if (submitted) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <div>
          <span className="saro-stamp">Report received</span>
          <p className="t-body mt-3 text-ink-muted">
            {getAssignedOfficeName()
              ? `Routed to ${getAssignedOfficeName()}. Keep this code — it is how you check what happens next.`
              : "Keep this code — it is how you check what happens next."}
          </p>
        </div>

        <ReportTicket
          code={submitted.tracking_code}
          categoryLabel={selectedCategory?.name}
          filedAt={submitted.created_at}
        />

        <button
          type="button"
          onClick={() => navigate(`/track?code=${submitted.tracking_code}`)}
          className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block"
        >
          Track this report
        </button>
        <button type="button" onClick={clearForm} className="saro-btn saro-btn-ghost saro-btn-block">
          File another
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 max-w-md mx-auto pb-28 sm:pb-8">
      <div className="mb-4">
        <h2 className="text-base font-bold text-ink">File a Hazard Report</h2>
        <p className="text-xs text-ink-muted mt-0.5">
          One front door for Legazpi City. We route your report to the correct office.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Step 1: say what is happening ─────────────────────────────────
         *
         * This is first because it is the only thing the resident actually
         * knows on arrival. The old form opened with a twenty-item category
         * grid, which asks someone to classify a hazard using the city's
         * vocabulary before they have described it in their own — backwards,
         * and worst for exactly the people under most stress.
         *
         * Now: describe it, in any of three languages, typed or spoken. The
         * category picker below becomes the confirmation surface rather than
         * the entry point.
         */}
        <div>
          <label htmlFor="describe" className="t-label block text-ink-faint">
            What is happening? <span className="text-alert">*</span>
          </label>
          <p className="t-body-sm mt-1 text-ink-muted">
            Bikol, Tagalog or English. Say where it is and what you can see.
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

          {/* The local fast-track, announced the instant the words appear. It
              does not wait for the network, and it says out loud that no
              account will be asked for — the anxiety it removes is the point. */}
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

        {/* Thumb-Friendly Un-truncated Category Picker */}
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

        {/* Nothing gates the form here on purpose. The prototype showed a
            dead-end notice the moment a guest picked a non-emergency category,
            which is a login prompt in all but name. The account is asked for at
            submit instead, once the person has decided what they are reporting. */}

        {/* Location Section */}
        <div>
          <label className="block text-xs font-semibold text-ink mb-1.5">
            Where Is It? <span className="text-alert">*</span>
          </label>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={handleUseMyLocation}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-line rounded-xs text-xs font-medium text-ink active:bg-raised min-h-[44px]"
            >
              <Navigation className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              Use My Location
            </button>
            <span className="t-label text-ink-muted">or tap the map below</span>
          </div>

          {boundsError && (
            <p className="text-xs text-alert mb-2 bg-alert-wash border border-alert rounded-xs px-3 py-2">
              {boundsError}
            </p>
          )}

          <div className="h-48 rounded-md overflow-hidden border border-line relative shadow-2xs">
            {/* Hazard layers are on while picking a location, deliberately.
                Somebody reporting a blocked drain can see they are inside the
                5-year flood extent, which is context the office would otherwise
                have to add later. Toggles are hidden here — this map's job is
                picking a point, not exploring. */}
            <HazardMap
              className="h-full w-full"
              center={coords ? [coords.lng, coords.lat] : LEGAZPI_CENTER_LNGLAT}
              zoom={coords ? 16 : 13}
              onPick={handleMapSelect}
              picked={coords}
              showToggles={false}
              hidden={["rain", "reports"]}
            />
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
            <label className="flex items-center gap-2 px-4 py-3 bg-white border border-line border-dashed rounded-md cursor-pointer active:bg-raised min-h-[44px]">
              {photos.length > 0 ? (
                <Plus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
              ) : (
                <Camera className="w-5 h-5 text-ink-muted" aria-hidden="true" />
              )}
              <span className="text-xs text-ink-muted font-medium">
                {photos.length > 0 ? "Add Another Photo" : "Take Photo or Choose From Gallery"}
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
            {submitting ? "Submitting..." : isOnline ? "Submit report" : "Save report offline"}
          </button>
        </div>
      </form>

      {/* ── Auth Modal Overlay ──────────────────────────────────────── */}
      {showAuthWall && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={() => setShowAuthWall(false)}
          />
          {/* Modal content */}
          <div className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl animate-[slideUp_200ms_ease-out]"
               style={{ animationFillMode: 'both' }}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 pt-4 pb-2 bg-surface rounded-t-2xl">
              <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Sign in to continue</span>
              <button
                type="button"
                onClick={() => setShowAuthWall(false)}
                className="p-1.5 rounded-full hover:bg-raised transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-ink-muted" />
              </button>
            </div>
            <ResidentAuthScreen
              mode="sign-up"
              reason="Non-emergency reports need an account so the office can follow up. Your report details are saved — sign in or create an account, then tap Submit again."
              onCancel={() => setShowAuthWall(false)}
              onSignedIn={() => setShowAuthWall(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
