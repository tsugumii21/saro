import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send, AlertTriangle, PlusCircle, Phone, Bot, ArrowRight, Mic, MicOff,
  FileText, HelpCircle, CloudOff, PhoneCall, ShieldCheck, Sparkles, CornerDownLeft
} from "lucide-react";
import { askAssistant } from "@saro/shared";

const CATEGORIZED_PROMPTS = [
  {
    category: "Emergency & Hotlines",
    prompts: [
      { label: "CDRRMO Hotline", text: "What is the emergency hotline for CDRRMO?" },
      { label: "BFP Fire Station", text: "What is the hotline for the Bureau of Fire Protection?" },
    ],
  },
  {
    category: "Reporting & Tracking",
    prompts: [
      { label: "How to File Report", text: "How do I file a hazard report in SARO?" },
      { label: "Track Code Status", text: "How do I track my report with a tracking code?" },
    ],
  },
  {
    category: "Evacuation & Safety",
    prompts: [
      { label: "Evacuation Centers", text: "Where is the nearest evacuation center in Legazpi City?" },
      { label: "Gas Leak Protocols", text: "What safety measures should I take if I suspect a gas leak?" },
    ],
  },
];

const EMERGENCY_HOTLINES = [
  { name: "Legazpi 911 National Emergency", phone: "911", desc: "Life & safety emergency line" },
  { name: "CDRRMO Disaster Response", phone: "0524801911", desc: "(052) 480-1911 · 24/7 EOC Command" },
  { name: "BFP Legazpi Fire Station", phone: "0524801314", desc: "(052) 480-1314 · Fire & Rescue" },
  { name: "Legazpi City Police (PNP)", phone: "0524801234", desc: "(052) 480-1234 · Public Safety" },
];

/**
 * Desktop Assistant — Standardized 400px Left Panel + Flex-1 Chat Panel.
 *
 * Option 4A: Multi-line auto-expanding textarea with keyboard shortcuts (Enter to send, Shift+Enter for newline),
 * prominent alert callout banners for ungrounded/degraded bot answers, and categorized sidebar FAQs.
 */
