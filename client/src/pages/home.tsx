import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MapPin, Cloud, Wind, Thermometer, Loader2, Map, Navigation, AlertTriangle, ExternalLink } from "lucide-react";
import type { ChatMessage, GeocodeResult, ForecastData, ForecastHour } from "@shared/schema";

function WindyEmbed({ lat, lon, overlay, product, level, zoom, forecast }: {
  lat: number; lon: number; overlay: string; product: string; level: string; zoom: number; forecast?: boolean;
}) {
  const type = forecast ? "forecast" : "map";
  const src = `https://embed.windy.com/embed2.html?type=${type}&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=true&message=true&pressure=true&calendar=now`;

  return (
    <iframe
      title={`${overlay}-${product}`}
      src={src}
      className="w-full h-full border-0"
      frameBorder="0"
    />
  );
}

function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 57) return "🌧️";
  if (code <= 65) return "🌧️";
  if (code <= 67) return "🌨️";
  if (code <= 75) return "❄️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "❄️";
  if (code <= 99) return "⛈️";
  return "❓";
}

function windDirArrow(deg: number): string {
  const arrows = ["↓", "↙", "←", "↖", "↑", "↗", "→", "↘"];
  return arrows[Math.round(deg / 45) % 8];
}

function windColor(kt: number): string {
  if (kt < 5) return "text-gray-400";
  if (kt < 10) return "text-green-500";
  if (kt < 15) return "text-yellow-500";
  if (kt < 20) return "text-orange-500";
  if (kt < 25) return "text-red-500";
  return "text-red-700 font-bold";
}

function gustColor(kt: number): string {
  if (kt < 10) return "text-gray-400";
  if (kt < 15) return "text-yellow-500";
  if (kt < 20) return "text-orange-500";
  if (kt < 25) return "text-red-500";
  return "text-red-700 font-bold";
}

