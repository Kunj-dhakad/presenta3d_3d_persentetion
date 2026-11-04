"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** The browser's speech recognition (Chrome, Edge, Safari); not in every browser's types. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Languages a command may be spoken in; the AI understands both. */
export const VOICE_LANGUAGES = [
  { id: "en-IN", label: "EN" },
  { id: "hi-IN", label: "हिं" },
] as const;
const LANG_KEY = "p3d_voice_lang";
const LANG_EVENT = "p3d-voice-lang";

/** Browser facts read without a setState in an effect: the server renders "unsupported" / English. */
const noSubscribe = () => () => {};
function subscribeLang(change: () => void) {
  window.addEventListener(LANG_EVENT, change);
  return () => window.removeEventListener(LANG_EVENT, change);
}
function savedLang(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && VOICE_LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return "en-IN";
}

/**
 * Speak a command instead of typing it (PRD 3): the words appear as they are
 * heard (onText), and the final sentence is handed over (onFinal) when the
 * speaker stops. Hidden in browsers without speech recognition.
 */
export function VoiceButton({ onText, onFinal, disabled, className }: { onText: (text: string) => void; onFinal: (text: string) => void; disabled?: boolean; className?: string }) {
  const supported = useSyncExternalStore(noSubscribe, () => recognitionCtor() !== null, () => false);
  const lang = useSyncExternalStore(subscribeLang, savedLang, () => "en-IN");
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");

  useEffect(() => () => rec.current?.stop(), []);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    heard.current = "";
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard.current = text.trim();
      onText(heard.current);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast.error("Allow the microphone for this site to use voice commands.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast.error("Voice input stopped. Please try again.");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (heard.current) onFinal(heard.current);
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  function chooseLang(id: string) {
    try {
      localStorage.setItem(LANG_KEY, id);
    } catch {
      /* not remembered: stays English */
    }
    window.dispatchEvent(new Event(LANG_EVENT));
  }

  if (!supported) return null;
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <span className="flex overflow-hidden rounded-md border border-border text-[10.5px]" role="group" aria-label="Voice language">
        {VOICE_LANGUAGES.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => chooseLang(l.id)}
            aria-pressed={lang === l.id}
            disabled={listening}
            className={cn("px-1.5 py-0.5 transition", lang === l.id ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {l.label}
          </button>
        ))}
      </span>
      <button
        type="button"
        onClick={() => (listening ? rec.current?.stop() : start())}
        disabled={disabled && !listening}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : "Speak a command"}
        title={listening ? "Listening… click to stop" : "Speak a command, e.g. “make the text bigger”"}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-40",
          listening && "animate-pulse border-destructive bg-destructive text-white hover:text-white",
        )}
      >
        {listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
      </button>
    </span>
  );
}