export default function AssistantDesktop() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "bot",
      text: "I am the SARO AI Assistant for Legazpi City civic services. Ask about emergency hotlines, report procedures, or city offices. If it is an emergency, state what is happening and I will direct you immediately."
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechWarning, setSpeechWarning] = useState("");
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const msgSeq = useRef(0);
  const nextId = (role) => `${role}_${(msgSeq.current += 1)}`;

  const speechSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text) => {
    const question = text || input.trim();
    if (!question || loading) return;

    const userMsg = { id: nextId("user"), role: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const result = await askAssistant(question);

    const botMsg = {
      id: nextId("bot"),
      role: "bot",
      text: result.answer,
      isEmergency: result.isEmergency,
      matchedPhrase: result.matchedPhrase,
      source: result.source,
      matchedDocId: result.matchedDocId,
      unanswered: result.isFallback && !result.matchedDocId,
      degraded: result.degraded,
    };

    setMessages((prev) => [...prev, botMsg]);
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoiceRecording = (lang) => {
    setSpeechWarning("");
    if (!speechSupported) {
      setSpeechWarning("Voice dictation is not supported by your browser. Please type your query.");
      setTimeout(() => setSpeechWarning(""), 4000);
      return;
    }

    if (isRecording) {
      try {
        recognitionRef.current?.stop();
      } catch (err) {
        console.warn("Speech stop warning:", err);
      }
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang ?? "fil-PH";

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript + " ";
        }
      }
      if (finalChunk.trim()) {
        const textToAppend = finalChunk.trim();
        setInput((prev) => (prev ? `${prev} ${textToAppend}` : textToAppend));
      }
    };
    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      setIsRecording(false);
      if (event.error === "not-allowed") {
        setSpeechWarning("Microphone access denied. Please grant permission in browser settings.");
        setTimeout(() => setSpeechWarning(""), 4000);
      } else if (event.error === "language-not-supported") {
        toggleVoiceRecording("en-US");
      }
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Speech start error:", err);
      setIsRecording(false);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">
      {/* ── Left Guidance & Categorized FAQs (Standardized 400px) ─────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">SARO AI Assistant</h1>
          <p className="text-xs text-ink-faint mt-0.5">Legazpi City Civic Information &amp; Hotline Desk</p>
        </div>

        <div className="flex flex-col gap-4.5 p-5">
          {/* Categorized FAQs */}
          <div className="flex flex-col gap-3">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              Frequently Asked Questions
            </span>
            {CATEGORIZED_PROMPTS.map((cat, idx) => (
              <div key={idx} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-brand uppercase">{cat.category}</span>
                <div className="grid grid-cols-1 gap-1.5">
                  {cat.prompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(p.text)}
                      disabled={loading}
                      className="flex items-center justify-between p-2.5 rounded-md border border-line bg-surface hover:border-brand-edge hover:bg-brand-wash/40 text-left transition-all group shadow-2xs"
                    >
                      <span className="text-xs font-semibold text-ink group-hover:text-brand">
                        {p.label}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Emergency Hotlines Directory */}
          <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider flex items-center justify-between">
              <span>Emergency Hotlines</span>
              <span className="text-panic font-mono text-xs">24/7 EOC</span>
            </span>
            <div className="flex flex-col gap-1.5">
              {EMERGENCY_HOTLINES.map((h, i) => (
                <div key={i} className="p-3 rounded border border-line bg-raised flex items-center justify-between gap-2 shadow-2xs">
                  <div>
                    <span className="text-xs font-bold text-ink block leading-tight">{h.name}</span>
                    <span className="text-[11px] text-ink-muted leading-tight">{h.desc}</span>
                  </div>
                  <a
                    href={`tel:${h.phone}`}
                    className="saro-btn saro-btn-secondary saro-btn-sm text-xs py-1 px-2.5 shrink-0 flex items-center gap-1"
                  >
                    <PhoneCall className="w-3.5 h-3.5 text-brand" />
                    <span>Call</span>
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Grounded AI Disclosure */}
          <div className="p-3.5 rounded border border-brand-edge bg-brand-wash/40 text-xs text-ink-muted leading-relaxed flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold text-ink block">Verified City Knowledge</strong>
              Answers are cited directly from published Legazpi DRRM &amp; city office documents.
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right Panel: Desktop Chat Panel (flex-1) ─────────────────── */}
      <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden bg-canvas">
        {/* Right Chat Panel Header — Aligned with left sidebar header */}
        <div className="border-b border-line px-6 py-3.5 bg-surface flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-ink leading-tight">Conversation Thread</h2>
              <p className="text-xs text-ink-faint leading-tight">Civic Assistant Consultation</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Grounded &amp; Active
          </span>
        </div>

        {/* Scrollable Chat Thread */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-md px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-brand text-white shadow-2xs font-medium"
                    : "bg-white text-ink border border-line shadow-2xs"
                }`}
              >
                {msg.text}
              </div>

              {/* Prominent Alert Callout Banners for Degraded / Fallback Bot Responses */}
              {msg.role === "bot" && msg.id !== "welcome" && !msg.isEmergency && (
                <div className="mt-2 max-w-[75%]">
                  {msg.degraded ? (
                    <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2 shadow-2xs">
                      <CloudOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">Offline Fallback Answer</span>
                        <span>Could not connect to Legazpi document server. Standard emergency guidelines shown above.</span>
                      </div>
                    </div>
                  ) : msg.unanswered ? (
                    <div className="p-3 rounded-md bg-alert-wash border border-alert text-alert text-xs flex items-start gap-2 shadow-2xs">
                      <HelpCircle className="w-4 h-4 text-alert shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">Not in Published Documents</span>
                        <span>This query has been logged for CDRRMO staff review. For urgent help, call 911 or (052) 480-1911.</span>
                      </div>
                    </div>
                  ) : msg.source ? (
                    <div className="flex items-center gap-1.5 text-xs text-ink-muted font-medium bg-raised px-2.5 py-1 rounded border border-line w-fit">
                      <FileText className="w-3.5 h-3.5 text-brand shrink-0" />
                      <span>Source: <strong className="font-bold text-ink">{msg.source}</strong></span>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Emergency Hotline Alert Banner */}
              {msg.isEmergency && (
                <div className="max-w-[75%] mt-2 bg-alert-wash border-2 border-alert rounded-md p-4 text-xs space-y-2.5 shadow-md">
                  <div className="flex items-center gap-2 font-bold text-alert text-sm">
                    <AlertTriangle className="w-4.5 h-4.5 text-alert shrink-0" />
                    <span>EMERGENCY DETECTED ({msg.matchedPhrase})</span>
                  </div>
                  <p className="text-alert font-medium leading-normal">
                    If this is a real-time life emergency, call Legazpi 911 or CDRRMO immediately:
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href="tel:911"
                      className="flex-1 py-2.5 px-4 bg-alert hover:bg-alert text-white font-bold rounded text-center flex items-center justify-center gap-2 shadow-xs"
                    >
                      <Phone className="w-4 h-4" />
                      <span>Call 911</span>
                    </a>
                    <a
                      href="tel:0524801911"
                      className="flex-1 py-2.5 px-4 bg-white border border-alert text-alert hover:bg-alert-wash font-bold rounded text-center flex items-center justify-center"
                    >
                      (052) 480-1911
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-start">
              <div className="bg-white text-ink-muted border border-line rounded-md px-4 py-3 text-xs flex items-center gap-2 shadow-2xs">
                <Bot className="w-4 h-4 text-brand animate-pulse" />
                <span>Searching published Legazpi DRRM records…</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Option 4A Desktop Chat Input Bar */}
        <div className="border-t border-line bg-surface p-4 shrink-0 flex flex-col gap-2">
          {speechWarning && (
            <p className="text-xs font-bold text-alert bg-alert-wash p-2 rounded border border-alert">
              {speechWarning}
            </p>
          )}

          {isRecording && (
            <div className="text-xs font-bold text-alert bg-alert-wash border border-alert px-3 py-1.5 rounded-full flex items-center justify-between animate-pulse">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-alert animate-ping" />
                Listening... Speak now (Bikol / Tagalog / English)
              </span>
              <button
                type="button"
                onClick={toggleVoiceRecording}
                className="text-[10px] bg-alert text-white px-2 py-0.5 rounded font-extrabold"
              >
                Stop
              </button>
            </div>
          )}

          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={toggleVoiceRecording}
              className={`p-3 rounded-md border transition-all flex items-center justify-center shrink-0 ${
                isRecording
                  ? "bg-alert text-white border-alert animate-pulse shadow-md"
                  : "bg-sunken hover:bg-brand-wash text-ink-muted hover:text-brand border-line"
              }`}
              title="Voice Message / Dictation"
            >
              {isRecording ? <MicOff className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5" />}
            </button>

            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about emergency hotlines, flood zones, evacuation procedures..."
              className="flex-1 text-xs sm:text-sm py-2.5 px-4 rounded-md border border-line bg-raised text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:border-brand resize-none leading-relaxed"
              disabled={loading}
            />

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              className="saro-btn saro-btn-primary py-3 px-5 flex items-center justify-center gap-2 shrink-0 text-sm font-bold shadow-xs"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-faint px-1">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" />
              Press <strong className="font-bold text-ink">Enter</strong> to send · <strong className="font-bold text-ink">Shift + Enter</strong> for line break
            </span>
            <button
              type="button"
              onClick={() => navigate("/report")}
              className="text-brand font-bold hover:underline flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              File a Report Directly
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
