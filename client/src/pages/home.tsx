import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Cloud, Camera } from "lucide-react";
import type { ChatMessage, GeocodeResult } from "@shared/schema";

interface AnalysisConfig {
  locationName: string;
  lat: number;
  lon: number;
  regionalModel: string;
  regionalModelLabel: string;
  regionalModelZoom: number;
  knmiTime: string;
  regionalServiceLabel: string | null;
  regionalServiceUrl: string | null;
  warningServiceLabel: string | null;
  warningServiceUrl: string | null;
}

function WindyEmbed({ lat, lon, overlay, product, level, zoom, forecast }: {
  lat: number; lon: number; overlay: string; product: string; level: string; zoom: number; forecast?: boolean;
}) {
  const type = forecast ? "forecast" : "map";
  const src = `https://embed.windy.com/embed2.html?type=${type}&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=true&message=true&pressure=true&calendar=now`;

  return (
    <iframe
      title={`${overlay}-${product}`}
      src={src}
      className="w-full border-0 rounded-lg"
      style={{ height: "300px" }}
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
      className="inline-block text-xs text-muted-foreground hover:text-primary transition-colors mt-1 mb-2"
      data-testid="source-link"
    >
      Quelle: {label} ↗
    </a>
  );
}

function SectionMaps({ sectionNum, config }: { sectionNum: number; config: AnalysisConfig }) {
  switch (sectionNum) {
    case 1:
      return (
        <div className="my-3" data-testid="section-map-luftmassen">
          <WindyEmbed lat={51} lon={0} overlay="temp" product="ecmwf" level="850h" zoom={4} />
          <SourceLink
            label="Temperatur 1.500m ECMWF windy.com"
            url="https://www.windy.com/-temp-850h?ecmwf,51.000,0.000,4"
          />
        </div>
      );
    case 2:
      return (
        <div className="my-3" data-testid="section-map-fronten">
          <img
            src="/api/knmi-chart"
            alt="KNMI Fronten-Analyse"
            className="w-full rounded-lg bg-white"
            data-testid="img-knmi-chart"
          />
          <SourceLink
            label={`KNMI ${config.knmiTime}`}
            url="https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten"
          />
        </div>
      );
    case 3: {
      const windUrl = `https://www.windy.com/-wind-${config.regionalModel}?${config.regionalModel},${config.lat.toFixed(3)},${config.lon.toFixed(3)},${Math.min(config.regionalModelZoom + 2, 14)}`;
      return (
        <div className="my-3" data-testid="section-map-wind">
          {config.regionalServiceLabel && config.regionalServiceUrl && (
            <div className="text-xs text-muted-foreground mb-2">
              Regionaler Wetterdienst:{" "}
              <a href={config.regionalServiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {config.regionalServiceLabel} ↗
              </a>
            </div>
          )}
          <WindyEmbed
            lat={config.lat}
            lon={config.lon}
            overlay="wind"
            product={config.regionalModel}
            level="surface"
            zoom={config.regionalModelZoom}
          />
          <SourceLink
            label={`Wind ${config.locationName} ${config.regionalModelLabel} windy.com`}
            url={windUrl}
          />
        </div>
      );
    }
    case 4: {
      const cloudsUrl = `https://www.windy.com/-Wolken-clouds?${config.regionalModel},clouds,${config.lat.toFixed(3)},${config.lon.toFixed(3)},${config.regionalModelZoom}`;
      return (
        <div className="my-3" data-testid="section-map-wolken">
          <WindyEmbed
            lat={config.lat}
            lon={config.lon}
            overlay="clouds"
            product={config.regionalModel}
            level="surface"
            zoom={config.regionalModelZoom}
          />
          <SourceLink
            label={`Wolken & Regen ${config.locationName} ${config.regionalModelLabel} windy.com`}
            url={cloudsUrl}
          />
        </div>
      );
    }
    case 5: {
      const meteogramUrl = `https://www.windy.com/${config.lat.toFixed(3)}/${config.lon.toFixed(3)}/${config.regionalModel}/meteogram?${config.regionalModel},${config.lat.toFixed(3)},${config.lon.toFixed(3)},${config.regionalModelZoom}`;
      return (
        <div className="my-3" data-testid="section-map-prognose">
          <WindyEmbed
            lat={config.lat}
            lon={config.lon}
            overlay="wind"
            product={config.regionalModel}
            level="surface"
            zoom={config.regionalModelZoom}
            forecast={true}
          />
          <SourceLink
            label={`Meteogram ${config.locationName} ${config.regionalModelLabel} windy.com`}
            url={meteogramUrl}
          />
        </div>
      );
    }
    case 6:
      if (config.warningServiceLabel && config.warningServiceUrl) {
        return (
          <div className="my-2 text-xs text-muted-foreground" data-testid="section-warning-source">
            Warnquelle:{" "}
            <a href={config.warningServiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {config.warningServiceLabel} ↗
            </a>
          </div>
        );
      }
      return null;
    default:
      return null;
  }
}

function MarkdownContent({ content }: { content: string }) {
  const links: string[] = [];
  const withPlaceholders = content.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) => {
    const idx = links.length;
    links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:text-primary/80">${text}</a>`);
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
        parts.push(`<li class="text-[13px] leading-snug text-muted-foreground pl-1" style="list-style:none">– ${text}</li>`);
      } else {
        if (inSubList) { inSubList = false; parts.push("</ul>"); }
        if (!inList) { inList = true; parts.push('<ul class="mt-1 mb-1.5 space-y-0.5">'); }
        parts.push(`<li class="text-[13px] leading-snug pl-1" style="list-style:disc;margin-left:1rem">${text}</li>`);
      }
    } else {
      if (inSubList) { inSubList = false; parts.push("</ul>"); }
      if (inList) { inList = false; parts.push("</ul>"); }

      let processed = trimmed
        .replace(/^### (.+)/, '<h3 class="text-[13px] font-semibold mt-2.5 mb-0.5">$1</h3>')
        .replace(/^## (.+)/, '<h2 class="text-sm font-bold mt-3 mb-1">$1</h2>')
        .replace(/^# (.+)/, '<h1 class="text-base font-bold mt-3 mb-1">$1</h1>');

      if (processed === trimmed && trimmed === "") {
        parts.push('<div class="h-1.5"></div>');
      } else if (processed === trimmed) {
        parts.push(`<p class="text-[13px] leading-snug">${processed}</p>`);
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

  return <div className="text-[13px] leading-snug" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AnalysisContent({ content, config, isStreaming, isLast }: {
  content: string;
  config: AnalysisConfig;
  isStreaming: boolean;
  isLast: boolean;
}) {
  const sectionRegex = /^##\s*(\d)[.):\s]/m;
  const parts = content.split(sectionRegex);

  const sections: { num: number; text: string }[] = [];
  let preamble = parts[0] || "";

  for (let i = 1; i < parts.length; i += 2) {
    const num = parseInt(parts[i], 10);
    const rawText = parts[i + 1] || "";
    const firstNewline = rawText.indexOf("\n");
    const titleLine = firstNewline >= 0 ? rawText.slice(0, firstNewline) : rawText;
    const restText = firstNewline >= 0 ? rawText.slice(firstNewline) : "";
    sections.push({ num, text: `## ${num}.${titleLine}${restText}` });
  }

  return (
    <div>
      {preamble.trim() && <MarkdownContent content={preamble} />}
      {sections.map((section, idx) => (
        <div key={section.num}>
          <SectionMaps sectionNum={section.num} config={config} />
          <MarkdownContent content={section.text} />
        </div>
      ))}
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
      content: "Hallo! Ich bin dein Segelwetter-Assistent. Du kannst mich alles rund um Wetter, Wind und Segeln fragen.\n\nFür eine **Segelwetteranalyse** nenne einfach einen Ort — z.B. \"Punat\", \"Gardasee\" oder \"Segeln bei Rovinj\".",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLocation, setActiveLocation] = useState<GeocodeResult | null>(null);
  const [analysisConfigs, setAnalysisConfigs] = useState<Record<string, AnalysisConfig>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = useCallback((userMessage: string) => {
    setIsStreaming(true);
    const assistantId = `assistant-${Date.now()}`;
    let currentAnalysisConfig: AnalysisConfig | null = null;
    let processed = 0;
    let lineBuffer = "";

    setMessages((prev) => [...prev, {
      id: assistantId,
      role: "assistant" as const,
      content: "",
    }]);

    const xhr = new XMLHttpRequest();
    abortRef.current = { abort: () => xhr.abort() } as AbortController;
    xhr.open("POST", "/api/chat");
    xhr.setRequestHeader("Content-Type", "application/json");

    const handleEvent = (data: any) => {
      if (data.location) {
        setActiveLocation(data.location as GeocodeResult);
      }
      if (data.analysisStart) {
        currentAnalysisConfig = {
          locationName: data.locationName,
          lat: data.lat,
          lon: data.lon,
          regionalModel: data.regionalModel,
          regionalModelLabel: data.regionalModelLabel,
          regionalModelZoom: data.regionalModelZoom,
          knmiTime: data.knmiTime,
          regionalServiceLabel: data.regionalServiceLabel,
          regionalServiceUrl: data.regionalServiceUrl,
          warningServiceLabel: data.warningServiceLabel,
          warningServiceUrl: data.warningServiceUrl,
        };
        setAnalysisConfigs(prev => ({ ...prev, [assistantId]: currentAnalysisConfig! }));
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
            <Cloud className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold" data-testid="text-app-title">Segelwetter</h1>
            <p className="text-xs text-muted-foreground">AI-Meteorologe</p>
          </div>
          {activeLocation && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px]" data-testid="text-active-location">
              📍 {activeLocation.displayName.split(",")[0]}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const msgAnalysisConfig = analysisConfigs[msg.id];
            const isLast = msg.id === messages[messages.length - 1]?.id;

            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end" data-testid={`message-${msg.id}`}>
                  <div className="max-w-[75%]">
                    <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-normal bg-primary text-primary-foreground">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            }

            if (msgAnalysisConfig) {
              return (
                <div key={msg.id} className="w-full" data-testid={`message-${msg.id}`}>
                  <AnalysisContent
                    content={msg.content}
                    config={msgAnalysisConfig}
                    isStreaming={isStreaming}
                    isLast={isLast}
                  />
                </div>
              );
            }

            return (
              <div key={msg.id} className="w-full" data-testid={`message-${msg.id}`}>
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
