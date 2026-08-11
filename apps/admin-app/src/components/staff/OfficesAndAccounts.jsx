import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Building2, Users, ShieldCheck, CheckCircle2, XCircle, Edit3, AlertTriangle,
  Search, UserCheck, UserX, Clock, X, ChevronRight, Activity, Filter, Check,
  Trash2, Mail, Shield, AlertCircle, RefreshCw, User, FileSpreadsheet, History,
  ClipboardList, ShieldAlert
} from "lucide-react";
import {
  getOffices, getCategories, getBarangays, getReports, getProfiles, updateProfile,
  checkAccountHistory, deleteProfile,
  getResidentAccounts, deleteResidentAccount, getResidentDeletionLogs,
  useAuth, ROLE_ADMIN, ROLE_OFFICE, ROLE_BARANGAY_OFFICIAL
} from "@saro/shared";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function timeAgo(iso) {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "never";
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function roleBadge(role) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
        <ShieldCheck width={12} height={12} />
        City Admin
      </span>
    );
  }
  if (role === "barangay_official") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
        <Building2 width={12} height={12} />
        Barangay Official
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
      <Users width={12} height={12} />
      Office Staff
    </span>
  );
}

const ALL_CONNECTED_OFFICES = [
  { id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444", short_name: "CDRRMO", full_name: "City Disaster Risk Reduction & Management Office", code: "DRRM" },
  { id: "3362fc03-d004-4148-8268-00d8c0a959b7", short_name: "City Engineering", full_name: "City Engineering Office", code: "CEO" },
  { id: "legazpi-911", short_name: "Legazpi 911", full_name: "Legazpi 911 Emergency Services", code: "911" },
  { id: "pnp-legazpi", short_name: "PNP Legazpi", full_name: "Philippine National Police - Legazpi Station", code: "PNP" },
  { id: "bfp-legazpi", short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi District", code: "BFP" },
  { id: "cho-legazpi", short_name: "City Health Office", full_name: "City Health Office - Health & Sanitation", code: "CHO" },
  { id: "pso-legazpi", short_name: "Public Safety Office", full_name: "Public Safety & Traffic Management Office", code: "PSO" },
];

export default function OfficesAndAccounts() {
  const { profile, isAdmin, signOut, viewerScope } = useAuth();
  const [offices, setOffices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [reports, setReports] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Directory Tab state (staff, residents, audit_trail)
  const [activeDirectoryTab, setActiveDirectoryTab] = useState("staff");

  // Resident Accounts State
  const [residentAccounts, setResidentAccounts] = useState([]);
  const [residentSearch, setResidentSearch] = useState("");
  const [deletingResident, setDeletingResident] = useState(null);
  const [deleteReasonPreset, setDeleteReasonPreset] = useState("Requested by resident");
  const [deleteReasonCustom, setDeleteReasonCustom] = useState("");
  const [residentDeleteBusy, setResidentDeleteBusy] = useState(false);
  const [residentDeleteError, setResidentDeleteError] = useState("");
  const [residentDeletionLogs, setResidentDeletionLogs] = useState([]);

  // Filters & search
  const [roleFilter, setRoleFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Edit Account Drawer State
  const [editingProfile, setEditingProfile] = useState(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("office");
  const [editOfficeId, setEditOfficeId] = useState("");
  const [editBarangayId, setEditBarangayId] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Delete Confirmation Modal State
  const [deletingProfile, setDeletingProfile] = useState(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  const [deleteHistoryInfo, setDeleteHistoryInfo] = useState({ hasHistory: false, activityCount: 0 });
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const activeAdminCount = useMemo(() => {
    return profiles.filter((p) => p.role === "admin" && p.is_active !== false).length;
  }, [profiles]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [oRes, cRes, bRes, rRes, pRes, resAccRes, delLogsRes] = await Promise.all([
      getOffices(),
      getCategories(),
      getBarangays(),
      /* Admin-only screen, so this is city-wide — but it asks with a scope like
         every other read, so the answer is a decision rather than an omission. */
      getReports({ scope: viewerScope }),
      getProfiles(),
      getResidentAccounts(),
      getResidentDeletionLogs(),
    ]);

    if (oRes.data) setOffices(oRes.data.length > 0 ? oRes.data : ALL_CONNECTED_OFFICES);
    else setOffices(ALL_CONNECTED_OFFICES);

    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (rRes.data) setReports(rRes.data);
    if (pRes.data) setProfiles(pRes.data);
    if (resAccRes.data) setResidentAccounts(resAccRes.data);
    if (delLogsRes.data) setResidentDeletionLogs(delLogsRes.data);
    setLoading(false);
  }, [viewerScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Combine fetched offices with master connected office list, de-duplicating by short_name
  const combinedOffices = useMemo(() => {
    const officeMap = new Map();
    for (const o of offices) {
      if (o.short_name) {
        const key = o.short_name.trim().toLowerCase();
        officeMap.set(key, {
          ...o,
          code: o.short_name.slice(0, 4).toUpperCase(),
        });
      }
    }
    for (const o of ALL_CONNECTED_OFFICES) {
      const key = o.short_name.trim().toLowerCase();
      if (!officeMap.has(key)) {
        officeMap.set(key, o);
      }
    }
    return [...officeMap.values()];
  }, [offices]);

  // Office Metrics mapping with flexible ID & short_name matching
  const officeMetrics = useMemo(() => {
    const metrics = {};
    for (const off of combinedOffices) {
      const officeReports = reports.filter((r) => {
        const assignedId = r.assigned_office_id || r.offices?.id || r.office_id;
        const assignedName = r.offices?.short_name || r.office_name;
        return (
          assignedId === off.id ||
          (assignedName && assignedName.toLowerCase() === off.short_name?.toLowerCase())
        );
      });
      const open = officeReports.filter((r) => r.status !== "resolved" && r.status !== "closed_confirmed").length;
      const overdue = officeReports.filter((r) => {
        if (r.status === "resolved" || r.status === "closed_confirmed") return false;
        const slaMs = (r.routing_table?.sla_hours ?? 24) * 3600000;
        return Date.now() - new Date(r.created_at).getTime() > slaMs;
      }).length;
      const assignedCats = categories
        .filter((c) => {
          const catOffId = c.responsible_office_id || c.office_id || c.offices?.id;
          const catOffName = c.offices?.short_name || c.office_name;
          return (
            catOffId === off.id ||
            (catOffName && catOffName.toLowerCase() === off.short_name?.toLowerCase())
          );
        })
        .map((c) => c.label ?? c.name ?? c.category);

      const assignedStaff = profiles.filter((p) => {
        const pOffId = p.office_id || p.offices?.id;
        const pOffName = p.office_name || p.offices?.short_name;
        return (
          (pOffId === off.id || (pOffName && pOffName.toLowerCase() === off.short_name?.toLowerCase())) &&
          p.is_active !== false
        );
      });

      const totalCount = officeReports.length;
      /* Null, not 98. An office with no reports has no compliance rate, and the
         old default invented a flattering one — a brand-new office displayed
         "98% SLA" before it had ever been sent anything. */
      const slaRate = totalCount > 0 ? Math.round(((totalCount - overdue) / totalCount) * 100) : null;

      /* When this office last did anything. An office with two open reports and
         no activity for a week is a different problem from one with twenty and
         hourly updates, and the count alone cannot tell them apart. */
      const lastActivityAt = officeReports.reduce((latest, report) => {
        const stamp = report.updated_at || report.created_at;
        return !latest || (stamp && stamp > latest) ? stamp : latest;
      }, null);

      metrics[off.id] = {
        office: off,
        total: totalCount,
        open,
        overdue,
        slaRate,
        onTime: totalCount - overdue,
        lastActivityAt,
        categories: assignedCats,
        staff: assignedStaff,
        coordinators: assignedStaff.filter((p) => p.is_coordinator),
      };
    }
    return metrics;
  }, [combinedOffices, reports, categories, profiles]);

  // Filtered accounts list
  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (roleFilter !== "all" && p.role !== roleFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (p.full_name || "").toLowerCase();
        const email = (p.email || "").toLowerCase();
        const office = (p.office_name || "").toLowerCase();
        const brgy = (p.barangay_name || "").toLowerCase();
        return name.includes(q) || email.includes(q) || office.includes(q) || brgy.includes(q);
      }
      return true;
    });
  }, [profiles, roleFilter, searchQuery]);

  const startEdit = (profileItem) => {
    setError("");
    setEditingProfile(profileItem);
    setEditFullName(profileItem.full_name || "");
    setEditEmail(profileItem.email || "");
    setEditRole(profileItem.role || "office");
    setEditOfficeId(profileItem.office_id || "");
    setEditBarangayId(profileItem.barangay_id || "");
    setEditIsActive(profileItem.is_active !== false);
  };

  const handleSave = async () => {
    if (!editingProfile) return;
    setError("");

    // Safeguard: Never allow deactivating or removing role from the last active City Admin
    const isCurrentlyActiveAdmin = editingProfile.role === "admin" && editingProfile.is_active !== false;
    const willBeActiveAdmin = editRole === "admin" && editIsActive;

    if (isCurrentlyActiveAdmin && !willBeActiveAdmin && activeAdminCount <= 1) {
      setError("Cannot demote or deactivate the last remaining active City Admin account. Promote another active user to City Admin first.");
      return;
    }

    setSaving(true);

    const updates = {
      full_name: editFullName,
      email: editEmail,
      role: editRole,
      office_id: editRole === "office" ? editOfficeId : null,
      barangay_id: editRole === "barangay_official" ? editBarangayId : null,
      is_active: editIsActive,
    };

    const { error: updateErr } = await updateProfile(editingProfile.id, updates);
    setSaving(false);
    if (updateErr) {
      setError(updateErr);
      return;
    }

    setEditingProfile(null);
    await loadData();
  };

  const toggleAccountActive = async (profileItem) => {
    const isCurrentlyActiveAdmin = profileItem.role === "admin" && profileItem.is_active !== false;
    if (isCurrentlyActiveAdmin && activeAdminCount <= 1) {
      alert("Cannot deactivate the last remaining active City Admin account.");
      return;
    }

    const { error: updateErr } = await updateProfile(profileItem.id, {
      is_active: !profileItem.is_active,
    });
    if (!updateErr) {
      await loadData();
    }
  };

  const startDelete = async (profileItem) => {
    setDeleteError("");
    const isCurrentlyActiveAdmin = profileItem.role === "admin" && profileItem.is_active !== false;
    if (isCurrentlyActiveAdmin && activeAdminCount <= 1) {
      alert("Cannot delete the last remaining active City Admin account.");
      return;
    }

    setDeletingProfile(profileItem);
    setDeleteChecking(true);
    const info = await checkAccountHistory(profileItem.id);
    setDeleteHistoryInfo(info);
    setDeleteChecking(false);
  };

  const confirmDelete = async () => {
    if (!deletingProfile) return;
    setDeleteError("");

    const isCurrentlyActiveAdmin = deletingProfile.role === "admin" && deletingProfile.is_active !== false;
    if (isCurrentlyActiveAdmin && activeAdminCount <= 1) {
      setDeleteError("Cannot delete the last remaining active City Admin account.");
      return;
    }

    setDeleteBusy(true);
    const { error: delErr } = await deleteProfile(deletingProfile.id, {
      forceAnonymize: deleteHistoryInfo.hasHistory,
    });
    setDeleteBusy(false);

    if (delErr) {
      setDeleteError(delErr);
      return;
    }

    const isSelfDelete = profile?.id === deletingProfile.id;
    setDeletingProfile(null);

    if (isSelfDelete) {
      signOut();
    } else {
      await loadData();
    }
  };

  const filteredResidents = useMemo(() => {
    return residentAccounts.filter((r) => {
      if (residentSearch.trim()) {
        const q = residentSearch.toLowerCase();
        const name = (r.full_name || "").toLowerCase();
        const email = (r.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      }
      return true;
    });
  }, [residentAccounts, residentSearch]);

  const confirmDeleteResident = async () => {
    if (!deletingResident) return;
    setResidentDeleteError("");
    const finalReason = deleteReasonPreset === "Other" ? deleteReasonCustom : deleteReasonPreset;

    if (!finalReason || !finalReason.trim()) {
      setResidentDeleteError("Please specify a reason for deleting this resident account.");
      return;
    }

    setResidentDeleteBusy(true);
    const { error: delErr } = await deleteResidentAccount({
      userId: deletingResident.id,
      reason: finalReason,
      adminId: profile?.id,
      adminName: profile?.full_name || "City Admin",
    });
    setResidentDeleteBusy(false);

    if (delErr) {
      setResidentDeleteError(delErr);
      return;
    }

    setDeletingResident(null);
    await loadData();
  };

  if (!isAdmin) return null;

  return (
    <div className="flex flex-col gap-6 font-sans pb-8">
      {/* ── Page Title & Summary Header ───────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="t-heading text-ink font-bold flex items-center gap-2">
            <Building2 width={20} height={20} className="text-brand" />
            Offices & Accounts Oversight
          </h1>
          <p className="t-body-sm text-ink-muted mt-1">
            City-wide oversight panel for managing connected departments, staff accounts, and barangay official access.
          </p>
        </div>

        {/* Global Summary Stats */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Connected Offices</span>
            <span className="text-base font-bold font-mono text-brand">{combinedOffices.length}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Active Staff</span>
            <span className="text-base font-bold font-mono text-ink">
              {profiles.filter((p) => p.is_active !== false).length}
            </span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Open Incidents</span>
            <span className="text-base font-bold font-mono text-amber-600">
              {reports.filter((r) => r.status !== "resolved" && r.status !== "closed_confirmed").length}
            </span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Total Overdue</span>
            <span className="text-base font-bold font-mono text-alert">
              {reports.filter((r) => {
                if (r.status === "resolved" || r.status === "closed_confirmed") return false;
                const sla = (r.routing_table?.sla_hours ?? 24) * 3600000;
                return Date.now() - new Date(r.created_at).getTime() > sla;
              }).length}
            </span>
          </div>
        </div>
      </div>

      {/* ── Connected Offices Grid ────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="t-subhead font-bold text-ink flex items-center gap-2">
            <Activity width={16} height={16} className="text-brand" />
            Department Response & Status
          </h2>
          <span className="text-xs text-ink-muted">
            {combinedOffices.length} departments linked to SARO dispatch
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {combinedOffices.map((off) => {
            const m = officeMetrics[off.id] || {
              open: 0, overdue: 0, slaRate: null, total: 0, onTime: 0,
              lastActivityAt: null, categories: [], staff: [], coordinators: [],
            };
            return (
              <div key={off.id} className="saro-card p-4 flex flex-col justify-between border border-line bg-white shadow-xs hover:border-brand-edge transition-colors">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-bold bg-sunken text-ink-faint px-1.5 py-0.5 rounded uppercase">
                        {off.code || "DEPT"}
                      </span>
                      <h3 className="t-body-sm font-bold text-ink mt-1.5">{off.short_name}</h3>
                      <p className="text-[11px] text-ink-muted line-clamp-1">{off.full_name}</p>
                    </div>
                    {/* A percentage with no denominator is not a measurement.
                        "50% SLA" over two reports and over two hundred are
                        different facts, and an office with nothing in its queue
                        has no rate at all rather than a flattering default. */}
                    {m.slaRate === null ? (
                      <span className="rounded border border-line bg-sunken px-2 py-0.5 font-mono text-[11px] font-bold text-ink-faint">
                        No reports yet
                      </span>
                    ) : (
                      <span
                        className={`rounded border px-2 py-0.5 text-right font-mono text-[11px] font-bold ${
                          m.slaRate >= 90
                            ? "border-status-resolved-tab bg-status-resolved-wash text-status-resolved-ink"
                            : m.slaRate >= 50
                            ? "border-status-assigned-tab bg-status-assigned-wash text-status-assigned-ink"
                            : "border-alert bg-alert-wash text-alert"
                        }`}
                        title={`${m.onTime} of ${m.total} reports answered inside their SLA`}
                      >
                        {m.onTime}/{m.total} on time
                      </span>
                    )}
                  </div>

                  {/* Office Status Bar */}
                  <div className="grid grid-cols-2 gap-2 mt-4 p-2 rounded bg-raised border border-line/60">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-ink-faint block">Open Queue</span>
                      <span className="t-data font-bold text-ink">{m.open}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-ink-faint block">Overdue</span>
                      <span className={`t-data font-bold ${m.overdue > 0 ? "text-alert" : "text-ink-muted"}`}>
                        {m.overdue}
                      </span>
                    </div>
                  </div>

                  {/* Assigned Categories Badges */}
                  <div className="mt-3">
                    <span className="text-[10px] uppercase font-bold text-ink-faint block mb-1">
                      Routing Scope ({m.categories.length})
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {m.categories.length > 0 ? (
                        m.categories.slice(0, 2).map((cat, idx) => (
                          <span key={idx} className="text-[10px] bg-sunken text-ink-muted px-1.5 py-0.5 rounded truncate max-w-[140px]">
                            {cat}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-ink-faint italic">No dedicated category</span>
                      )}
                      {m.categories.length > 2 && (
                        <span className="text-[10px] text-ink-faint font-bold">
                          +{m.categories.length - 2} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Staff, coordination role, and when this office last moved
                    anything — "Managed" said nothing at all. */}
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    <Users width={13} height={13} className="text-ink-faint" />
                    {m.staff.length} active account{m.staff.length === 1 ? "" : "s"}
                  </span>
                  {m.coordinators.length > 0 ? (
                    <span
                      className="rounded border border-brand-edge bg-brand-wash px-1.5 py-0.5 text-[10px] font-bold text-brand"
                      title="Reads every emergency-tier report citywide. Read-only."
                    >
                      Coordinating office
                    </span>
                  ) : (
                    <span className="text-[10px] text-ink-faint">
                      {m.lastActivityAt ? `Last activity ${timeAgo(m.lastActivityAt)}` : "No activity yet"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Directory Tabs & Oversight Sections ───────────────────────── */}
      <section className="space-y-4 pt-2">
        {/* Navigation Tabs Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveDirectoryTab("staff")}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-2 ${
                activeDirectoryTab === "staff"
                  ? "bg-brand text-white shadow-xs"
                  : "bg-sunken text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Users width={14} height={14} />
              Staff & Official Accounts ({profiles.length})
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setActiveDirectoryTab("residents")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-2 ${
                    activeDirectoryTab === "residents"
                      ? "bg-brand text-white shadow-xs"
                      : "bg-sunken text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <User width={14} height={14} />
                  Resident Accounts ({residentAccounts.length})
                </button>
                <button
                  onClick={() => setActiveDirectoryTab("audit_trail")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-2 ${
                    activeDirectoryTab === "audit_trail"
                      ? "bg-brand text-white shadow-xs"
                      : "bg-sunken text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <History width={14} height={14} />
                  Deletion Audit Trail ({residentDeletionLogs.length})
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── 1. STAFF & OFFICIAL ACCOUNTS TAB ───────────────────────── */}
        {activeDirectoryTab === "staff" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="t-subhead font-bold text-ink flex items-center gap-2">
                  <Users width={16} height={16} className="text-brand" />
                  Staff & Official Accounts Directory
                </h2>
                <p className="t-body-sm text-ink-muted mt-0.5">
                  Manage accounts, assign office or barangay roles, and toggle account activation status.
                </p>
              </div>

              {/* Search and Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search
                    width={14}
                    height={14}
                    strokeWidth={2.25}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-ink-muted)" }}
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search staff, email, office..."
                    className="saro-input pl-8 pr-3 py-1.5 text-xs w-64"
                  />
                </div>

                <div className="flex items-center gap-px border border-line bg-line rounded overflow-hidden">
                  {[
                    { id: "all", label: "All Accounts" },
                    { id: "admin", label: "Admins" },
                    { id: "office", label: "Office Staff" },
                    { id: "barangay_official", label: "Barangay Officials" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setRoleFilter(f.id)}
                      className="saro-btn saro-btn-sm"
                      style={{
                        background: roleFilter === f.id ? "var(--color-brand)" : "var(--color-surface)",
                        color: roleFilter === f.id ? "#fff" : "var(--color-ink-muted)",
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Staff Directory Table */}
            <div className="saro-card overflow-x-auto border border-line bg-white shadow-xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-raised border-b border-line">
                    <th className="px-4 py-3 font-bold text-ink-faint">Name & Account</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Role</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Assigned Scope</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Status</th>
                    <th className="px-4 py-3 font-bold text-ink-faint text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.map((p) => {
                    const scopeName =
                      p.role === "admin"
                        ? "City EOC (Global)"
                        : p.role === "barangay_official"
                        ? p.barangay_name ? `Brgy. ${p.barangay_name}` : "Unassigned Barangay"
                        : p.office_name || "Unassigned Office";

                    const isActive = p.is_active !== false;

                    return (
                      <tr key={p.id} className="border-b border-line/60 hover:bg-raised/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-ink text-sm">{p.full_name || "Unnamed Staff"}</div>
                          <div className="text-ink-muted font-mono text-[11px]">{p.email || p.id}</div>
                        </td>
                        <td className="px-4 py-3">{roleBadge(p.role)}</td>
                        <td className="px-4 py-3 font-medium text-ink">
                          <div className="flex items-center gap-1.5">
                            {p.role === "admin" && <ShieldCheck width={14} height={14} className="text-purple-600 shrink-0" />}
                            {p.role === "office" && <Building2 width={14} height={14} className="text-amber-600 shrink-0" />}
                            {p.role === "barangay_official" && <Building2 width={14} height={14} className="text-blue-600 shrink-0" />}
                            <span>{scopeName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 width={12} height={12} />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              <XCircle width={12} height={12} />
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => startEdit(p)}
                              title="Edit account details and scope"
                              className="saro-btn saro-btn-secondary saro-btn-sm"
                            >
                              <Edit3 width={13} height={13} />
                              Edit
                            </button>
                            <button
                              onClick={() => toggleAccountActive(p)}
                              title={isActive ? "Deactivate account access" : "Activate account access"}
                              className={`saro-btn saro-btn-sm ${isActive ? "saro-btn-secondary text-alert" : "saro-btn-primary"}`}
                            >
                              {isActive ? <UserX width={13} height={13} /> : <UserCheck width={13} height={13} />}
                              {isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => startDelete(p)}
                              title="Delete account"
                              className="saro-btn saro-btn-secondary saro-btn-sm text-alert hover:bg-alert-wash"
                            >
                              <Trash2 width={13} height={13} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredProfiles.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                        No accounts match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 2. RESIDENT ACCOUNTS TAB (ADMIN ONLY) ─────────────────── */}
        {activeDirectoryTab === "residents" && isAdmin && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="t-subhead font-bold text-ink flex items-center gap-2">
                  <User width={16} height={16} className="text-brand" />
                  Resident Accounts Oversight
                </h2>
                <p className="t-body-sm text-ink-muted mt-0.5">
                  View registered resident accounts, report activity counts, and manage account removals with mandatory audit logging.
                </p>
              </div>

              {/* Resident Search Input */}
              <div className="relative">
                <Search
                  width={14}
                  height={14}
                  strokeWidth={2.25}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-ink-muted)" }}
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={residentSearch}
                  onChange={(e) => setResidentSearch(e.target.value)}
                  placeholder="Search resident name or email..."
                  className="saro-input pl-8 pr-3 py-1.5 text-xs w-64"
                />
              </div>
            </div>

            {/* Resident Directory Table */}
            <div className="saro-card overflow-x-auto border border-line bg-white shadow-xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-raised border-b border-line">
                    <th className="px-4 py-3 font-bold text-ink-faint">Resident Account</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Reports Filed</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Account Status</th>
                    <th className="px-4 py-3 font-bold text-ink-faint text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResidents.map((res) => (
                    <tr key={res.id} className="border-b border-line/60 hover:bg-raised/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink text-sm">{res.full_name || "Unnamed Resident"}</div>
                        <div className="text-ink-muted font-mono text-[11px]">{res.email || res.id}</div>
                      </td>

                      <td className="px-4 py-3 font-medium text-ink">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand/10 text-brand font-bold font-mono text-[11px]">
                          <ClipboardList width={12} height={12} />
                          {res.reportsCount || 0} report{res.reportsCount === 1 ? "" : "s"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 width={12} height={12} />
                          Active Resident
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setDeleteReasonPreset("Requested by resident");
                            setDeleteReasonCustom("");
                            setResidentDeleteError("");
                            setDeletingResident(res);
                          }}
                          className="saro-btn saro-btn-secondary saro-btn-sm text-alert hover:bg-alert-wash"
                        >
                          <Trash2 width={13} height={13} />
                          Delete Account
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredResidents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-ink-muted">
                        No resident accounts match the current search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 3. DELETION AUDIT TRAIL TAB (ADMIN ONLY) ───────────────── */}
        {activeDirectoryTab === "audit_trail" && isAdmin && (
          <div className="space-y-4">
            <div>
              <h2 className="t-subhead font-bold text-ink flex items-center gap-2">
                <History width={16} height={16} className="text-brand" />
                Resident Account Deletion Audit Trail
              </h2>
              <p className="t-body-sm text-ink-muted mt-0.5">
                Permanent audit log recording every resident account removal, performing admin, timestamp, and mandatory justification.
              </p>
            </div>

            <div className="saro-card overflow-x-auto border border-line bg-white shadow-xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-raised border-b border-line">
                    <th className="px-4 py-3 font-bold text-ink-faint">Timestamp</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Target Resident</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Triggered By</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Mandatory Justification</th>
                    <th className="px-4 py-3 font-bold text-ink-faint">Report Records State</th>
                  </tr>
                </thead>
                <tbody>
                  {residentDeletionLogs.map((log) => (
                    <tr key={log.id} className="border-b border-line/60 hover:bg-raised/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] text-ink-muted">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-bold text-ink">{log.resident_name}</div>
                        <div className="text-ink-muted font-mono text-[11px]">{log.resident_email}</div>
                      </td>

                      <td className="px-4 py-3 font-medium">
                        {log.deleted_by_role === "admin" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded border border-purple-200">
                            <ShieldCheck width={12} height={12} />
                            Admin: {log.admin_name || "City Admin"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded border border-blue-200">
                            <User width={12} height={12} />
                            Resident Self-Delete
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 font-medium text-ink max-w-xs">
                        <span className="bg-sunken px-2 py-1 rounded text-ink font-sans inline-block">
                          "{log.reason}"
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 width={12} height={12} />
                          Reports Unlinked & Preserved
                        </span>
                      </td>
                    </tr>
                  ))}

                  {residentDeletionLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                        No account deletion logs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Admin Delete Resident Confirmation Modal ───────────────────── */}
      {deletingResident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4 font-sans">
          <div className="saro-card w-full max-w-lg bg-white border border-line p-6 shadow-card animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="t-subhead font-bold text-ink flex items-center gap-2">
                  <Trash2 width={16} height={16} className="text-alert" />
                  Confirm Resident Account Removal
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">{deletingResident.email}</p>
              </div>
              <button onClick={() => setDeletingResident(null)} className="saro-btn saro-btn-ghost saro-btn-sm">
                <X width={16} height={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded border border-blue-200 bg-blue-50 text-blue-900 space-y-1">
                <span className="font-bold text-blue-950 block flex items-center gap-1.5">
                  <Shield width={14} height={14} className="text-blue-700 shrink-0" />
                  Report History Preservation Rule
                </span>
                <p className="leading-relaxed">
                  Deleting this resident account <strong>will NOT delete their {deletingResident.reportsCount || 0} filed report(s)</strong>.
                </p>
                <p className="leading-relaxed text-[11px] text-blue-800">
                  All reports stay safely saved with the city, remain checkable by their tracking codes, and are simply unlinked from this account login.
                </p>
              </div>

              {/* Mandatory Reason Selector */}
              <label className="block space-y-1">
                <span className="font-bold text-ink block">Mandatory Deletion Reason (Audit Logged)</span>
                <select
                  value={deleteReasonPreset}
                  onChange={(e) => setDeleteReasonPreset(e.target.value)}
                  className="saro-input w-full text-xs"
                >
                  <option value="Requested by resident">Requested by resident</option>
                  <option value="Inactive / spam account">Inactive / spam account</option>
                  <option value="Duplicate account">Duplicate account</option>
                  <option value="Other">Other (specify custom reason below)</option>
                </select>
              </label>

              {deleteReasonPreset === "Other" && (
                <label className="block">
                  <span className="t-label text-ink-faint block mb-1">Custom Reason Explanation</span>
                  <textarea
                    rows={2}
                    value={deleteReasonCustom}
                    onChange={(e) => setDeleteReasonCustom(e.target.value)}
                    placeholder="Provide context for audit record..."
                    className="saro-input w-full text-xs"
                  />
                </label>
              )}

              {residentDeleteError && (
                <p role="alert" className="text-xs border border-alert bg-alert-wash p-2.5 text-alert rounded font-bold">
                  {residentDeleteError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setDeletingResident(null)}
                className="saro-btn saro-btn-secondary saro-btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteResident}
                disabled={residentDeleteBusy}
                className="saro-btn saro-btn-sm bg-alert hover:bg-alert-strong text-white font-bold"
              >
                {residentDeleteBusy ? "Deleting Account…" : "Unlink Account & Remove Login"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Account Modal / Drawer ───────────────────────────────── */}
      {editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4">
          <div className="saro-card w-full max-w-lg bg-white border border-line p-6 shadow-card animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="t-subhead font-bold text-ink">Edit Staff Account</h3>
                <p className="text-xs text-ink-muted mt-0.5">{editingProfile.email}</p>
              </div>
              <button onClick={() => setEditingProfile(null)} className="saro-btn saro-btn-ghost saro-btn-sm">
                <X width={16} height={16} />
              </button>
            </div>

            <div className="space-y-4 py-4">
              {/* Full Name */}
              <label className="block">
                <span className="t-label text-ink-faint block mb-1">Full Name</span>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="saro-input w-full text-xs"
                />
              </label>

              {/* Email Address */}
              <label className="block">
                <span className="t-label text-ink-faint block mb-1">Email Address</span>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="saro-input w-full text-xs font-mono"
                />
              </label>

              {/* System Role */}
              <label className="block">
                <span className="t-label text-ink-faint block mb-1">System Role</span>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="saro-input w-full text-xs"
                >
                  <option value="admin">City Director / Admin (Full Access)</option>
                  <option value="office">Office Staff (Department Scoped)</option>
                  <option value="barangay_official">Barangay Official (Barangay Scoped)</option>
                </select>
              </label>

              {/* Office Assignment (for Office Staff) */}
              {editRole === "office" && (
                <label className="block">
                  <span className="t-label text-ink-faint block mb-1">Assigned Department / Office</span>
                  <select
                    value={editOfficeId}
                    onChange={(e) => setEditOfficeId(e.target.value)}
                    className="saro-input w-full text-xs"
                  >
                    <option value="">-- Select Office --</option>
                    {combinedOffices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.short_name} ({o.full_name})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Barangay Assignment (for Barangay Official) */}
              {editRole === "barangay_official" && (
                <label className="block">
                  <span className="t-label text-ink-faint block mb-1">Assigned Barangay</span>
                  <select
                    value={editBarangayId}
                    onChange={(e) => setEditBarangayId(e.target.value)}
                    className="saro-input w-full text-xs"
                  >
                    <option value="">-- Select Barangay --</option>
                    {barangays.map((b) => (
                      <option key={b.id} value={b.id}>
                        Brgy. {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Account Status Toggle */}
              <div className="flex items-center justify-between p-3 rounded bg-raised border border-line">
                <div>
                  <span className="t-body-sm font-bold text-ink block">Account Active Status</span>
                  <span className="text-[11px] text-ink-muted">
                    {editIsActive ? "Account can sign in and manage reports." : "Account is disabled."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditIsActive(!editIsActive)}
                  className={`saro-btn saro-btn-sm ${editIsActive ? "saro-btn-primary" : "saro-btn-secondary"}`}
                >
                  {editIsActive ? "Active" : "Disabled"}
                </button>
              </div>

              {error && (
                <p role="alert" className="text-xs border border-alert bg-alert-wash p-2.5 text-alert rounded font-bold">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="saro-btn saro-btn-secondary saro-btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="saro-btn saro-btn-primary saro-btn-sm"
              >
                {saving ? "Saving Changes…" : "Save Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Account Confirmation Modal ──────────────────────────── */}
      {deletingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4">
          <div className="saro-card w-full max-w-lg bg-white border border-line p-6 shadow-card animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="t-subhead font-bold text-ink flex items-center gap-2">
                  <Trash2 width={16} height={16} className="text-alert" />
                  Confirm Account Removal
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">{deletingProfile.email}</p>
              </div>
              <button onClick={() => setDeletingProfile(null)} className="saro-btn saro-btn-ghost saro-btn-sm">
                <X width={16} height={16} />
              </button>
            </div>

            {deleteChecking ? (
              <div className="py-8 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
                <RefreshCw width={14} height={14} className="animate-spin" />
                Checking historical activity & operational records…
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded border bg-raised border-line font-medium text-ink">
                  <span className="font-bold block mb-1">Target Account:</span>
                  <div>{deletingProfile.full_name || "Unnamed Staff"} ({deletingProfile.email})</div>
                  <div className="text-ink-faint text-[11px] mt-0.5 font-mono">Role: {deletingProfile.role}</div>
                </div>

                {/* Self-Account Notice */}
                {profile?.id === deletingProfile.id && (
                  <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 font-medium">
                    <span className="font-bold block mb-0.5 flex items-center gap-1">
                      <AlertTriangle width={14} height={14} className="text-amber-700" />
                      Self-Account Deletion Notice
                    </span>
                    You are removing your own currently logged-in account. Once completed, your active session will terminate immediately and you will be signed out.
                  </div>
                )}

                {/* Historical Audit Result Notice */}
                {deleteHistoryInfo.hasHistory ? (
                  <div className="p-3.5 rounded border border-blue-200 bg-blue-50 text-blue-900 space-y-1">
                    <span className="font-bold text-blue-950 block flex items-center gap-1.5">
                      <Shield width={14} height={14} className="text-blue-700 shrink-0" />
                      Anonymized Historical Preservation (Audit Safe)
                    </span>
                    <p className="leading-relaxed">
                      This account has <strong>{deleteHistoryInfo.activityCount} linked operational record(s)</strong> (incident closures, status updates, or SOS reviews).
                    </p>
                    <p className="leading-relaxed text-[11px] text-blue-800">
                      To maintain legal audit logs, the account will be <strong>anonymized as "Former staff member"</strong> and its login credentials permanently revoked. Historical incident records will remain intact.
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5 rounded border border-rose-200 bg-rose-50 text-rose-900 space-y-1">
                    <span className="font-bold text-rose-950 block flex items-center gap-1.5">
                      <AlertCircle width={14} height={14} className="text-rose-700 shrink-0" />
                      Permanent Account Removal (Hard Delete)
                    </span>
                    <p className="leading-relaxed">
                      This account has no linked operational activity. It will be <strong>permanently deleted</strong> from the system directory.
                    </p>
                  </div>
                )}

                {deleteError && (
                  <p role="alert" className="text-xs border border-alert bg-alert-wash p-2.5 text-alert rounded font-bold">
                    {deleteError}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setDeletingProfile(null)}
                className="saro-btn saro-btn-secondary saro-btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteBusy || deleteChecking}
                className="saro-btn saro-btn-sm bg-alert hover:bg-alert-strong text-white font-bold"
              >
                {deleteBusy
                  ? "Processing…"
                  : deleteHistoryInfo.hasHistory
                  ? "Anonymize & Revoke Access"
                  : "Permanently Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
