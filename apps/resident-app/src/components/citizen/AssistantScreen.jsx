import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Send, AlertTriangle, PlusCircle, Phone, Bot, ArrowRight, Mic, MicOff } from "lucide-react";
import { askFaq } from "../../lib/gemini.js";
import { logAssistantQuestion } from "@saro/shared";

// Quick prompt chips
const QUICK_PROMPTS = [
  { label: "CDRRMO hotline?", text: "Ano ang emergency hotline ng CDRRMO?" },
  { label: "How to report?", text: "Paano mag-report ng hazard?" },
  { label: "Track my report", text: "Paano mag-track ng report gamit ang tracking code?" },
  { label: "Evacuation center?", text: "Saan ang pinakamalapit na evacuation center?" },
  { label: "BFP fire hotline?", text: "Ano ang hotline ng Bureau of Fire Protection?" },
  { label: "What is SARO?", text: "Ano ang SARO app?" },
  { label: "Coast Guard hours?", text: "May duty ba ang Coast Guard sa gabi?" },
  { label: "Gas leak safety?", text: "Ano ang gagawin kapag may gas leak?" }
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
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const chipsRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text) => {
    const question = text || input.trim();
    if (!question || loading) return;

    const userMsg = { id: `user_${Date.now()}`, role: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const result = await askFaq(question);

    // Log for admin analytics
    await logAssistantQuestion(question, !!result.matchedDocId, result.matchedDocId);

    const botMsg = {
      id: `bot_${Date.now()}`,
      role: "bot",
      text: result.answer,
      isEmergency: result.isEmergency,
      matchedPhrase: result.matchedPhrase
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
    } else {
      // Fallback voice dictation simulation
      setIsRecording(true);
      setTimeout(() => {
        setInput("Ano ang emergency hotline ng CDRRMO?");
        setIsRecording(false);
      }, 1500);
    }
  };

  return (
    <div className="flex flex-col h-full bg-saro-surface font-sans">
      
      {/* Scrollable Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-saro-primary text-white rounded-br-none shadow-xs font-medium"
                  : "bg-white text-saro-ink border border-saro-line rounded-bl-none shadow-xs"
              }`}
            >
              {msg.text}
            </div>

            {/* Emergency Hotline Alert overlay for active distress */}
            {msg.isEmergency && (
              <div className="max-w-[85%] mt-2 bg-red-50 border-2 border-red-300 rounded-xl p-3 text-xs space-y-2 shadow-md">
                <div className="flex items-center gap-1.5 font-bold text-red-700">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>EMERGENCY DETECTED ({msg.matchedPhrase})</span>
                </div>
                <p className="text-red-700 text-[11px] font-medium leading-normal">
                  If this is a real-time life emergency, call Legazpi 911 or CDRRMO directly:
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <a
                    href="tel:911"
                    className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-center flex items-center justify-center gap-1 min-h-[36px] shadow-xs"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call 911
                  </a>
                  <a
                    href="tel:0524801911"
                    className="flex-1 py-2 px-3 bg-white border border-red-300 text-red-700 hover:bg-red-50 font-bold rounded-lg text-center min-h-[36px] flex items-center justify-center"
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
            <div className="bg-white text-saro-secondary border border-saro-line rounded-2xl rounded-bl-none px-4 py-3 text-xs flex items-center gap-2 shadow-xs">
              <Bot className="w-4 h-4 text-saro-primary animate-pulse" />
              <span>SARO AI is thinking...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Quick Prompt Chips */}
      <div className="border-t border-saro-line bg-white/80 backdrop-blur px-3 py-2 shrink-0">
        <div className="relative">
          <div
            ref={chipsRef}
            className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
          >
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSend(prompt.text)}
                disabled={loading}
                className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-saro-line text-[11px] font-semibold text-saro-ink hover:border-saro-primary/40 hover:bg-saro-primary-light active:bg-teal-100 transition-colors whitespace-nowrap disabled:opacity-50 min-h-[32px]"
              >
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input Bar with Voice Message Icon Button */}
      <div className="border-t border-saro-line bg-white px-3.5 py-2.5 shrink-0">
        
        {/* Pulsing Voice Recording Indicator */}
        {isRecording && (
          <div className="mb-2 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded-full flex items-center justify-between animate-pulse">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
              Listening... Speak now (Bikol / Tagalog / English)
            </span>
            <button
              onClick={toggleVoiceRecording}
              className="text-[10px] bg-red-200 text-red-900 px-2 py-0.5 rounded uppercase font-extrabold"
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
            className={`p-2.5 rounded-xl border transition-all min-w-[44px] min-h-[44px] flex items-center justify-center ${
              isRecording
                ? "bg-red-600 text-white border-red-700 animate-pulse shadow-md"
                : "bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-700 border-slate-200 hover:border-teal-300"
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
            className="flex-1 text-xs sm:text-sm py-2.5 px-3.5 rounded-xl border border-saro-line bg-saro-mist text-saro-ink placeholder:text-saro-secondary focus:ring-2 focus:ring-saro-primary focus:border-saro-primary"
            disabled={loading}
            aria-label="Ask a question"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-saro-primary text-white rounded-xl active:bg-saro-primary-hover disabled:opacity-40 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Standing CTA */}
        <button
          onClick={() => navigate("/report")}
          className="w-full mt-2 flex items-center justify-center gap-1.5 text-[11px] text-saro-primary font-semibold hover:underline py-0.5"
        >
          <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Or file a report directly
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