function ForecastStrip({ lat, lon }: { lat: number; lon: number }) {
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/forecast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lon }),
        });
        if (res.ok && !cancelled) {
          setForecast(await res.json());
        }
      } catch {}
    }
    load();
    return () => { cancelled = true; };
  }, [lat, lon]);

  if (!forecast) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Vorhersage laden...
      </div>
    );
  }

  const dayGroups: { label: string; hours: (ForecastHour & { h: number })[] }[] = [];
  const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  let currentDay = "";

  for (const hour of forecast.hours) {
    const d = new Date(hour.time);
    const dayKey = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric" });
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      dayGroups.push({ label: `${dayNames[d.getDay()]} ${d.getDate()}.`, hours: [] });
    }
    dayGroups[dayGroups.length - 1].hours.push({ ...hour, h: d.getHours() });
  }

  return (
    <div className="border-t border-border bg-card" data-testid="forecast-strip">
      <div className="overflow-x-auto" ref={scrollRef}>
        <div className="inline-flex min-w-full">
          <div className="sticky left-0 z-10 bg-card border-r border-border shrink-0 text-[10px]">
            <div className="h-5 px-1.5 flex items-center font-medium text-muted-foreground border-b border-border/50">Stunden</div>
            <div className="h-5 px-1.5 flex items-center border-b border-border/50"></div>
            <div className="h-5 px-1.5 flex items-center text-muted-foreground border-b border-border/50">Temp °C</div>
            <div className="h-5 px-1.5 flex items-center text-muted-foreground border-b border-border/50">Regen mm</div>
            <div className="h-5 px-1.5 flex items-center text-muted-foreground border-b border-border/50">Wind kt</div>
            <div className="h-5 px-1.5 flex items-center text-muted-foreground border-b border-border/50">Böen kt</div>
            <div className="h-5 px-1.5 flex items-center text-muted-foreground">Richtung</div>
          </div>

          {dayGroups.map((day) => (
            <div key={day.label} className="border-r border-border/30">
              <div className="text-[10px] font-medium text-center px-1 h-5 flex items-center justify-center bg-muted/50 border-b border-border/50 whitespace-nowrap" style={{ gridColumn: `span ${day.hours.length}` }}>
                {day.label}
              </div>
              <div className="flex">
                {day.hours.filter((_, i) => i % 3 === 0).map((h) => (
                  <div key={h.time} className="flex flex-col items-center" style={{ minWidth: "28px" }}>
                    <div className="h-5 text-[10px] text-muted-foreground flex items-center border-b border-border/50">{h.h}</div>
                    <div className="h-5 text-[11px] flex items-center border-b border-border/50">{weatherIcon(h.weatherCode)}</div>
                    <div className="h-5 text-[10px] flex items-center border-b border-border/50">{Math.round(h.temp)}°</div>
                    <div className="h-5 text-[10px] flex items-center border-b border-border/50">
                      {h.rain > 0 ? <span className="text-blue-500">{h.rain.toFixed(1)}</span> : <span className="text-gray-300">-</span>}
                    </div>
                    <div className={`h-5 text-[10px] flex items-center border-b border-border/50 ${windColor(h.windSpeed)}`}>{h.windSpeed}</div>
                    <div className={`h-5 text-[10px] flex items-center border-b border-border/50 ${gustColor(h.windGusts)}`}>{h.windGusts}</div>
                    <div className="h-5 text-[10px] flex items-center text-muted-foreground">{windDirArrow(h.windDir)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = escape(content)
    .replace(/### (.+)/g, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
    .replace(/## (.+)/g, '<h2 class="text-sm font-bold mt-4 mb-1.5">$1</h2>')
    .replace(/# (.+)/g, '<h1 class="text-base font-bold mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n- /g, '\n<li class="ml-4 list-disc text-sm">')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  return <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hallo! Frag mich nach dem Wetter an einem beliebigen Ort und ich zeige dir die aktuelle Wetterlage mit Analyse speziell für Segler. Probiere z.B. \"Wie ist das Wetter in Punat?\", \"Elba\" oder \"Segeln bei Rovinj\".",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLocation, setActiveLocation] = useState<GeocodeResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (userMessage: string) => {
    setIsStreaming(true);
    const statusId = `status-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: statusId, role: "assistant", content: "" }]);
    let contentStarted = false;

    try {
      abortRef.current = new AbortController();
      const chatHistory = messages
        .filter((m) => m.id !== "welcome" && !m.id.startsWith("status-"))
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history: chatHistory,
          currentLocation: activeLocation,
        }),
        signal: abortRef.current.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.location) {
                setActiveLocation(data.location as GeocodeResult);
              }
              if (data.status) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === statusId ? { ...m, content: data.status } : m
                  )
                );
              }
              if (data.content) {
                if (!contentStarted) {
                  contentStarted = true;
                  setMessages((prev) => [...prev, { id: assistantId, role: "assistant" as const, content: data.content }]);
                } else {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: m.content + data.content } : m
                    )
                  );
                }
              }
              if (data.error) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === statusId ? { ...m, content: "Fehler bei der Wetteranalyse. Bitte versuche es erneut." } : m
                  )
                );
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === statusId ? { ...m, content: "Verbindungsfehler. Bitte versuche es erneut." } : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
    }
  }, [messages, activeLocation]);

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
    <div className="flex h-screen bg-background">
      <div className="flex flex-col w-1/2 border-r border-border bg-background">
        <header className="border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
              <Cloud className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold" data-testid="text-app-title">Segelwetter</h1>
              <p className="text-xs text-muted-foreground">AI-Meteorologe mit Windy-Karten</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="px-4 py-4 space-y-3">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const isStatus = msg.id.startsWith("status-");
              if (isStatus) {
                if (!msg.content && !isStreaming) return null;
                return (
                  <div key={msg.id} className="flex justify-start" data-testid={`message-${msg.id}`}>
                    <div className="max-w-[90%]">
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin text-primary/60 shrink-0" />
                        <MarkdownContent content={msg.content || "..."} />
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.id}`}>
                  <div className={`max-w-[90%] ${isUser ? "order-2" : "order-1"}`}>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-card text-card-foreground border border-border rounded-bl-md"
                    }`}>
                      {isUser ? msg.content : (
                        <>
                          <MarkdownContent content={msg.content} />
                          {isStreaming && msg.id === messages[messages.length - 1]?.id && msg.role === "assistant" && !isStatus && (
                            <span className="inline-flex items-center gap-0.5 ml-1 align-baseline">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border bg-card/50 backdrop-blur-sm shrink-0">
          <form onSubmit={handleSubmit} className="px-4 py-3 flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={activeLocation ? "Frage stellen oder neuen Ort eingeben..." : "Ort eingeben, z.B. \"Wie ist das Wetter in Punat?\""}
                className="pl-9"
                disabled={isStreaming}
                data-testid="input-location"
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isStreaming}
              data-testid="button-send"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-muted/30">
        {activeLocation ? (
          <div className="flex flex-col h-full">
            <div className="px-5 py-2.5 border-b border-border bg-card/50 backdrop-blur-sm shrink-0 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium" data-testid="text-active-location">{activeLocation.displayName}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {activeLocation.lat.toFixed(2)}°N, {activeLocation.lon.toFixed(2)}°E
              </span>
            </div>

            <div className="flex-1 flex flex-col overflow-y-auto">
              <div className="relative min-h-[375px] border-b border-border" style={{ aspectRatio: "3/2" }}>
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5 text-xs font-medium border border-border">
                  <Thermometer className="w-3 h-3 text-red-500" />
                  Temperatur 850hPa - ECMWF
                </div>
                <WindyEmbed
                  lat={55}
                  lon={-10}
                  overlay="temp"
                  product="ecmwf"
                  level="850h"
                  zoom={3}
                />
              </div>

              <div className="relative min-h-[250px] border-b border-border">
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5 text-xs font-medium border border-border">
                  <Map className="w-3 h-3 text-blue-500" />
                  KNMI Fronten-Analyse
                </div>
                <div className="w-full h-full flex items-center justify-center bg-white">
                  <img
                    src="/api/knmi-chart"
                    alt="KNMI Weather Analysis Chart"
                    className="max-w-full max-h-full object-contain"
                    data-testid="img-knmi-chart"
                  />
                </div>
              </div>

              <div className="relative min-h-[375px]" style={{ aspectRatio: "3/2" }}>
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5 text-xs font-medium border border-border">
                  <Wind className="w-3 h-3 text-cyan-500" />
                  Lokaler Wind - {activeLocation.regionalModelLabel}
                </div>
                <WindyEmbed
                  lat={activeLocation.lat}
                  lon={activeLocation.lon}
                  overlay="wind"
                  product={activeLocation.regionalModel}
                  level="surface"
                  zoom={activeLocation.regionalModelZoom}
                />
              </div>

              <div className="relative flex-1 min-h-[250px]">
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5 text-xs font-medium border border-border">
                  <Navigation className="w-3 h-3 text-emerald-500" />
                  Vorhersage - {activeLocation.regionalModelLabel}
                </div>
                <WindyEmbed
                  lat={activeLocation.lat}
                  lon={activeLocation.lon}
                  overlay="wind"
                  product={activeLocation.regionalModel}
                  level="surface"
                  zoom={activeLocation.regionalModelZoom}
                  forecast={true}
                />
              </div>

              {activeLocation.warningUrl && (
                <a
                  href={activeLocation.warningUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent transition-colors text-sm"
                  data-testid="link-warning-external"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Wetterwarnungen — {activeLocation.warningLabel}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mx-auto">
                <Cloud className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Kein Ort ausgewählt</p>
                <p className="text-xs text-muted-foreground mt-1">Gib im Chat einen Ort ein, um Wetterkarten zu sehen</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
