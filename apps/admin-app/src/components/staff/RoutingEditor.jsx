import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, Save, X, History, AlertTriangle, Camera, FileText } from "lucide-react";
import {
  getCategories, getOffices, updateCategory, createRoutingRule, deleteRoutingRule,
  getRoutingChangelog, useAuth,
} from "@saro/shared";

/**
 * The routing table.
 *
 * This is the single most consequential screen in the admin app and the least
 * exciting, which is the correct combination. It decides where every report in
 * Legazpi goes. There is no model, no scoring, no suggestion: a category maps
 * to an office because a person decided it should, and that decision is
 * legible, editable, and logged.
 *
 * That is a deliberate refusal, not a gap. Routing by classifier would be
 * easier to build and impossible to answer for — when a fire report lands at
 * the engineering office at 3am, "the model chose it" is not something anyone
 * can act on. A table can be read, corrected in ten seconds, and defended in a
 * council meeting.
 *
 * Every write goes to routing_table_changelog through a database trigger, so
 * the history is a property of the table rather than something this screen
 * remembers to do.
 */

const BLANK = {
  category: "",
  label: "",
  label_bikol: "",
  label_tagalog: "",
  responsible_office_id: "",
  is_emergency: false,
  sla_hours: 24,
  resolution_proof: "photo",
};

