import { useState, useEffect, useRef } from "react";
import {
  X, MapPin, Phone, Clock, ShieldCheck, UserRound, Layers,
  Upload, Check, Flag, Search, Image as ImageIcon, History,
  FileText, Camera, AlertCircle, CornerUpLeft, ExternalLink, CheckCircle2, ChevronRight, Trash2
} from "lucide-react";
import {
  updateReportStatus, deleteReport, addReportMedia, getReportMedia, getReportHistory,
  markFalseReport, saroEvents, STATUS_PIPELINE, STATUS_LABELS,
  RESOLUTION_REASONS, RESOLUTION_REASON_LABELS,
  isStaleReport, daysSinceStatusUpdate, STALE_REPORT_LABEL,
  reassignReport, endorseReport,
} from "@saro/shared";
import { StatusTag, TrackingCode, statusTab, HazardMap } from "@saro/ui";

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

function formatHistoryDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * One report, and whatever this viewer is allowed to do to it.
 *
 * The panel used to take `isBarangayOfficial` and infer permission from it,
 * which quietly encoded "everyone who is not a barangay official may set any
 * status" — including the city administrator, whose job is not dispatch. It now
 * takes the three capabilities directly, decided in @saro/shared, so the roles
 * can differ without this file growing a second opinion about them.
 */
