import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MessageCircleQuestion, Check, ChevronRight, Info, Filter,
  Sparkles, Send, X, CheckCircle2, MessageSquarePlus, RefreshCw, AlertCircle, Edit3
} from "lucide-react";
import {
  getAssistantLogs,
  resolveGapLogEntry,
  addKnowledgeBaseEntry,
  polishText,
} from "@saro/shared";

/**
 * Gap Log — unanswered assistant questions with Answer-Before-Resolve workflow.
 *
 * Resolving a gap requires an official published answer. Admins can draft an answer,
 * optionally use "Polish with AI" to generate clearer phrasing (which they review, edit,
 * or discard before publishing), and save to the grounded Knowledge Base.
 */

function timeAgo(iso) {
  if (!iso) return "—";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const CLUSTER_LABELS = {
  street_lighting: "Street Lighting",
  fees: "Fees & Payments",
  hotlines: "Hotlines & Contacts",
  accounts: "Accounts & Registration",
  sla_expectations: "Response Times & SLA",
  tracking: "Report Tracking",
  evacuation: "Evacuation & Shelters",
  infrastructure: "Infrastructure",
  flood: "Flooding",
};

function clusterLabel(raw) {
  if (!raw) return "Uncategorized";
  return CLUSTER_LABELS[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GapLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("unresolved"); // unresolved | all
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Answer Composer state
  const [composer, setComposer] = useState(null); // { type: 'single'|'cluster', id?, topic?, question?, questions? }
  const [draftAnswer, setDraftAnswer] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [isPolishing, setIsPolishing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await getAssistantLogs({ unresolvedOnly: false, limit: 300 });
      if (fetchErr) {
        setLogs(DEMO_GAP_LOG);
      } else if (data?.length) {
        setLogs(data);
      } else {
        setLogs(DEMO_GAP_LOG);
      }
    } catch {
      setLogs(DEMO_GAP_LOG);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filter logs by view mode
  const filteredLogs = useMemo(() => {
    return logs.filter((d) => filter === "all" || !d.resolved);
  }, [logs, filter]);

  // Group by topic_cluster
  const clustered = useMemo(() => {
    const map = new Map();
    for (const entry of filteredLogs) {
      const key = entry.topic_cluster || "__uncategorized__";
      if (!map.has(key)) {
        map.set(key, { topic: key, questions: [], count: 0, latest: entry.created_at, hasUnresolved: false });
      }
      const group = map.get(key);
      group.questions.push(entry);
      group.count++;
      if (entry.created_at > group.latest) group.latest = entry.created_at;
      if (!entry.resolved) group.hasUnresolved = true;
    }
    return [...map.values()].sort((a, b) => {
      if (a.hasUnresolved !== b.hasUnresolved) return a.hasUnresolved ? -1 : 1;
      return b.count - a.count;
    });
  }, [filteredLogs]);

  // Open single-entry answer composer
  const openSingleComposer = (entry) => {
    setComposer({
      type: "single",
      id: entry.id,
      question: entry.question,
      cluster: entry.topic_cluster,
    });
    setDraftAnswer(entry.official_answer || "");
    setAiSuggestion(null);
    setError("");
  };

  // Open cluster-level answer composer ("Resolve All")
  const openClusterComposer = (group) => {
    const unresolved = group.questions.filter((q) => !q.resolved);
    if (!unresolved.length) return;
    setComposer({
      type: "cluster",
      topic: group.topic,
      questions: unresolved,
      sampleQuestion: unresolved[0]?.question,
    });
    setDraftAnswer("");
    setAiSuggestion(null);
    setError("");
  };

  const closeComposer = () => {
    setComposer(null);
    setDraftAnswer("");
    setAiSuggestion(null);
    setIsPolishing(false);
  };

  // Polish draft with AI
  const handlePolish = async () => {
    if (!draftAnswer.trim()) return;
    setIsPolishing(true);
    setError("");
    const contextQuestion = composer?.type === "cluster" ? composer.sampleQuestion : composer?.question;
    const { polishedText, degraded } = await polishText(draftAnswer, contextQuestion);
    setIsPolishing(false);
    if (polishedText) {
      setAiSuggestion(polishedText);
    } else if (degraded) {
      setError("AI polishing unavailable right now. You can publish your original text.");
    }
  };

  // Submit Answer & Resolve
  const handleSubmitAnswer = async () => {
    const answer = draftAnswer.trim();
    if (!answer) {
      setError("Please write an answer before resolving.");
      return;
    }

    setBusy("submitting");
    setError("");

    try {
      if (composer.type === "single") {
        // Publish to Knowledge Base
        await addKnowledgeBaseEntry(composer.question, answer, composer.cluster);
        // Resolve Gap Log entry
        const { error: resErr } = await resolveGapLogEntry(composer.id, true, answer);
        if (resErr) throw new Error("Could not update gap log.");

        // Update local state
        setLogs((prev) =>
          prev.map((item) =>
            item.id === composer.id
              ? { ...item, resolved: true, was_answered: true, official_answer: answer, resolved_at: new Date().toISOString() }
              : item
          )
        );
      } else if (composer.type === "cluster") {
        // Publish KB entry for cluster
        await addKnowledgeBaseEntry(composer.sampleQuestion, answer, composer.topic);

        // Resolve each unresolved entry in cluster
        const targetIds = composer.questions.map((q) => q.id);
        for (const targetId of targetIds) {
          await resolveGapLogEntry(targetId, true, answer);
        }

        // Update local state
        setLogs((prev) =>
          prev.map((item) =>
            targetIds.includes(item.id)
              ? { ...item, resolved: true, was_answered: true, official_answer: answer, resolved_at: new Date().toISOString() }
              : item
          )
        );
      }

      closeComposer();
      // Refresh current selected group reference
      if (selected) {
        const updatedQuestions = selected.questions.map((q) =>
          (composer.type === "single" && q.id === composer.id) ||
          (composer.type === "cluster" && composer.questions.some((cq) => cq.id === q.id))
            ? { ...q, resolved: true, was_answered: true, official_answer: answer, resolved_at: new Date().toISOString() }
            : q
        );
        setSelected({ ...selected, questions: updatedQuestions, hasUnresolved: updatedQuestions.some((q) => !q.resolved) });
      }
    } catch {
      setError("Unable to save resolution answer. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const totalUnresolved = logs.filter((l) => !l.resolved).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="t-heading font-bold text-ink">Gap Log</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          Questions residents asked the AI assistant that it could not answer from published city
          documents. Answering and resolving a gap publishes official guidance so future residents get answered.
        </p>
      </div>

      {totalUnresolved > 0 && (
        <p className="t-body-sm flex items-start gap-2 border border-line bg-raised p-3 text-ink-muted rounded-md">
          <Info width={15} height={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          <span>
            <strong className="text-ink">{totalUnresolved} unanswered</strong> question{totalUnresolved === 1 ? "" : "s"} across{" "}
            {clustered.filter((c) => c.hasUnresolved).length} topic{clustered.filter((c) => c.hasUnresolved).length === 1 ? "" : "s"}.
            Write an official answer to resolve a question and update the city's AI knowledge base.
          </span>
        </p>
      )}

      {error && (
        <div role="alert" className="t-body-sm flex items-center gap-2 border border-alert bg-alert-wash p-3 text-alert rounded-md">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter toggle */}
      <div className="flex items-center gap-px border border-line bg-line rounded overflow-hidden self-start">
        {["unresolved", "all"].map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelected(null); closeComposer(); }}
            className="saro-btn saro-btn-sm capitalize font-bold"
            style={{
              background: filter === f ? "var(--color-brand)" : "var(--color-surface)",
              color: filter === f ? "#fff" : "var(--color-ink-muted)",
            }}
          >
            {f === "unresolved" ? "Unresolved Gaps" : "All Logged Questions"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Topic Table */}
        <div className="saro-card overflow-x-auto border border-line rounded-lg bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-raised border-b border-line">
                {["Topic Cluster", "Questions", "Last Asked", "Status", ""].map((h) => (
                  <th key={h} className="t-label px-3 py-2.5 text-left text-ink-faint font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clustered.map((group) => (
                <tr
                  key={group.topic}
                  onClick={() => { setSelected(group); closeComposer(); }}
                  aria-selected={selected?.topic === group.topic}
                  className="cursor-pointer border-t border-line aria-selected:bg-brand-wash hover:bg-raised transition-colors"
                >
                  <td className="t-body-sm px-3 py-3 font-bold text-ink">{clusterLabel(group.topic)}</td>
                  <td className="px-3 py-3">
                    <span className="t-data font-bold font-mono text-ink">{group.count}</span>
                  </td>
                  <td className="t-data-sm px-3 py-3 text-ink-muted">{timeAgo(group.latest)}</td>
                  <td className="px-3 py-3">
                    {group.hasUnresolved ? (
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                        Gap
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300">
                        Resolved
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ChevronRight width={16} height={16} className="text-ink-faint inline" aria-hidden="true" />
                  </td>
                </tr>
              ))}
              {!loading && clustered.length === 0 && (
                <tr>
                  <td colSpan={5} className="t-body-sm px-3 py-10 text-center text-ink-muted">
                    {filter === "unresolved"
                      ? "No unanswered questions right now. The knowledge base covers everything residents have asked."
                      : "No assistant questions logged yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail Panel & Answer Composer */}
        {selected && (
          <aside className="saro-clip saro-card self-start overflow-hidden border border-line bg-surface flex flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-line p-4 bg-raised">
              <div>
                <span className="t-label flex items-center gap-1.5 text-brand font-bold">
                  <MessageCircleQuestion width={14} height={14} aria-hidden="true" />
                  {clusterLabel(selected.topic)}
                </span>
                <p className="t-data-sm mt-0.5 text-ink-muted">
                  {selected.count} question{selected.count === 1 ? "" : "s"} in this cluster
                </p>
              </div>

              {selected.hasUnresolved && !composer && (
                <button
                  type="button"
                  onClick={() => openClusterComposer(selected)}
                  className="saro-btn saro-btn-primary saro-btn-sm flex items-center gap-1.5 font-bold text-xs"
                >
                  <MessageSquarePlus width={14} height={14} />
                  <span>Answer &amp; Resolve Cluster</span>
                </button>
              )}
            </header>

            {/* Inline Answer Composer Drawer */}
            {composer && (
              <div className="p-4 bg-amber-50/40 border-b border-amber-200 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5 text-brand" />
                    {composer.type === "cluster" ? "Answer Entire Cluster" : "Write Official Answer"}
                  </span>
                  <button onClick={closeComposer} className="text-ink-faint hover:text-ink">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {composer.type === "cluster" && (
                  <div className="p-2.5 rounded bg-surface border border-line text-xs flex flex-col gap-1">
                    <span className="font-bold text-ink-faint uppercase text-[10px]">Resolving {composer.questions.length} Questions:</span>
                    <ul className="list-disc pl-4 text-ink-muted space-y-0.5 text-[11px]">
                      {composer.questions.slice(0, 3).map((q) => (
                        <li key={q.id} className="truncate">{q.question}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-ink-muted">Official City Answer (Published to AI Knowledge Base):</span>
                  <textarea
                    rows={4}
                    value={draftAnswer}
                    onChange={(e) => setDraftAnswer(e.target.value)}
                    placeholder="Write the official response in your own words (e.g., 'Report damaged street lights via SARO under Infrastructure or contact City Engineering directly')."
                    className="saro-field w-full text-xs p-2.5 resize-none bg-surface"
                    autoFocus
                  />
                </label>

                {/* Polish with AI Button */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handlePolish}
                    disabled={isPolishing || !draftAnswer.trim()}
                    className="saro-btn saro-btn-secondary text-xs flex items-center gap-1.5 border-brand-edge text-brand hover:bg-brand-wash"
                  >
                    {isPolishing ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Polishing with AI…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5 text-amber-500" />Polish with AI</>
                    )}
                  </button>
                  <span className="text-[10px] text-ink-faint italic">Admin retains final review</span>
                </div>

                {/* AI Polished Suggestion Box */}
                {aiSuggestion && (
                  <div className="p-3 rounded-md bg-brand-wash border border-brand-edge flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-brand">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI Polished Suggestion:</span>
                    </div>
                    <p className="text-xs text-ink leading-relaxed bg-surface p-2 rounded border border-line">
                      "{aiSuggestion}"
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftAnswer(aiSuggestion);
                          setAiSuggestion(null);
                        }}
                        className="saro-btn saro-btn-primary text-xs py-1 px-2.5 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Accept &amp; Use Suggestion</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiSuggestion(null)}
                        className="saro-btn saro-btn-ghost text-xs py-1 px-2 text-ink-faint"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                )}

                {/* Submit & Cancel Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeComposer}
                    className="saro-btn saro-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitAnswer}
                    disabled={busy === "submitting" || !draftAnswer.trim()}
                    className="saro-btn saro-btn-primary text-xs flex items-center gap-1.5 font-bold"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{busy === "submitting" ? "Publishing…" : "Publish & Resolve"}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Questions List */}
            <ul className="flex flex-col max-h-[440px] overflow-y-auto divide-y divide-line">
              {selected.questions.map((entry) => (
                <li key={entry.id} className="p-3.5 flex flex-col gap-2 hover:bg-raised/40 transition-colors">
                  <p className="t-body-sm text-ink font-semibold leading-normal">{entry.question}</p>

                  {/* Published Answer Box if Resolved */}
                  {entry.resolved && entry.official_answer && (
                    <div className="p-2.5 rounded bg-emerald-50/60 border border-emerald-200 text-xs flex flex-col gap-1 mt-0.5">
                      <span className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Published Answer (Grounded AI KB):</span>
                      </span>
                      <p className="text-xs text-emerald-950 font-medium leading-relaxed">
                        "{entry.official_answer}"
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-1">
                    <span className="t-data-sm text-ink-faint">
                      {new Date(entry.created_at).toLocaleString("en-PH", {
                        dateStyle: "medium", timeStyle: "short",
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      {entry.resolved ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <Check className="w-3 h-3" />
                          <span>Resolved</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openSingleComposer(entry); }}
                          className="saro-btn saro-btn-secondary saro-btn-sm text-[11px] font-bold py-1 px-2.5 border-brand-edge text-brand hover:bg-brand-wash"
                        >
                          Answer &amp; Resolve
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="t-body-sm border-t border-line bg-raised p-3 text-ink-faint text-[11px]">
              Resolving a question publishes the written answer to the AI Knowledge Base so the grounded assistant can cite it for future resident inquiries.
            </footer>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ── Demo fallback data with valid UUIDs ─────────────────────────────────── */

const DEMO_GAP_LOG = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    question: "Saino kaya pwede mag-report nin sirang street light sa Rizal street?",
    was_answered: false,
    topic_cluster: "street_lighting",
    resolved: false,
    created_at: new Date(Date.now() - 48 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    question: "Paano mag-report ng sirang ilaw sa kalsada?",
    was_answered: false,
    topic_cluster: "street_lighting",
    resolved: false,
    created_at: new Date(Date.now() - 30 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    question: "Sirang street light sa may plaza, sino ang tatawagan?",
    was_answered: false,
    topic_cluster: "street_lighting",
    resolved: false,
    created_at: new Date(Date.now() - 12 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000004",
    question: "May bayad po ba ang pag-report ng baha?",
    was_answered: true,
    topic_cluster: "fees",
    resolved: true,
    official_answer: "Official Policy: Filing emergency or hazard reports in SARO is completely free of charge.",
    resolved_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 26 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000005",
    question: "Ano ang hotline ng CDRRMO?",
    was_answered: true,
    topic_cluster: "hotlines",
    resolved: true,
    official_answer: "Official Contact Directory: For CDRRMO Legazpi emergency operations, call Legazpi 911 immediately.",
    resolved_at: new Date(Date.now() - 18 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 20 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000006",
    question: "Pwede po ba mag-report kung wala akong account?",
    was_answered: true,
    topic_cluster: "accounts",
    resolved: true,
    official_answer: "Yes, SARO allows immediate guest reporting without requiring account creation.",
    resolved_at: new Date(Date.now() - 16 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 18 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000007",
    question: "Gaano katagal bago ma-resolve ang report sa lubak?",
    was_answered: false,
    topic_cluster: "sla_expectations",
    resolved: false,
    created_at: new Date(Date.now() - 8 * 3600000).toISOString()
  },
  {
    id: "00000000-0000-4000-a000-000000000008",
    question: "Saan ko makikita ang status ng report ko?",
    was_answered: true,
    topic_cluster: "tracking",
    resolved: true,
    official_answer: "Enter your 6-character tracking code on the SARO Track screen to view live status updates.",
    resolved_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 3 * 3600000).toISOString()
  },
];

