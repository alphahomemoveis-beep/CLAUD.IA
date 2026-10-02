"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voz no navegador, sem chave nenhuma: reconhecimento de fala (Web Speech API,
 * pt-BR) para ditar o pedido e síntese de voz para ouvir a resposta.
 * Funciona no Chrome, Edge e Safari. No Firefox o botão avisa que não há suporte.
 */

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o uso do microfone no navegador para falar com a agenda.",
  "service-not-allowed": "O navegador bloqueou o reconhecimento de voz. Abra o app em HTTPS e permita o microfone.",
  "no-speech": "Não ouvi nada. Toque no microfone e fale de novo.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de voz precisa de internet.",
};

export function useVoice(opts: { onFinal: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  useEffect(() => {
    setSupported(!!recognitionCtor());
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Seu navegador não tem reconhecimento de voz. Use o Chrome, o Edge ou o Safari.");
      return;
    }
    window.speechSynthesis?.cancel();
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = "";
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim((finalRef.current + " " + live).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? `Erro no reconhecimento de voz (${e.error}).`);
    };
    rec.onend = () => {
      setListening(false);
      const text = finalRef.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { supported, listening, interim, error, clearError: () => setError(null), start, stop };
}

/** Lê um texto em voz alta com uma voz em português, se houver. */
export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = text.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/[*_`>]/g, "").trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "pt-BR";
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("pt-br"))
    ?? window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("pt"));
  if (voice) u.voice = voice;
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
