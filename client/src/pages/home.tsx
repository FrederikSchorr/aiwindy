import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Sailboat, Camera } from "lucide-react";
import type { ChatMessage, GeocodeResult } from "@shared/schema";

const COUNTRY_INFO: Record<string, { name: string }> = {
  HR: { name: "Kroatien" },
  DE: { name: "Deutschland" },
  AT: { name: "Österreich" },
  IT: { name: "Italien" },
  FR: { name: "Frankreich" },
  GR: { name: "Griechenland" },
  SI: { name: "Slowenien" },
  ME: { name: "Montenegro" },
  GB: { name: "Großbritannien" },
  NL: { name: "Niederlande" },
  ES: { name: "Spanien" },
  PT: { name: "Portugal" },
  TR: { name: "Türkei" },
  DK: { name: "Dänemark" },
  SE: { name: "Schweden" },
  NO: { name: "Norwegen" },
  PL: { name: "Polen" },
  CH: { name: "Schweiz" },
};

interface SectionMapConfig {
  lat?: number;
  lon?: number;
  overlay?: string;
  product?: string;
  level?: string;
  zoom?: number;
  forecast?: boolean;
}

interface SectionEvent {
  id: string;
  title: string;
  mapType: string;
  mapConfig: SectionMapConfig;
  sourceLabel: string | null;
  sourceUrl: string | null;
  regionalServiceLabel?: string | null;
  regionalServiceUrl?: string | null;
}

interface SSEPayload {
  location?: GeocodeResult;
  analysisStart?: { sections: SectionEvent[] };
  section?: SectionEvent;
  content?: string;
  error?: string;
  done?: boolean;
}

function WindyEmbed({ lat, lon, overlay, product, level, zoom, forecast }: {
  lat: number; lon: number; overlay: string; product: string; level: string; zoom: number; forecast?: boolean;
}) {
  const src = forecast
    ? `https://embed.windy.com/embed2.html?type=forecast&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=false&message=true&pressure=true&calendar=now`
    : `https://embed.windy.com/embed2.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}&marker=false&message=true&pressure=true&calendar=now`;

  return (
    <iframe
      title={`${overlay}-${product}`}
      src={src}
      className="w-full border-0 rounded-lg"
      style={{ height: forecast ? "420px" : "300px" }}
      frameBorder="0"
    />
  );
}

function SourceLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block text-sm text-muted-foreground hover:text-primary transition-colors mt-1 mb-0.5"
      data-testid="source-link"
    >
      Quelle: {label} ↗
    </a>
  );
}

