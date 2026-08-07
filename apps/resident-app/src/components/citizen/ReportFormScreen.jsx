import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  AlertTriangle, MapPin, Navigation, Camera, Mic, MicOff,
  Send, ChevronDown, Phone, Users, CheckCircle2, X, Plus, WifiOff, Search, Check,
  Waves, Mountain, Wind, Ambulance, Car, Flame, Wrench, ShieldAlert, Droplets, Anchor,
  Lock, DoorOpen, Sparkles
} from "lucide-react";
import { booleanPointInPolygon, point } from "@turf/turf";
import {
  getCategories, getBarangays, getOffices, createReport, addReportMedia,
  validateReportDraft, LEGAZPI_CENTER, CLIENT_STORAGE_KEYS, useAuth,
  structureDescription, detectEmergencyInDescription,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
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
  const [speechLang, setSpeechLang] = useState("en-PH");
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Describe-flow structuring
  const [analysing, setAnalysing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiDismissed, setAiDismissed] = useState(false);

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
    Boolean(keywordEmergency) ||
    Boolean(aiResult?.isEmergency);

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

  /**
   * Ask the Edge Function to turn what was typed or spoken into a category and
   * a dispatcher summary.
   *
   * Nothing here is applied silently. The suggestion lands in the form as a
   * pre-selection the resident can see and change, which is the difference
   * between a helpful guess and a misrouted report: a wrong category costs one
   * tap to fix, and if it were auto-filed it would cost an office a day.
   *
   * Failure is not an error state. A timeout or a rate limit leaves the person
   * with the form they already had, plus a note explaining they can carry on by
   * hand — because they always could.
   */
  const analyseDescription = async () => {
    const text = description.trim();
    if (text.length < 8) return;

    setAnalysing(true);
    setAiDismissed(false);

    const result = await structureDescription(text);
    setAiResult(result);

    // Only pre-select when the model actually matched a real category and said
    // it was confident. A low-confidence guess pushed into the picker looks
    // like a decision the resident made.
    if (result.category && result.confidence === "high") {
      const match = categories.find((c) => c.id === result.category);
      if (match) {
        setSelectedCategoryId(match.id);
        setValidationErrors((prev) => ({ ...prev, category: "" }));
      }
    }

    setAnalysing(false);
  };

  // Web Speech API
  const toggleSpeech = (lang) => {
    if (!speechSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    // Bikol has no speech model anywhere, so Bikol speakers get the Tagalog
    // recogniser: the phonology is close enough that most of a sentence comes
    // through, and a rough transcript the resident can correct beats no voice
    // input at all. The written flow accepts Bikol properly, and the Edge
    // Function reads all three languages.
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

  const clearForm = () => {
    setSubmitted(null);
    setOfflineQueued(false);
    setSelectedCategoryId("");
    setDescription("");
    setCoords(null);
    setBarangayId("");
    setPhotos([]);
    setCallbackNumber("");
    setIsProxy(false);
    setValidationErrors({});
    setAiResult(null);
    setAiDismissed(false);
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
    <div className="px-4 py-3 max-w-md mx-auto pb-24">
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
                // A stale suggestion about text that has since changed is worse
                // than none: it looks like the system agreed with the new words.
                if (aiResult) setAiResult(null);
              }}
              placeholder="May baha sa tabi kan eskwelahan, abot tuhod na…"
              className="saro-field w-full resize-none"
              aria-invalid={Boolean(validationErrors.description)}
            />
          </div>

          {speechSupported && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="t-label text-ink-faint">Speak instead</span>
              {[
                { code: "fil-PH", label: "Bikol / Tagalog" },
                { code: "en-PH", label: "English" },
              ].map((option) => {
                const active = isListening && speechLang === option.code;
                return (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => { setSpeechLang(option.code); toggleSpeech(option.code); }}
                    aria-pressed={active}
                    className="saro-btn saro-btn-secondary saro-btn-sm"
                    style={active ? { borderColor: "var(--color-brand)", color: "var(--color-brand)" } : undefined}
                  >
                    {active ? <MicOff width={13} height={13} /> : <Mic width={13} height={13} />}
                    {active ? "Stop" : option.label}
                  </button>
                );
              })}
              {isListening && (
                <span className="t-body-sm text-brand" role="status">Listening…</span>
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
              className="t-body-sm mt-3 flex items-start gap-2 border p-3"
              style={{
                borderColor: "var(--color-panic)",
                background: "var(--color-panic-wash)",
                color: "var(--color-panic-deep)",
              }}
              role="status"
            >
              <AlertTriangle width={15} height={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Read as an emergency (“{keywordEmergency.matchedPhrase}”). You can file this
                straight away — no account, no sign-in.
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={analyseDescription}
            disabled={analysing || description.trim().length < 8}
            className="saro-btn saro-btn-secondary saro-btn-block mt-3"
          >
            <Sparkles width={15} height={15} />
            {analysing ? "Reading what you wrote…" : "Suggest a category for me"}
          </button>

          {/* Step 2: what it understood, shown back for correction. Nothing is
              filed from here — this is a suggestion sitting next to a picker. */}
          {aiResult && !aiDismissed && (
            <div className="saro-clip saro-card mt-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="t-label text-ink-faint">
                  {aiResult.degraded ? "Could not check that" : "What SARO understood"}
                </span>
                <button
                  type="button"
                  onClick={() => setAiDismissed(true)}
                  aria-label="Dismiss suggestion"
                  className="saro-btn saro-btn-ghost saro-btn-sm shrink-0"
                >
                  <X width={14} height={14} />
                </button>
              </div>

              {aiResult.degraded ? (
                <p className="t-body-sm mt-2 text-ink-muted">
                  The city's assistant did not answer in time. Nothing is lost — pick the
                  category yourself below and file as normal.
                </p>
              ) : (
                <>
                  <p className="t-body mt-2">{aiResult.summary}</p>

                  <dl className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="t-label text-ink-faint">Suggested category</dt>
                      <dd className="t-body-sm font-bold">
                        {aiResult.categoryLabel ?? "None — please choose one below"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="t-label text-ink-faint">Confidence</dt>
                      <dd className="t-body-sm">
                        {aiResult.confidence === "high" ? "Reasonably sure" : "Not sure"}
                      </dd>
                    </div>
                  </dl>

                  <p className="t-body-sm mt-3 text-ink-muted">
                    {aiResult.confidence === "high"
                      ? "Selected below. Change it if it is wrong — you decide, not the assistant."
                      : "Not confident enough to choose for you. Pick the category below."}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

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

          {/* Category cards.
           *
           * The 4px leading edge is a functional signal, not decoration, and it
           * carries the single rule that decides whether this form can be
           * submitted at all:
           *
           *   vermilion edge  → emergency category → files immediately, no
           *                     account, no login prompt, ever
           *   grey edge       → standard category  → needs a resident account
           *
           * This is the same rule enforced by `needsAccount` above, by the
           * describe-flow keyword check, and by the RLS insert policies. One
           * fact, stated in three places, and this is the only place a resident
           * can see it before they hit it.
           *
           * The vermilion is the reserved Panic ink, used here deliberately:
           * picking an emergency category is the same act as pressing Panic,
           * taken through a slower door. It is the third and last permitted
           * place for this colour — see the reservation note in tokens.css.
           *
           * Colour is never alone. Every card also carries an icon (open door
           * vs padlock) and the words, so the rule survives greyscale, a sunlit
           * screen, and deuteranopia.
           *
           * The access clause is shown to guests only. A signed-in resident can
           * file anything, so telling them to sign in would be a lie.
           */}
          <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
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
                const openToGuests = cat.is_emergency;
                const AccessIcon = openToGuests ? DoorOpen : Lock;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setValidationErrors((prev) => ({ ...prev, category: "" }));
                    }}
                    aria-pressed={isSelected}
                    className={`saro-card flex w-full items-start gap-3 p-3.5 pl-4 text-left transition-colors ${
                      isSelected ? "bg-brand-wash" : "bg-surface hover:bg-raised"
                    }`}
                    style={{
                      // Inset rather than border-left: selection changes the
                      // border colour on all four sides, and a border-l utility
                      // would lose that fight unpredictably. The edge must
                      // never disappear — it is the signal.
                      boxShadow: `inset 4px 0 0 0 ${
                        openToGuests ? "var(--color-panic)" : "var(--color-line-strong)"
                      }`,
                      borderColor: isSelected ? "var(--color-brand)" : undefined,
                    }}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center border"
                      style={
                        openToGuests
                          ? {
                              background: "var(--color-panic-wash)",
                              borderColor: "var(--color-panic)",
                              color: "var(--color-panic-strong)",
                            }
                          : {
                              background: "var(--color-sunken)",
                              borderColor: "var(--color-line)",
                              color: "var(--color-brand)",
                            }
                      }
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
                        className="t-label mt-1.5 flex items-center gap-1.5"
                        style={{
                          color: openToGuests
                            ? "var(--color-panic-strong)"
                            : "var(--color-ink-faint)",
                        }}
                      >
                        <AccessIcon width={12} height={12} aria-hidden="true" />
                        {openToGuests ? "Emergency" : "Non-urgent"}
                        {isGuest && (openToGuests ? " · No account needed" : " · Sign in to file")}
                      </span>
                    </span>

                    <span
                      className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                      style={{
                        borderColor: isSelected ? "var(--color-brand)" : "var(--color-line-strong)",
                        background: isSelected ? "var(--color-brand)" : "var(--color-surface)",
                        color: "#fff",
                      }}
                      aria-hidden="true"
                    >
                      {isSelected && <Check width={14} height={14} strokeWidth={3} />}
                    </span>
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