export default function RoutingEditor() {
  const { isAdmin } = useAuth();
  const [rules, setRules] = useState([]);
  const [offices, setOffices] = useState([]);
  const [changelog, setChangelog] = useState([]);
  const [editing, setEditing] = useState(null);   // category key, or "__new__"
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    const [c, o, l] = await Promise.all([getCategories(), getOffices(), getRoutingChangelog()]);
    if (c.data) setRules(c.data);
    if (o.data) setOffices(o.data);
    if (l.data) setChangelog(l.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const officeBy = useMemo(() => Object.fromEntries(offices.map((o) => [o.id, o])), [offices]);

  // The fallback office is the one a category with no office of its own falls
  // to. Showing which office holds that job matters: it is where every
  // unrouted report silently accumulates.
  const fallbackCount = rules.filter((r) => !r.responsible_office_id).length;

  const startEdit = (rule) => {
    setError("");
    setEditing(rule.category);
    setDraft({
      category: rule.category,
      label: rule.label ?? rule.name ?? "",
      label_bikol: rule.label_bikol ?? "",
      label_tagalog: rule.label_tagalog ?? "",
      responsible_office_id: rule.responsible_office_id ?? rule.office_id ?? "",
      is_emergency: Boolean(rule.is_emergency),
      sla_hours: rule.sla_hours ?? 24,
      resolution_proof: rule.resolution_proof ?? "photo",
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");

    const { error: saveError } = editing === "__new__"
      ? await createRoutingRule(draft)
      : await updateCategory(editing, draft);

    setBusy(false);
    if (saveError) return setError(saveError);
    setEditing(null);
    await load();
  };

  const remove = async (category) => {
    setBusy(true);
    setError("");
    const { error: deleteError } = await deleteRoutingRule(category);
    setBusy(false);
    if (deleteError) return setError(deleteError);
    await load();
  };

  if (!isAdmin) {
    return (
      <p className="saro-card p-6 t-body-sm text-ink-muted">
        Routing is edited by the city administrator. Your office's queue reflects it
        automatically.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-heading">Routing table</h1>
          <p className="t-body-sm mt-1 text-ink-muted">
            Where each kind of report goes. Edited by hand, never by a model — every change
            is logged with who made it.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowLog((s) => !s)}
            className="saro-btn saro-btn-secondary saro-btn-sm"
            aria-pressed={showLog}
          >
            <History width={14} height={14} />
            {showLog ? "Hide changes" : "Recent changes"}
          </button>
          <button
            onClick={() => { setEditing("__new__"); setDraft(BLANK); setError(""); }}
            className="saro-btn saro-btn-primary saro-btn-sm"
          >
            <Plus width={14} height={14} />
            New rule
          </button>
        </div>
      </div>

      {fallbackCount > 0 && (
        <p className="t-body-sm flex items-start gap-2 border border-alert bg-alert-wash p-3 text-alert">
          <AlertTriangle width={15} height={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {fallbackCount} categor{fallbackCount === 1 ? "y has" : "ies have"} no office. Reports in
          {fallbackCount === 1 ? " it" : " them"} fall to the default office instead of the right one.
        </p>
      )}

      {error && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-3 text-alert">{error}</p>
      )}

      {editing && (
        <RuleForm
          draft={draft}
          setDraft={setDraft}
          offices={offices}
          isNew={editing === "__new__"}
          busy={busy}
          onSave={save}
          onCancel={() => { setEditing(null); setError(""); }}
        />
      )}

      <div className="saro-card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-raised">
              {["Category", "Goes to", "Urgency", "SLA", "Closed with", ""].map((h) => (
                <th key={h} className="t-label px-3 py-2.5 text-left text-ink-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const office = officeBy[rule.responsible_office_id ?? rule.office_id];
              return (
                <tr key={rule.category} className="border-t border-line">
                  <td className="px-3 py-2.5">
                    <span className="t-body-sm block font-bold">{rule.label ?? rule.name}</span>
                    <span className="t-data-sm block text-ink-faint">{rule.category}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {office ? (
                      <span className="t-body-sm">{office.short_name}</span>
                    ) : (
                      <span className="t-body-sm text-alert">Fallback office</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="t-label"
                      style={{ color: rule.is_emergency ? "var(--color-panic-strong)" : "var(--color-ink-faint)" }}
                    >
                      {rule.is_emergency ? "Emergency" : "Standard"}
                    </span>
                  </td>
                  <td className="t-data px-3 py-2.5">{rule.sla_hours}h</td>
                  <td className="px-3 py-2.5">
                    <span className="t-body-sm inline-flex items-center gap-1.5 text-ink-muted">
                      {(rule.resolution_proof ?? "photo") === "photo"
                        ? <><Camera width={13} height={13} aria-hidden="true" />Photo</>
                        : <><FileText width={13} height={13} aria-hidden="true" />Reason + ref</>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => startEdit(rule)} className="saro-btn saro-btn-ghost saro-btn-sm">
                        Edit
                      </button>
                      <button
                        onClick={() => remove(rule.category)}
                        disabled={busy}
                        className="saro-btn saro-btn-ghost saro-btn-sm"
                        aria-label={`Delete ${rule.label}`}
                        title="Refused while any report still uses this category"
                      >
                        <Trash2 width={14} height={14} className="text-alert" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showLog && (
        <section className="saro-card p-4">
          <h2 className="t-label text-ink-faint">Change history</h2>
          <ul className="mt-3 flex flex-col">
            {changelog.slice(0, 25).map((entry) => (
              <li key={entry.id} className="border-b border-line py-2.5 last:border-0">
                <span className="t-body-sm block">
                  <span className="font-bold">{entry.category}</span>
                  {" · "}
                  {entry.field_changed}: {String(entry.old_value ?? "—")} → {String(entry.new_value ?? "—")}
                </span>
                <span className="t-data-sm block text-ink-faint">
                  {new Date(entry.changed_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
            {changelog.length === 0 && (
              <li className="t-body-sm py-2 text-ink-faint">No changes recorded yet.</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function RuleForm({ draft, setDraft, offices, isNew, busy, onSave, onCancel }) {
  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <div className="saro-clip saro-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="t-subhead font-bold">{isNew ? "New routing rule" : `Editing ${draft.label}`}</h2>
        <button onClick={onCancel} className="saro-btn saro-btn-ghost saro-btn-sm" aria-label="Cancel">
          <X width={15} height={15} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="t-label text-ink-faint">Category key</span>
          <input
            value={draft.category}
            onChange={set("category")}
            disabled={!isNew}
            placeholder="blocked_drain"
            className="saro-field mt-1.5 w-full disabled:opacity-60"
          />
          <span className="t-body-sm mt-1 block text-ink-faint">
            {isNew
              ? "Lowercase, no spaces. Permanent — it is stored on every report that uses it."
              : "Cannot change: every existing report stores this key."}
          </span>
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">Label (English)</span>
          <input value={draft.label} onChange={set("label")} className="saro-field mt-1.5 w-full" />
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">Label (Bikol)</span>
          <input value={draft.label_bikol} onChange={set("label_bikol")} className="saro-field mt-1.5 w-full" />
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">Label (Tagalog)</span>
          <input value={draft.label_tagalog} onChange={set("label_tagalog")} className="saro-field mt-1.5 w-full" />
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">Responsible office</span>
          <select
            value={draft.responsible_office_id}
            onChange={set("responsible_office_id")}
            className="saro-field mt-1.5 w-full"
          >
            <option value="">— fallback office —</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.short_name} · {o.full_name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">SLA (hours)</span>
          <input
            type="number"
            min="1"
            value={draft.sla_hours}
            onChange={set("sla_hours")}
            className="saro-field mt-1.5 w-full"
          />
        </label>

        <label className="block">
          <span className="t-label text-ink-faint">Closed with</span>
          <select value={draft.resolution_proof} onChange={set("resolution_proof")} className="saro-field mt-1.5 w-full">
            <option value="photo">A photo of the completed work</option>
            <option value="reference">A reason code and reference</option>
          </select>
          <span className="t-body-sm mt-1 block text-ink-faint">
            Choose reference for anything that cannot be photographed — medical, crime,
            referrals.
          </span>
        </label>

        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            checked={draft.is_emergency}
            onChange={set("is_emergency")}
            className="h-4 w-4"
          />
          <span className="t-body-sm">
            Emergency — residents can file this without an account
          </span>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={onSave} disabled={busy} className="saro-btn saro-btn-primary">
          <Save width={15} height={15} />
          {busy ? "Saving…" : "Save rule"}
        </button>
        <button onClick={onCancel} className="saro-btn saro-btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