function SectionCard({ section }: { section: SectionEvent }) {
  const { mapType, mapConfig, sourceLabel, sourceUrl } = section;

  return (
    <div className="my-3" data-testid={`section-card-${section.id}`}>

      {mapType === "windy" && mapConfig.lat != null && mapConfig.lon != null && (
        <WindyEmbed
          lat={mapConfig.lat}
          lon={mapConfig.lon}
          overlay={mapConfig.overlay || "wind"}
          product={mapConfig.product || "ecmwf"}
          level={mapConfig.level || "surface"}
          zoom={mapConfig.zoom || 8}
          forecast={mapConfig.forecast}
        />
      )}
      {mapType === "knmi" && (
        <img
          src="/api/knmi-chart"
          alt="KNMI Fronten-Analyse"
          className="w-full rounded-lg bg-white"
          data-testid="img-knmi-chart"
        />
      )}
      {sourceLabel && sourceUrl && (
        <SourceLink label={sourceLabel} url={sourceUrl} />
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const sanitizeUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return parsed.href;
    } catch {
      return "";
    }
  };

  const links: string[] = [];
  const withPlaceholders = content.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return escapeHtml(text);
    const idx = links.length;
    links.push(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:text-primary/80">${escapeHtml(text)}</a>`);
    return `%%LINK${idx}%%`;
  });

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const escaped = escape(withPlaceholders);
  const lines = escaped.split("\n");
  const parts: string[] = [];
  let inList = false;
  let inSubList = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("• ");
    const indent = line.length - line.trimStart().length;
    const isSubBullet = isBullet && indent >= 2;

    if (isBullet) {
      const text = trimmed.slice(2);
      if (isSubBullet) {
        if (!inSubList) {
          inSubList = true;
          parts.push('<ul class="ml-4 mt-0.5 mb-0.5 space-y-0">');
        }
        parts.push(`<li class="text-[15px] leading-snug text-muted-foreground pl-1" style="list-style:none">– ${text}</li>`);
      } else {
        if (inSubList) { inSubList = false; parts.push("</ul>"); }
        if (!inList) { inList = true; parts.push('<ul class="mt-0 mb-1.5 space-y-0.5">'); }
        parts.push(`<li class="text-[15px] leading-snug pl-1" style="list-style:disc;margin-left:1rem">${text}</li>`);
      }
    } else {
      if (inSubList) { inSubList = false; parts.push("</ul>"); }
      if (inList) { inList = false; parts.push("</ul>"); }

      let processed = trimmed
        .replace(/^### (.+)/, '<h3 class="text-sm font-semibold mt-2.5 mb-0.5">$1</h3>')
        .replace(/^## (.+)/, '<h2 class="text-base font-bold mt-3 mb-1">$1</h2>')
        .replace(/^# (.+)/, '<h1 class="text-lg font-bold mt-3 mb-1">$1</h1>');

      if (processed === trimmed && trimmed === "") {
        parts.push('<div class="h-1.5"></div>');
      } else if (processed === trimmed) {
        parts.push(`<p class="text-[15px] leading-snug">${processed}</p>`);
      } else {
        parts.push(processed);
      }
    }
  }
  if (inSubList) parts.push("</ul>");
  if (inList) parts.push("</ul>");

  let html = parts.join("")
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  links.forEach((link, i) => {
    html = html.replace(`%%LINK${i}%%`, link);
  });

  return <div className="text-[15px] leading-snug" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AnalysisContent({ content, sections, isStreaming, isLast }: {
  content: string;
  sections: SectionEvent[];
  isStreaming: boolean;
  isLast: boolean;
}) {
  const sectionRegex = /^##\s*(\d)[.):\s]/m;
  const parts = content.split(sectionRegex);

  const textBlocks: { num: number; heading: string; body: string }[] = [];
  const preamble = parts[0] || "";

  for (let i = 1; i < parts.length; i += 2) {
    const num = parseInt(parts[i], 10);
    const rawText = parts[i + 1] || "";
    const firstNewline = rawText.indexOf("\n");
    const titleLine = firstNewline >= 0 ? rawText.slice(0, firstNewline) : rawText;
    const body = firstNewline >= 0 ? rawText.slice(firstNewline) : "";
    textBlocks.push({ num, heading: `## ${num}.${titleLine}`, body });
  }

  const sectionMap = new Map<string, SectionEvent>();
  const sectionOrder = ["druck-luftmassen", "fronten", "wind", "wolken", "prognose", "warnung"];
  sections.forEach(s => sectionMap.set(s.id, s));

  return (
    <div>
      {preamble.trim() && <MarkdownContent content={preamble} />}
      {textBlocks.map((block) => {
        const sectionId = sectionOrder[block.num - 1];
        const sectionEvt = sectionId ? sectionMap.get(sectionId) : undefined;
        return (
          <div key={block.num} data-testid={`analysis-section-${block.num}`}>
            <MarkdownContent content={block.heading} />
            {sectionEvt && <SectionCard section={sectionEvt} />}
            {block.body.trim() && <MarkdownContent content={block.body} />}
          </div>
        );
      })}
      {isStreaming && isLast && (
        <span className="inline-flex items-center gap-0.5 ml-1 align-baseline">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      )}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Ahoi! Sage mir wo Du segelst ⛵, oder lade ein Wolken-Foto ☀️ hoch.",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLocation, setActiveLocation] = useState<GeocodeResult | null>(null);
  const [messageSections, setMessageSections] = useState<Record<string, SectionEvent[]>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploadHintAfterMsgId, setUploadHintAfterMsgId] = useState<string | null>(null);
  const uploadHintShownRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = useCallback((userMessage: string) => {
    setIsStreaming(true);
    const assistantId = `assistant-${Date.now()}`;
    let processed = 0;
    let lineBuffer = "";
    let isAnalyse = false;

    setMessages((prev) => [...prev, {
      id: assistantId,
      role: "assistant" as const,
      content: "",
    }]);

    const xhr = new XMLHttpRequest();
    abortRef.current = { abort: () => xhr.abort() } as AbortController;
    xhr.open("POST", "/api/chat");
    xhr.setRequestHeader("Content-Type", "application/json");

    const handleEvent = (data: SSEPayload) => {
      if (data.location) {
        setActiveLocation(data.location);
      }
      if (data.analysisStart?.sections) {
        const sections = data.analysisStart.sections;
        setMessageSections(prev => ({ ...prev, [assistantId]: sections }));
        isAnalyse = true;
      }
      if (data.section) {
        const sectionEvt = data.section;
        setMessageSections(prev => {
          const existing = prev[assistantId] || [];
          if (!existing.find(s => s.id === sectionEvt.id)) {
            return { ...prev, [assistantId]: [...existing, sectionEvt] };
          }
          return prev;
        });
      }
      if (data.content) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + data.content } : m
          )
        );
      }
      if (data.error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content ? { ...m, content: "Fehler bei der Verarbeitung. Bitte versuche es erneut." } : m
          )
        );
      }
    };

    const processChunk = () => {
      const text = xhr.responseText.slice(processed);
      processed = xhr.responseText.length;
      const combined = lineBuffer + text;
      const lines = combined.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            handleEvent(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    };

    xhr.onprogress = processChunk;
    xhr.onloadend = () => {
      lineBuffer += "\n";
      processChunk();
      setMessages((prev) => {
        const msg = prev.find(m => m.id === assistantId);
        if (msg && !msg.content) {
          return prev.filter(m => m.id !== assistantId);
        }
        return prev;
      });
      if (isAnalyse && !uploadHintShownRef.current) {
        uploadHintShownRef.current = true;
        setUploadHintAfterMsgId(assistantId);
      }
      setIsStreaming(false);
    };
    xhr.onerror = () => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Verbindungsfehler. Bitte versuche es erneut." } : m
        )
      );
      setIsStreaming(false);
    };

    const chatHistory = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));

    xhr.send(JSON.stringify({
      message: userMessage,
      history: chatHistory,
      currentLocation: activeLocation,
    }));
  }, [messages, activeLocation]);

  const handleFileUpload = useCallback((file: File) => {
    if (isStreaming) return;
    setIsStreaming(true);
    const assistantId = `assistant-${Date.now()}`;
    const isVideo = file.type.startsWith("video/");
    let processed = 0;
    let lineBuffer = "";

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: isVideo ? "📹 Video hochgeladen" : "📷 Foto hochgeladen" },
      { id: assistantId, role: "assistant" as const, content: "" },
    ]);

    const formData = new FormData();
    formData.append("photo", file);
    if (activeLocation) {
      formData.append("currentLocation", JSON.stringify(activeLocation));
    }

    const xhr = new XMLHttpRequest();
    abortRef.current = { abort: () => xhr.abort() } as AbortController;
    xhr.open("POST", "/api/upload");

    const processChunk = () => {
      const text = xhr.responseText.slice(processed);
      processed = xhr.responseText.length;
      const combined = lineBuffer + text;
      const lines = combined.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.location) {
              setActiveLocation(data.location as GeocodeResult);
            }
            if (data.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + data.content } : m
                )
              );
            }
            if (data.error) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && !m.content ? { ...m, content: "Fehler bei der Bildanalyse. Bitte versuche es erneut." } : m
                )
              );
            }
          } catch {}
        }
      }
    };

    xhr.onprogress = processChunk;
    xhr.onloadend = () => {
      lineBuffer += "\n";
      processChunk();
      setMessages((prev) => {
        const msg = prev.find(m => m.id === assistantId);
        if (msg && !msg.content) {
          return prev.filter(m => m.id !== assistantId);
        }
        return prev;
      });
      setIsStreaming(false);
    };
    xhr.onerror = () => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Verbindungsfehler. Bitte versuche es erneut." } : m
        )
      );
      setIsStreaming(false);
    };

    xhr.send(formData);
  }, [activeLocation, isStreaming]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    e.target.value = "";
  }, [handleFileUpload]);

  const lastSeenLengthRef = useRef(1);

  useEffect(() => {
    if (messages.length > lastSeenLengthRef.current) {
      lastSeenLengthRef.current = messages.length;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-message-id="${lastMsg.id}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: trimmed },
    ]);
    setInput("");
    sendMessage(trimmed);
  };

  return (
    <div className="flex flex-col h-dvh bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-2 flex items-center gap-2">
          <Sailboat className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-base font-semibold" data-testid="text-app-title">Segelwetter AI</h1>
          <div className="flex-1" />
          {activeLocation && (
            <span className="text-sm text-muted-foreground flex items-center gap-1.5 truncate max-w-[220px]" data-testid="text-active-location">
              📍 {activeLocation.displayName.split(",")[0]}
              {activeLocation.countryCode && COUNTRY_INFO[activeLocation.countryCode] && (
                <>
                  <img
                    src={`https://flagcdn.com/w20/${activeLocation.countryCode.toLowerCase()}.png`}
                    width={20}
                    height={14}
                    alt={activeLocation.countryCode}
                    className="inline-block rounded-[2px] shrink-0"
                  />
                  {COUNTRY_INFO[activeLocation.countryCode].name}
                </>
              )}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const msgSections = messageSections[msg.id] || [];
            const isLast = msg.id === messages[messages.length - 1]?.id;
            const hasAnalysis = msgSections.length > 0;
            const showUploadHint = msg.id === uploadHintAfterMsgId;

            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end" data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                  <div className="max-w-[75%]">
                    <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-normal bg-primary text-primary-foreground">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            }

            if (hasAnalysis) {
              return (
                <div key={msg.id} data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                  <div className="w-full">
                    <AnalysisContent
                      content={msg.content}
                      sections={msgSections}
                      isStreaming={isStreaming}
                      isLast={isLast}
                    />
                  </div>
                  {showUploadHint && !isStreaming && (
                    <div className="flex items-center gap-2 mt-3 text-[14px] text-muted-foreground italic" data-testid="text-upload-hint">
                      <Camera className="w-4 h-4 shrink-0" />
                      Lade ein aktuelles Wolken-Foto oder Video hoch für meteorologische Analyse.
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={msg.id} className="w-full" data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                {msg.content ? <MarkdownContent content={msg.content} /> : null}
                {isStreaming && isLast && msg.role === "assistant" && (
                  <span className="inline-flex items-center gap-0.5 ml-1 align-baseline">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border bg-card/50 backdrop-blur-sm shrink-0 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit} className="px-4 py-3 flex items-center gap-2">
            <input
              type="file"
              accept="image/*,video/*"
              ref={fileInputRef}
              onChange={onFileChange}
              className="hidden"
              data-testid="input-file"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              data-testid="button-upload"
              title="Foto/Video hochladen"
              className="shrink-0"
            >
              <Camera className="w-4 h-4" />
            </Button>
            <div className="relative flex-1">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ort, Frage oder Nachricht..."
                className="text-[15px]"
                disabled={isStreaming}
                data-testid="input-message"
              />
            </div>
            <Button type="submit" size="icon" disabled={!input.trim() || isStreaming} data-testid="button-send">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
