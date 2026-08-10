import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send, AlertTriangle, PlusCircle, Phone, Bot, ArrowRight, Mic, MicOff,
  FileText, HelpCircle, CloudOff,
} from "lucide-react";
import { askAssistant } from "@saro/shared";

// The device id used to be minted here for rate limiting. The shared client
// owns that now — one place that knows what a device id is, rather than four
// copies of the same eight lines drifting apart.

// Quick prompt chips — query text must match label language
const QUICK_PROMPTS = [
  { label: "CDRRMO hotline?", text: "What is the emergency hotline for CDRRMO?" },
  { label: "How to report?", text: "How do I file a hazard report in SARO?" },
  { label: "Track my report", text: "How do I track my report with a tracking code?" },
  { label: "Evacuation center?", text: "Where is the nearest evacuation center in Legazpi City?" },
  { label: "BFP fire hotline?", text: "What is the hotline for the Bureau of Fire Protection?" },
  { label: "What is SARO?", text: "What is the SARO app and how does it work?" },
  { label: "Coast Guard hours?", text: "What are the operating hours for the Coast Guard station?" },
  { label: "Gas leak safety?", text: "What safety measures should I take if I suspect a gas leak?" }
];

export default function AssistantScreen() {
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
  const [canScrollRight, setCanScrollRight] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const chipsRef = useRef(null);
  const recognitionRef = useRef(null);
  const msgSeq = useRef(0);
  const nextId = (role) => `${role}_${(msgSeq.current += 1)}`;

  const checkChipsScroll = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const hasMore = el.scrollWidth > el.clientWidth + el.scrollLeft + 6;
    setCanScrollRight(hasMore);
  }, []);

  useEffect(() => {
    checkChipsScroll();
    const el = chipsRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkChipsScroll, { passive: true });
    window.addEventListener("resize", checkChipsScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", checkChipsScroll);
      window.removeEventListener("resize", checkChipsScroll);
    };
  }, [checkChipsScroll]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text) => {
    const question = text || input.trim();
    if (!question || loading) return;

    const userMsg = { id: nextId('user'), role: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // One client, shared with the Describe flow. The Edge Function holds the
    // Gemini key, runs the emergency tripwire, answers only from the city's
    // published documents, and writes every unanswered question to gap_log
    // itself — there is no separate analytics call, and the client has no way
    // to suppress the logging.
    const result = await askAssistant(question);

    const botMsg = {
      id: nextId('bot'),
      role: "bot",
      text: result.answer,
      isEmergency: result.isEmergency,
      matchedPhrase: result.matchedPhrase,
      // Which published document the answer came from. Null means the
      // assistant had nothing to stand on and said so rather than inventing
      // something — that distinction is shown, not hidden.
      source: result.source,
      matchedDocId: result.matchedDocId,
      unanswered: result.isFallback && !result.matchedDocId,
      degraded: result.degraded,
    };

    setMessages((prev) => [...prev, botMsg]);
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  // Voice Message / Dictation Handler
  const toggleVoiceRecording = () => {
    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "fil-PH"; // Bikol / Tagalog / English support

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsRecording(false);
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    }
    // No fallback. The old one faked dictation: after 1.5s it typed
    // "Ano ang emergency hotline ng CDRRMO?" into the box as though the person
    // had said it. On a browser without speech recognition that put words in
    // somebody's mouth and then answered them. The mic button is simply hidden
    // where the API is missing.
  };

  return (
    <div className="flex flex-col h-full bg-canvas font-sans">

      {/* Scrollable Message List */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 min-h-0 ${messages.length === 1 ? "flex flex-col justify-center" : ""}`}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div className={`flex items-start gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              {msg.role === "bot" && (
                <div className="w-6 h-6 rounded-full bg-brand-wash border border-brand-edge flex items-center justify-center text-brand shrink-0 mt-0.5" aria-hidden="true">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`rounded-xs px-4 py-3 text-xs sm:text-sm leading-relaxed ${msg.role === "user"
                  ? "bg-brand text-white rounded-br-none shadow-xs font-medium"
                  : "bg-white text-ink border border-line rounded-bl-none shadow-xs"
                  }`}
              >
                {msg.text}
              </div>
            </div>

            {/* Where the answer came from.
             *
             * A grounded assistant that does not show its grounding is just an
             * assistant. Every answer is one of three things and each looks
             * different: cited from a named city document, an honest refusal,
             * or the service being unreachable. Nothing in between, and never
             * an authoritative-sounding sentence with nothing behind it. */}
            {msg.role === "bot" && msg.id !== "welcome" && !msg.isEmergency && (
              <div className="mt-1.5 max-w-[85%]">
                {msg.degraded ? (
                  <div className="p-2.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2 shadow-2xs">
                    <CloudOff className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Offline Fallback</span>
                      <span>Could not connect to Legazpi document server.</span>
                    </div>
                  </div>
                ) : msg.unanswered ? (
                  <div className="p-2.5 rounded-md bg-alert-wash border border-alert text-alert text-xs flex items-start gap-2 shadow-2xs">
                    <HelpCircle className="w-3.5 h-3.5 text-alert shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Not in Published Documents</span>
                      <span>Logged for staff review. Urgent? Call 911.</span>
                    </div>
                  </div>
                ) : msg.source ? (
                  <div className="flex items-center gap-1.5 text-xs text-ink-muted font-medium bg-raised px-2.5 py-1 rounded border border-line w-fit shadow-2xs">
                    <FileText className="w-3.5 h-3.5 text-brand shrink-0" />
                    <span>Source: <strong className="font-bold text-ink">{msg.source}</strong></span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Emergency Hotline Alert overlay for active distress */}
            {msg.isEmergency && (
              <div className="max-w-[85%] mt-2 bg-alert-wash border-2 border-alert rounded-xs p-3 text-xs space-y-2 shadow-md">
                <div className="flex items-center gap-1.5 font-bold text-alert">
                  <AlertTriangle className="w-4 h-4 text-alert shrink-0" />
                  <span>EMERGENCY DETECTED ({msg.matchedPhrase})</span>
                </div>
                <p className="text-alert t-label font-medium leading-normal">
                  If this is a real-time life emergency, call Legazpi 911 or CDRRMO directly:
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <a
                    href="tel:911"
                    className="flex-1 py-2 px-3 bg-alert hover:bg-alert text-white font-bold rounded-xs text-center flex items-center justify-center gap-1 min-h-[36px] shadow-xs"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call 911
                  </a>
                  <a
                    href="tel:0524801911"
                    className="flex-1 py-2 px-3 bg-white border border-alert text-alert hover:bg-alert-wash font-bold rounded-xs text-center min-h-[36px] flex items-center justify-center"
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
            <div className="bg-white text-ink-muted border border-line rounded-xs rounded-bl-none px-4 py-3 text-xs flex items-center gap-2 shadow-xs">
              <Bot className="w-4 h-4 text-brand animate-pulse" />
              <span>SARO AI is thinking...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Quick Prompt Chips (Shown on initial load, auto-collapses once conversation starts) */}
      {messages.length <= 1 && (
        <div className="border-t border-line bg-white/80 backdrop-blur px-3 py-2 shrink-0 w-full max-w-full overflow-hidden transition-all duration-300">
          <div className="relative w-full overflow-hidden">
            {canScrollRight && (
              <div
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-white via-white/80 to-transparent z-10"
                aria-hidden="true"
              />
            )}
            <div
              ref={chipsRef}
              className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar w-full touch-pan-x"
            >
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt.text)}
                  disabled={loading}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-line t-label font-semibold text-ink hover:border-brand/40 hover:bg-brand-wash active:bg-brand-wash transition-colors whitespace-nowrap disabled:opacity-50 min-h-[32px]"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input Bar with Voice Message Icon Button */}
      <div className="border-t border-line bg-white px-3.5 py-2.5 shrink-0">

        {/* Pulsing Voice Recording Indicator */}
        {isRecording && (
          <div className="mb-2 t-label font-bold text-alert bg-alert-wash border border-alert px-3 py-1 rounded-full flex items-center justify-between animate-pulse">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-alert animate-ping" />
              Listening... Speak now (Bikol / Tagalog / English)
            </span>
            <button
              onClick={toggleVoiceRecording}
              className="t-micro bg-alert text-alert px-2 py-0.5 rounded uppercase font-extrabold"
            >
              Stop
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">

          {/* Voice Message Microphone Button */}
          <button
            type="button"
            onClick={toggleVoiceRecording}
            className={`p-2.5 rounded-xs border transition-all min-w-[44px] min-h-[44px] flex items-center justify-center ${isRecording
              ? "bg-alert text-white border-alert animate-pulse shadow-md"
              : "bg-sunken hover:bg-brand-wash text-ink-muted hover:text-brand border-line hover:border-brand-edge"
              }`}
            title={isRecording ? "Stop recording" : "Voice Message / Dictation"}
            aria-label="Voice Message"
          >
            {isRecording ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          {/* Text Input */}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRecording ? "Listening to your voice..." : "Ask about city services..."}
            className="flex-1 text-xs sm:text-sm py-2.5 px-3.5 rounded-xs border border-line bg-raised text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:border-brand"
            disabled={loading}
            aria-label="Ask a question"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-brand text-white rounded-xs active:bg-brand-mid disabled:opacity-40 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Standing CTA */}
        <button
          onClick={() => navigate("/report")}
          className="w-full mt-2 flex items-center justify-center gap-1.5 t-label text-brand font-semibold hover:underline py-0.5"
        >
          <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Or file a report directly
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