export default function ReportDetailPanel({
  report,
  category,
  barangay,
  office,
  offices = [],
  canDispatch = false,
  canEndorse = false,
  canReassign = false,
  canDelete = false,
  onClose,
  onUpdateSuccess,
}) {
  const [mediaList, setMediaList] = useState([]);
  const [historyList, setHistoryList] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(true);

  // Status update state
  const [targetStatus, setTargetStatus] = useState(report?.status || "received");
  const [customNote, setCustomNote] = useState("");
  const [resolutionPhoto, setResolutionPhoto] = useState(null);
  const [reasonCode, setReasonCode] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [markAsFalse, setMarkAsFalse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [activePhotoModal, setActivePhotoModal] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Endorsement (barangay) and reassignment (admin) — the two non-dispatch writes.
  const [endorsementNote, setEndorsementNote] = useState("");
  const [endorsementDone, setEndorsementDone] = useState("");
  const [reassignOfficeId, setReassignOfficeId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [reassignDone, setReassignDone] = useState("");

  const fileInputRef = useRef(null);
  const reportId = report?.id;
  const reportStatus = report?.status;
  const reportUpdatedAt = report?.updated_at;

  // Sync state when selected report changes
  useEffect(() => {
    if (!reportId) return;
    setTargetStatus(reportStatus);
    setCustomNote("");
    setResolutionPhoto(null);
    setReasonCode("");
    setReferenceCode("");
    setMarkAsFalse(false);
    setErrorMsg("");
    setConfirmingDelete(false);
    setEndorsementNote("");
    setEndorsementDone("");
    setReassignOfficeId("");
    setReassignReason("");
    setReassignDone("");

    let mounted = true;
    setLoadingDetails(true);

    async function loadReportAssets() {
      const [mediaRes, historyRes] = await Promise.all([
        getReportMedia(reportId),
        getReportHistory(reportId),
      ]);

      if (mounted) {
        setMediaList(mediaRes.data ?? []);
        setHistoryList(historyRes.data ?? []);
        setLoadingDetails(false);
      }
    }

    loadReportAssets();

    return () => {
      mounted = false;
    };
  }, [reportId, reportStatus, reportUpdatedAt]);

  if (!report) return null;

  // Determine resolution proof requirement directly from routing table / category row
  const proofRequirement = category?.resolution_proof ?? "photo"; // "photo" | "reference"

  const isResolving = targetStatus === "resolved";

  /**
   * What actually blocks a status transition.
   *
   * A resolution photo no longer does. Requiring one meant a crew who fixed a
   * drain at night, or on a phone with a dead camera, could not close the
   * report at all — so the queue carried work that was finished, which is worse
   * for dispatch than a closure with no picture. The photo is still offered and
   * still attached when given; it is evidence, not a gate.
   *
   * The reference-code path stays required. That is a blotter or dispatch
   * serial the office already holds, it is typed rather than captured, and it
   * is the only record tying the closure to the responding unit.
   */
  const isReadyToUpdate = (() => {
    if (submitting) return false;
    if (isResolving && proofRequirement === "photo") {
      return Boolean(resolutionPhoto);
    }
    if (isResolving && proofRequirement === "reference") {
      return Boolean(reasonCode) && referenceCode.trim().length >= 4;
    }
    return true;
  })();

  const handleApplyStatusChange = async (e) => {
    e.preventDefault();
    if (!isReadyToUpdate) return;

    setSubmitting(true);
    setErrorMsg("");

    try {
      if (isResolving && resolutionPhoto) {
        const { error: mediaErr } = await addReportMedia(report.id, resolutionPhoto, "resolution");
        if (mediaErr) {
          setSubmitting(false);
          return setErrorMsg(`Photo upload failed: ${mediaErr}`);
        }
      }

      if (isResolving && markAsFalse) {
        await markFalseReport(report.id, true);
      }

      const proofObj = {};
      if (isResolving && proofRequirement === "reference") {
        proofObj.reason = reasonCode;
        proofObj.reference = referenceCode.trim();
      }
      if (customNote.trim()) {
        proofObj.note = customNote.trim();
      }

      const { error: updateErr } = await updateReportStatus(report.id, targetStatus, proofObj);

      if (updateErr) {
        setSubmitting(false);
        return setErrorMsg(updateErr);
      }

      // Reload media & history
      const [mRes, hRes] = await Promise.all([
        getReportMedia(report.id),
        getReportHistory(report.id),
      ]);
      setMediaList(mRes.data ?? []);
      setHistoryList(hRes.data ?? []);

      setSubmitting(false);
      setCustomNote("");
      setResolutionPhoto(null);

      // Emit realtime sync event
      saroEvents.emit("report:updated", { reportId: report.id });
      onUpdateSuccess?.();
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(err?.message || "Could not update status.");
    }
  };

  const initialPhotos = mediaList.filter((m) => m.kind === "submission" || !m.kind);
  const resolutionPhotos = mediaList.filter((m) => m.kind === "resolution");

  /* A barangay official's note. Deliberately not a status change: it records
     that somebody accountable for that street went and looked. */
  const handleEndorse = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");
    setEndorsementDone("");

    const { error } = await endorseReport(report.id, {
      note: endorsementNote.trim(),
      status: report.status,
    });
    setSubmitting(false);
    if (error) return setErrorMsg(error);

    setEndorsementNote("");
    setEndorsementDone("Endorsement recorded on this report.");
    const hRes = await getReportHistory(report.id);
    setHistoryList(hRes.data ?? []);
    onUpdateSuccess?.();
  };

  /* The administrator's one write on a single report. The reason is required by
     the database function, not just by this form. */
  const handleReassign = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");
    setReassignDone("");

    const { error } = await reassignReport(report.id, reassignOfficeId, reassignReason.trim());
    setSubmitting(false);
    if (error) return setErrorMsg(error);

    setReassignReason("");
    setReassignOfficeId("");
    setReassignDone("Reassigned. The reason is on the report's record.");
    const hRes = await getReportHistory(report.id);
    setHistoryList(hRes.data ?? []);
    onUpdateSuccess?.();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setErrorMsg("");
    const { error } = await deleteReport(report.id);
    setSubmitting(false);
    if (error) return setErrorMsg(error);
    await onUpdateSuccess?.();
    onClose?.();
  };

  return (
    <aside className="saro-card saro-rise flex h-full min-h-0 flex-col overflow-hidden bg-white border border-line shadow-card rounded-xs font-sans">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 bg-raised"
        style={{ boxShadow: `inset 0 3px 0 0 ${statusTab(report.status)}` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TrackingCode code={report.tracking_code} />
            {report.filed_by_verified ? (
              /* Dark green ink on the light wash, not on the mid-green tab.
                 The old pairing put resolved-ink (#00694E) on resolved-tab
                 (#007F5F) — two neighbouring greens at 1.2:1, effectively
                 unreadable. The wash carries the same ink at 5.8:1 and stays
                 the only filled green pill here, so it still reads as
                 "verified" against the outlined hazard and stale pills. */
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-status-resolved-ink bg-status-resolved-wash px-1.5 py-0.5 rounded border border-status-resolved-tab">
                <ShieldCheck width={12} height={12} strokeWidth={2.4} />
                Verified Resident
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-muted bg-sunken px-1.5 py-0.5 rounded border border-line">
                <UserRound width={12} height={12} />
                Guest Report
              </span>
            )}
          </div>
          <h2 className="t-body-sm mt-1 truncate font-bold text-ink">
            {category?.name ?? category?.label ?? report.category}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="saro-btn saro-btn-ghost saro-btn-sm -mr-2 text-ink-muted hover:text-ink"
          aria-label="Close detail panel"
        >
          <X width={18} height={18} />
        </button>
      </div>

      {/* ── Scrollable Body ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
        {/* Interactive Mini Map */}
        <div className="h-44 border-b border-line relative">
          <HazardMap
            className="h-full w-full"
            center={[report.lng, report.lat]}
            zoom={16}
            showToggles={false}
            hidden={["rain"]}
            reports={[
              {
                id: report.id,
                lat: report.lat,
                lng: report.lng,
                priority: report.priority,
                color: statusTab(report.status),
              },
            ]}
          />
          <div className="absolute bottom-2 left-2 right-2 bg-white/95 backdrop-blur-xs px-2.5 py-1.5 rounded border border-line text-[11px] font-semibold text-ink flex items-center justify-between shadow-xs">
            <span className="flex items-center gap-1 truncate">
              <MapPin width={12} height={12} className="text-brand shrink-0" />
              {barangay?.name ? `Brgy. ${barangay.name}` : "Legazpi City"}
            </span>
            <span className="font-mono text-ink-faint text-[10px]">
              {report.lat.toFixed(4)}, {report.lng.toFixed(4)}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Description & Reporter Info */}
          <div className="space-y-1.5">
            <span className="t-label text-ink-faint block uppercase text-[10px] font-bold tracking-wider">
              Reporter Description
            </span>
            <p className="t-body text-ink bg-sunken/50 p-3 rounded border border-line leading-relaxed text-xs">
              {report.description || "No description provided."}
            </p>
          </div>

          {/* Key Metadata Grid */}
          <div className="grid grid-cols-2 gap-2.5 text-xs bg-raised p-3 rounded border border-line">
            <div>
              <span className="t-label text-ink-faint block text-[10px] font-bold">Current Status</span>
              <div className="mt-1">
                <StatusTag status={report.status} />
              </div>
            </div>
            <div>
              <span className="t-label text-ink-faint block text-[10px] font-bold">Assigned Office</span>
              <span className="font-semibold text-ink mt-1 block">
                {office?.short_name || office?.full_name || "CDRRMO"}
              </span>
            </div>
            <div>
              <span className="t-label text-ink-faint block text-[10px] font-bold">Filed At</span>
              <span className="text-ink-muted mt-1 block font-mono text-[11px]">
                {formatHistoryDate(report.created_at)}
              </span>
            </div>
            <div>
              <span className="t-label text-ink-faint block text-[10px] font-bold">Closure Proof Rule</span>
              {/* The photo route is no longer a rule, so it no longer states
                  one — and it gives up the panic vermilion it was never
                  entitled to. Only the reference-code route still blocks a
                  closure, so only it is inked as a condition to act on. */}
              <span
                className="font-bold mt-1 block text-[11px]"
                style={{
                  color: proofRequirement === "photo"
                    ? "var(--color-ink-muted)"
                    : "var(--color-status-assigned-ink)",
                }}
              >
                {proofRequirement === "photo" ? "📷 Resolution Photo" : "📝 Reason + Ref Code"}
              </span>
            </div>
            {report.callback_number && (
              <div className="col-span-2 pt-1 border-t border-line/60">
                <span className="t-label text-ink-faint block text-[10px] font-bold">Reporter Callback Number</span>
                <a
                  href={`tel:${report.callback_number}`}
                  className="t-code inline-flex items-center gap-1.5 text-brand font-bold mt-0.5 hover:underline text-xs"
                >
                  <Phone width={12} height={12} />
                  {report.callback_number}
                </a>
              </div>
            )}
            {report.cluster_id && (report.confidence_score ?? 1) > 1 && (
              <div className="col-span-2 pt-1 border-t border-line/60">
                <span className="t-label text-ink-faint block text-[10px] font-bold">Corroboration</span>
                <span className="t-body-sm text-brand font-bold flex items-center gap-1 mt-0.5">
                  <Layers width={12} height={12} />
                  {report.confidence_score} independent reports received for this incident
                </span>
              </div>
            )}
          </div>

          {/* Waiting, not lost. The report is untouched and still open — this
              only says how long it has been since an office last moved it. */}
          {isStaleReport(report) && (
            <div
              role="status"
              className="flex items-start gap-2 rounded border p-3"
              style={{
                borderColor: "var(--color-status-assigned-tab)",
                background: "var(--color-status-assigned-wash)",
              }}
            >
              <Clock width={14} height={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-status-assigned-ink)" }} />
              <div>
                <span className="t-body-sm block font-bold" style={{ color: "var(--color-status-assigned-ink)" }}>
                  {STALE_REPORT_LABEL}
                </span>
                <span className="t-micro text-ink-muted block mt-0.5">
                  No office status update in {daysSinceStatusUpdate(report)} days.
                  Still open and still visible to the resident.
                </span>
              </div>
            </div>
          )}

          {/* ── Photos & Evidence Gallery ─────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="t-label text-ink-faint uppercase text-[10px] font-bold tracking-wider flex items-center gap-1">
                <ImageIcon width={12} height={12} />
                Report Photos & Media ({mediaList.length})
              </span>
            </div>

            {loadingDetails ? (
              <div className="py-4 text-center text-xs text-ink-faint">Loading media...</div>
            ) : mediaList.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {mediaList.map((m, idx) => (
                  <div
                    key={m.id || idx}
                    onClick={() => setActivePhotoModal(m.signed_url || m.url || m.object_path)}
                    className="group relative cursor-pointer overflow-hidden rounded border border-line bg-sunken aspect-video"
                  >
                    <img
                      src={m.signed_url || m.url || m.object_path}
                      alt={`Report photo ${idx + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute bottom-1 left-1 bg-black/75 text-white text-[9px] font-mono px-1.5 py-0.5 rounded capitalize">
                      {m.kind === "resolution" ? "Evidence" : "Reporter"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-sunken border border-line rounded text-center text-xs text-ink-faint font-medium">
                No photos submitted with initial report.
              </div>
            )}
          </div>

          {/* ── Actionable Status Pipeline Control ───────────────────────── */}
          {canDispatch && (
            <form onSubmit={handleApplyStatusChange} className="p-3.5 bg-brand-wash/30 border border-brand-edge rounded-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink uppercase tracking-wider">
                  Update Report Status
                </span>
                <span className="text-[10px] font-mono font-bold text-brand">
                  Formal Pipeline
                </span>
              </div>

              {/* Status Select */}
              <div>
                <label className="t-label text-ink-faint block text-[10px] font-bold mb-1">
                  Target Status State
                </label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  className="saro-field w-full text-xs font-bold text-ink bg-white"
                >
                  {STATUS_PIPELINE.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_LABELS[st] || st.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>

              {/* Closure evidence for 'resolved'. Heading follows the route:
                  the photo route collects evidence, the reference-code route
                  states requirements. */}
              {isResolving && (
                <div className="p-3 bg-white border border-brand/30 rounded space-y-2.5">
                  <span className="text-[11px] font-bold text-ink block border-b border-line pb-1">
                    {proofRequirement === "photo"
                      ? "Resolution Evidence Required"
                      : "Accountable Resolution Requirements"}
                  </span>

                  {proofRequirement === "photo" ? (
                    <div className="space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) setResolutionPhoto(await compressPhoto(f));
                        }}
                      />
                      {resolutionPhoto ? (
                        <div className="relative">
                          <img src={resolutionPhoto} alt="Resolution photo evidence" className="h-28 w-full border border-line object-cover rounded" />
                          <button
                            type="button"
                            onClick={() => setResolutionPhoto(null)}
                            className="absolute top-1 right-1 bg-black/75 text-white p-1 rounded-full text-xs"
                          >
                            <X width={12} height={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="saro-btn saro-btn-secondary saro-btn-block text-xs font-bold py-2"
                        >
                          <Camera width={14} height={14} />
                          Attach Resolution Photo *
                        </button>
                      )}
                      <p className="text-[10px] text-ink-muted leading-tight">
                        A photo of the completed work is required by the routing rule.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <label className="t-label text-ink-faint block text-[10px] font-bold">Reason Code *</label>
                        <select
                          value={reasonCode}
                          onChange={(e) => setReasonCode(e.target.value)}
                          className="saro-field w-full text-xs mt-1"
                        >
                          <option value="">Select reason...</option>
                          {RESOLUTION_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="t-label text-ink-faint block text-[10px] font-bold">
                          Dispatch / Blotter / Ref Code *
                        </label>
                        <input
                          type="text"
                          value={referenceCode}
                          onChange={(e) => setReferenceCode(e.target.value)}
                          placeholder="e.g. BFP-LOG-8821 or CDRRMO-DISPATCH-4"
                          className="saro-field w-full text-xs mt-1"
                        />
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 pt-1 border-t border-line/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={markAsFalse}
                      onChange={(e) => setMarkAsFalse(e.target.checked)}
                      className="rounded border-line text-brand focus:ring-brand"
                    />
                    <span className="text-xs text-alert font-bold">Flag as Verified False / Hoax Report</span>
                  </label>
                </div>
              )}

              {/* Public Official Note Field */}
              <div>
                <label className="t-label text-ink-faint block text-[10px] font-bold mb-1">
                  Public Update Note (Sent to Resident's Tracking Timeline)
                </label>
                <textarea
                  rows={2}
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="e.g. Suction truck deployed to Bitano clearing area at 2:15 PM."
                  className="saro-field w-full text-xs"
                />
              </div>

              {errorMsg && (
                <p role="alert" className="text-xs border border-alert bg-alert-wash p-2 text-alert rounded font-medium">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={!isReadyToUpdate || submitting}
                className="saro-btn saro-btn-primary saro-btn-block text-xs font-bold py-2.5 justify-center"
              >
                {submitting ? "Updating Status..." : `Apply Status Transition: ${STATUS_LABELS[targetStatus] || targetStatus}`}
              </button>
            </form>
          )}

          {/* ── Barangay endorsement ─────────────────────────────────────── */}
          {canEndorse && (
            <form onSubmit={handleEndorse} className="space-y-2 rounded-xs border border-line bg-sunken p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink">
                  Endorse this report
                </span>
                <span className="font-mono text-[10px] font-bold text-ink-muted">Barangay record</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-muted">
                What you write is signed with your name and joins this report's permanent record,
                where the handling office reads it. It does not change the status — that stays with
                {office?.short_name ? ` ${office.short_name}` : " the assigned office"}.
              </p>
              <textarea
                rows={2}
                value={endorsementNote}
                onChange={(e) => setEndorsementNote(e.target.value)}
                placeholder="e.g. Confirmed on site 9:20 AM. Water is knee-deep by the chapel, two families already moved."
                className="saro-field w-full text-xs"
              />
              {endorsementDone && (
                <p className="rounded border border-status-resolved-tab bg-status-resolved-wash p-2 text-[11px] font-bold text-status-resolved-ink">
                  {endorsementDone}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || endorsementNote.trim().length < 4}
                className="saro-btn saro-btn-primary saro-btn-block justify-center py-2 text-xs font-bold"
              >
                <CheckCircle2 width={14} height={14} />
                {submitting ? "Recording…" : "Record endorsement"}
              </button>
            </form>
          )}

          {/* ── Administrator reassignment ───────────────────────────────── */}
          {canReassign && (
            <form onSubmit={handleReassign} className="space-y-2 rounded-xs border border-line bg-sunken p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink">
                  Reassign to another office
                </span>
                <span className="font-mono text-[10px] font-bold text-ink-muted">Recorded</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-muted">
                City administrators route work; they do not close it. A reassignment changes no
                status, so the reason you give here is the only trace it leaves — it is written into
                the report's history under your name.
              </p>
              <select
                value={reassignOfficeId}
                onChange={(e) => setReassignOfficeId(e.target.value)}
                className="saro-field w-full text-xs"
                aria-label="Receiving office"
              >
                <option value="">Choose the receiving office…</option>
                {offices
                  .filter((item) => String(item.id) !== String(report.assigned_office_id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.short_name ?? item.full_name}
                    </option>
                  ))}
              </select>
              <textarea
                rows={2}
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="e.g. Routed to Engineering by category, but the report describes a live gas leak."
                className="saro-field w-full text-xs"
              />
              {reassignDone && (
                <p className="rounded border border-status-resolved-tab bg-status-resolved-wash p-2 text-[11px] font-bold text-status-resolved-ink">
                  {reassignDone}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || !reassignOfficeId || reassignReason.trim().length < 8}
                className="saro-btn saro-btn-primary saro-btn-block justify-center py-2 text-xs font-bold"
              >
                <CornerUpLeft width={14} height={14} />
                {submitting ? "Reassigning…" : "Reassign with reason"}
              </button>
            </form>
          )}

          {!canDispatch && !canEndorse && !canReassign && (
            <div className="rounded border border-line bg-sunken p-3 text-xs text-ink-muted">
              Read-only view. This report is handled by
              {office?.short_name ? ` ${office.short_name}` : " the assigned office"}.
            </div>
          )}

          {canDelete && (
            <div className="border border-alert/40 bg-alert-wash p-3">
              {confirmingDelete ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-alert">Permanently delete {report.tracking_code}?</p>
                  <p className="text-[11px] leading-relaxed text-ink-muted">Its timeline and media references will also be removed. This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmingDelete(false)} disabled={submitting} className="saro-btn saro-btn-secondary saro-btn-sm flex-1">Cancel</button>
                    <button type="button" onClick={handleDelete} disabled={submitting} className="saro-btn saro-btn-sm flex-1 bg-alert text-white hover:bg-alert/90"><Trash2 width={13} height={13} />{submitting ? "Deleting…" : "Delete permanently"}</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingDelete(true)} className="saro-btn saro-btn-ghost saro-btn-sm text-alert"><Trash2 width={14} height={14} /> Delete report</button>
              )}
            </div>
          )}

          {/* ── Status History Audit Trail ─────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-line">
            <span className="t-label text-ink-faint uppercase text-[10px] font-bold tracking-wider flex items-center gap-1">
              <History width={12} height={12} />
              Full Status History & Audit Trail ({historyList.length})
            </span>

            {loadingDetails ? (
              <div className="py-4 text-center text-xs text-ink-faint">Loading history...</div>
            ) : historyList.length > 0 ? (
              <ol className="space-y-2">
                {historyList.map((h, i) => (
                  <li key={h.id || i} className="p-2.5 bg-surface border border-line rounded text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <StatusTag status={h.status} />
                        {h.from_status && (
                          <span className="text-[10px] text-ink-faint flex items-center gap-0.5">
                            (was {STATUS_LABELS[h.from_status] || h.from_status})
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-ink-faint">
                        {formatHistoryDate(h.changed_at)}
                      </span>
                    </div>

                    {h.note && (
                      <p className="text-ink bg-sunken/60 p-2 rounded border border-line/60 text-[11px] leading-relaxed mt-1">
                        {h.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="p-3 bg-sunken border border-line rounded text-center text-xs text-ink-faint font-medium">
                Initial submission recorded.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Enlarged Photo Lightbox Modal */}
      {activePhotoModal && (
        <div
          onClick={() => setActivePhotoModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div className="relative max-w-2xl max-h-[90vh] bg-white rounded overflow-hidden shadow-2xl p-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setActivePhotoModal(null)}
              className="absolute top-3 right-3 bg-black/80 text-white p-1.5 rounded-full hover:bg-black"
            >
              <X width={16} height={16} />
            </button>
            <img src={activePhotoModal} alt="Enlarged view" className="max-h-[80vh] w-auto object-contain rounded" />
          </div>
        </div>
      )}
    </aside>
  );
}
