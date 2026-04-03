import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Sailboat, Camera, MapPin, Image, Wind, Compass, Anchor, Waves, Sun, Cloud, CloudRain, Thermometer, Navigation, Flag, CloudSun, Droplets, Ship, type LucideIcon } from "lucide-react";
import type { ChatMessage, GeocodeResult, WeatherEuropeSSE, WeatherOutputData } from "@shared/schema";

const KNMI_SOURCE_URL = "https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten";

interface AnalysisSources {
  windy: string[];
  national: string[];
  europe: string[];
}

interface SSEPayload {
  location?: GeocodeResult;
  weatherEurope?: WeatherEuropeSSE;
  weatherOutput?: WeatherOutputData;
  sources?: AnalysisSources;
  content?: string;
  error?: string;
  done?: boolean;
  loadingStatus?: string;
}

function WindyEmbed({ lat, lon, overlay, product, level, zoom, forecast, marker }: {
  lat: number; lon: number; overlay: string; product: string; level: string; zoom: number; forecast?: boolean; marker?: boolean;
}) {
  const markerVal = marker ? "true" : "false";
  const src = forecast
    ? `https://embed.windy.com/embed2.html?type=forecast&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=${markerVal}&message=true&pressure=true&calendar=now`
    : `https://embed.windy.com/embed2.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=kt&zoom=${zoom}&overlay=${overlay}&product=${product}&level=${level}&lat=${lat}&lon=${lon}${marker ? `&detailLat=${lat}&detailLon=${lon}` : ""}&marker=${markerVal}&message=true&pressure=true&calendar=now`;

  return (
    <iframe
      title={`${overlay}-${product}`}
      src={src}
      className="w-full border-0 rounded-lg"
      style={{ height: forecast ? "186px" : "300px" }}
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

function BounceLoader() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 mt-2 align-baseline" data-testid="bounce-loader">
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

const STATUS_ICONS: LucideIcon[] = [
  Sailboat, Wind, Compass, Anchor, Waves, Sun, Cloud, CloudRain,
  Thermometer, Navigation, Flag, CloudSun, Droplets, Ship, MapPin,
];

function StatusLoader({ text }: { text: string }) {
  const [iconIndex, setIconIndex] = useState(0);
  useEffect(() => {
    setIconIndex(Math.floor(Math.random() * STATUS_ICONS.length));
    const interval = setInterval(() => {
      setIconIndex(prev => (prev + 1) % STATUS_ICONS.length);
    }, 1000);
    return () => clearInterval(interval);
  }, [text]);
  const Icon = STATUS_ICONS[iconIndex];
  return (
    <div className="flex items-center gap-2 mt-2 text-muted-foreground text-sm" data-testid="status-loader">
      <Icon className="w-4 h-4 text-primary/70 shrink-0 transition-all duration-300" />
      <span>{text}...</span>
    </div>
  );
}

function SectionTitle({ num, title }: { num: number; title: string }) {
  return (
    <h2 className="text-base font-bold mt-4 mb-1" data-testid={`section-title-${num}`}>
      {num}. {title}
    </h2>
  );
}

function CountryFlag({ countryCode }: { countryCode: string }) {
  return (
    <img
      src={`https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`}
      width={20}
      height={14}
      alt={countryCode}
      className="inline-block rounded-[2px] shrink-0"
    />
  );
}

function AnalysisView({ location, weatherEurope, weatherOutput, sources, isStreaming, hasError, loadingStatus }: {
  location: GeocodeResult;
  weatherEurope: WeatherEuropeSSE | null;
  weatherOutput: WeatherOutputData | null;
  sources: AnalysisSources | null;
  isStreaming: boolean;
  hasError?: boolean;
  loadingStatus?: string | null;
}) {
  const saLat = location.lat;
  const saLon = location.lon;
  const cityLat = location.cityLat ?? location.lat;
  const cityLon = location.cityLon ?? location.lon;
  const model = location.regionalModel;
  const modelLabel = location.regionalModelLabel;
  const zoom = 7;
  const locationShort = location.cityName || location.displayName?.split(",")[0]?.trim() || "";
  const sailingAreaShort = location.sailingArea || locationShort;
  const windUrl = `https://www.windy.com/-wind-${model}?${model},${saLat.toFixed(3)},${saLon.toFixed(3)},${Math.min(zoom + 2, 14)}`;
  const cloudsUrl = `https://www.windy.com/${saLat.toFixed(3)}/${saLon.toFixed(3)}/${model}/meteogram?${model},clouds,${saLat.toFixed(3)},${saLon.toFixed(3)},${zoom}`;
  const prognoseUrl = `https://www.windy.com/${saLat.toFixed(3)}/${saLon.toFixed(3)}/${model}?${model},${saLat.toFixed(3)},${saLon.toFixed(3)},${Math.min(zoom + 1, 14)},i:pressure,p:favs`;

  return (
    <div data-testid="analysis-view">
      <div className="mb-3 text-sm font-medium text-foreground/80" data-testid="analysis-header">
        {!location.sailingArea && !location.cityName ? (
          <span className="text-destructive">Weder Segelrevier noch Ort erkannt. Bitte versuche es mit einem konkreteren Ortsnamen.</span>
        ) : location.sailingArea ? (
          <span>Wetteranalyse für {location.cityName}, {location.sailingArea}{location.countryCode && <>{" "}<CountryFlag countryCode={location.countryCode} /></>}</span>
        ) : (
          <span>Kein Segelrevier erkannt. Wetteranalyse für {location.cityName}{location.countryCode && <>{" "}<CountryFlag countryCode={location.countryCode} /></>}</span>
        )}
      </div>

      {(location.sailingArea || location.cityName) && (
      <>
      <SectionTitle num={1} title="Druck & Luftmassen" />
      <div className="my-3" data-testid="section-card-1">
        <WindyEmbed lat={48} lon={5} overlay="temp" product="ecmwf" level="850h" zoom={3} />
        <SourceLink label="Windy Temperatur 1.500m ECMWF" url="https://www.windy.com/-Temperatur-temp?ecmwf,temp,850h,48.000,5.000,3" />
      </div>
      {weatherOutput?.airPressureMasses?.text && (
        <MarkdownContent content={weatherOutput.airPressureMasses.text} />
      )}

      {hasError && !weatherOutput && (
        <p className="text-sm text-destructive mt-3" data-testid="text-analysis-error">
          Fehler bei der Datenabfrage. Die Analyse konnte nicht vollständig geladen werden.
        </p>
      )}

      {!weatherEurope && isStreaming && !hasError && loadingStatus && <StatusLoader text={loadingStatus} />}

      {weatherEurope && (
        <>
          <SectionTitle num={2} title="Fronten" />
          <div className="my-3" data-testid="section-card-2">
            {weatherEurope.frontCurrentBase64 ? (
              <img
                src={`data:image/gif;base64,${weatherEurope.frontCurrentBase64}`}
                alt="KNMI Fronten-Analyse"
                className="w-full rounded-lg bg-white"
                data-testid="img-knmi-chart"
              />
            ) : (
              <div className="w-full h-48 bg-muted rounded-lg flex items-center justify-center">
                <span className="text-muted-foreground text-sm">KNMI Karte nicht verfügbar</span>
              </div>
            )}
            <SourceLink
              label={`KNMI Analyse ${weatherEurope.frontCurrentLocalTime}`}
              url={weatherEurope.frontCurrentUrl || KNMI_SOURCE_URL}
            />
          </div>
          {weatherOutput?.weatherFront?.text && (
            <MarkdownContent content={weatherOutput.weatherFront.text} />
          )}

          <SectionTitle num={3} title="Wind & Welle" />
          <div className="my-3" data-testid="section-card-3">
            <WindyEmbed lat={saLat} lon={saLon} overlay="wind" product={model} level="surface" zoom={Math.max(zoom - 2, 4)} marker />
            <SourceLink label={`Wind ${sailingAreaShort} ${modelLabel} windy.com`} url={windUrl} />
          </div>
          {weatherOutput?.windWaves?.text && (
            <MarkdownContent content={weatherOutput.windWaves.text} />
          )}

          <SectionTitle num={4} title="Wolken & Regen" />
          <div className="my-3" data-testid="section-card-4">
            <WindyEmbed lat={saLat} lon={saLon} overlay="clouds" product={model} level="surface" zoom={Math.max(zoom - 3, 4)} marker />
            <SourceLink label={`Wolken ${sailingAreaShort} ${modelLabel} windy.com`} url={cloudsUrl} />
          </div>
          {weatherOutput?.cloudsRain?.text && (
            <MarkdownContent content={weatherOutput.cloudsRain.text} />
          )}

          <SectionTitle num={5} title="Temperatur" />
          <div className="my-3" data-testid="section-card-5">
            <WindyEmbed lat={saLat} lon={saLon} overlay="wind" product={model} level="surface" zoom={zoom} forecast marker />
            <SourceLink label={`Prognose ${locationShort} ${modelLabel} windy.com`} url={prognoseUrl} />
          </div>
          {weatherOutput?.temperature?.text && (
            <MarkdownContent content={weatherOutput.temperature.text} />
          )}

          {!weatherOutput && isStreaming && loadingStatus && <StatusLoader text={loadingStatus} />}

          {weatherOutput && sources && (
            <>
              <SectionTitle num={6} title="Quellen" />
              <ul className="mt-1 mb-2 space-y-0.5 list-disc pl-5" data-testid="section-sources">
                {[...sources.windy, ...sources.national, ...sources.europe].map((md, i) => (
                  <li key={i} className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{
                    __html: md.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
                      (_, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:text-primary/80">${text}</a>`)
                  }} />
                ))}
                <li className="text-sm">
                  <span className="text-muted-foreground">
                    Alle Wetter Details{" "}
                    <a
                      href="/api/analysis-json"
                      download
                      className="underline hover:text-primary transition-colors"
                      data-testid="link-download-analysis"
                    >hier</a>
                    . &copy; 2026 Frederik Schorr
                  </span>
                </li>
              </ul>
            </>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Ahoi! Sage mir wo Du segelst ⛵, oder lade ein Wolken-Foto ☁️ hoch.",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLocation, setActiveLocation] = useState<GeocodeResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploadHintAfterMsgId, setUploadHintAfterMsgId] = useState<string | null>(null);
  const uploadHintShownRef = useRef(false);
  const hasUploadedRef = useRef(false);
  const [uploadPreviews, setUploadPreviews] = useState<Record<string, { url: string; time?: string | null; locationName?: string | null; countryCode?: string | null; isVideo?: boolean }>>({});
  const [messageLocations, setMessageLocations] = useState<Record<string, GeocodeResult>>({});
  const [messageWeatherEurope, setMessageWeatherEurope] = useState<Record<string, WeatherEuropeSSE>>({});
  const [messageWeatherOutput, setMessageWeatherOutput] = useState<Record<string, WeatherOutputData>>({});
  const [messageSources, setMessageSources] = useState<Record<string, AnalysisSources>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, boolean>>({});
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [photoLocationHints, setPhotoLocationHints] = useState<Record<string, { locationName: string; countryCode?: string | null }>>({});
  const lastAnalysisLocationRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

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

    let chatStreamContent = "";

    const getChatStreamEl = () => document.getElementById(`stream-${assistantId}`);

    const handleEvent = (data: SSEPayload) => {
      if (data.loadingStatus) {
        setLoadingStatus(data.loadingStatus);
      }
      if (data.location) {
        isAnalyse = true;
        setActiveLocation(data.location);
        setMessageLocations(prev => ({ ...prev, [assistantId]: data.location! }));
        lastAnalysisLocationRef.current = data.location!.displayName.split(",")[0].trim();
      }
      if (data.weatherEurope) {
        setMessageWeatherEurope(prev => ({ ...prev, [assistantId]: data.weatherEurope! }));
      }
      if (data.weatherOutput) {
        setMessageWeatherOutput(prev => ({ ...prev, [assistantId]: data.weatherOutput! }));
      }
      if (data.sources) {
        setMessageSources(prev => ({ ...prev, [assistantId]: data.sources! }));
      }
      if (data.done) {
        setLoadingStatus(null);
      }
      if (data.error) {
        setLoadingStatus(null);
        if (isAnalyse) {
          setAnalysisErrors(prev => ({ ...prev, [assistantId]: true }));
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && !m.content ? { ...m, content: "Fehler bei der Verarbeitung. Bitte versuche es erneut." } : m
            )
          );
        }
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
            const data = JSON.parse(line.slice(6));
            if (data.content && !isAnalyse) {
              chatStreamContent += data.content;
              const el = getChatStreamEl();
              if (el) el.textContent = chatStreamContent;
            } else if (!data.content) {
              handleEvent(data);
            }
          } catch {}
        }
      }
    };

    xhr.onprogress = processChunk;
    xhr.onloadend = () => {
      lineBuffer += "\n";
      processChunk();
      if (!isAnalyse) {
        setMessages((prev) => {
          const msg = prev.find(m => m.id === assistantId);
          if (msg && !chatStreamContent) return prev.filter(m => m.id !== assistantId);
          return prev.map((m) => m.id === assistantId ? { ...m, content: chatStreamContent } : m);
        });
      }
      if (isAnalyse && !uploadHintShownRef.current && !hasUploadedRef.current) {
        uploadHintShownRef.current = true;
        setUploadHintAfterMsgId(assistantId);
      }
      setLoadingStatus(null);
      setIsStreaming(false);
    };
    xhr.onerror = () => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Verbindungsfehler. Bitte versuche es erneut." } : m
        )
      );
      setLoadingStatus(null);
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
    const userId = `user-${Date.now()}`;
    const isVideo = file.type.startsWith("video/");
    let processed = 0;
    let lineBuffer = "";
    let uploadHadError = false;

    hasUploadedRef.current = true;

    let photoExifMeta: { locationName: string | null; countryCode: string | null } = { locationName: null, countryCode: null };

    if (!isVideo) {
      const objectUrl = URL.createObjectURL(file);
      setUploadPreviews(prev => ({ ...prev, [userId]: { url: objectUrl } }));
    } else {
      setUploadPreviews(prev => ({ ...prev, [userId]: { url: "", isVideo: true } }));
    }

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: "" },
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

    let uploadStreamContent = "";
    const getUploadStreamEl = () => document.getElementById(`stream-${assistantId}`);

    const processChunk = () => {
      const text = xhr.responseText.slice(processed);
      processed = xhr.responseText.length;
      const combined = lineBuffer + text;
      const lines = combined.split("\n");
      lineBuffer = lines.pop() || "";
      let hasError = false;
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.location) {
              setActiveLocation(data.location as GeocodeResult);
            }
            if (data.exifMeta) {
              photoExifMeta = { locationName: data.exifMeta.locationName ?? null, countryCode: data.exifMeta.countryCode ?? null };
              setUploadPreviews(prev => ({
                ...prev,
                [userId]: { ...prev[userId], time: data.exifMeta.time, locationName: data.exifMeta.locationName, countryCode: data.exifMeta.countryCode }
              }));
            }
            if (data.videoMeta) {
              const thumbUrl = data.videoMeta.thumbnailBase64
                ? `data:image/jpeg;base64,${data.videoMeta.thumbnailBase64}`
                : "";
              photoExifMeta = { locationName: data.videoMeta.locationName ?? null, countryCode: data.videoMeta.countryCode ?? null };
              setUploadPreviews(prev => ({
                ...prev,
                [userId]: { url: thumbUrl, isVideo: true, time: data.videoMeta.time, locationName: data.videoMeta.locationName, countryCode: data.videoMeta.countryCode }
              }));
            }
            if (data.content) {
              uploadStreamContent += data.content;
              const el = getUploadStreamEl();
              if (el) el.textContent = uploadStreamContent;
            }
            if (data.error) {
              hasError = true;
              uploadHadError = true;
            }
          } catch {}
        }
      }
      if (hasError) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content ? { ...m, content: "Fehler bei der Analyse. Bitte versuche es erneut." } : m
          )
        );
      }
    };

    xhr.onprogress = processChunk;
    xhr.onloadend = () => {
      lineBuffer += "\n";
      processChunk();
      setMessages((prev) => {
        if (!uploadStreamContent && !uploadHadError) return prev.filter(m => m.id !== assistantId);
        if (!uploadStreamContent) return prev;
        return prev.map((m) => m.id === assistantId ? { ...m, content: uploadStreamContent } : m);
      });
      if (photoExifMeta.locationName) {
        const lastAnalysis = lastAnalysisLocationRef.current;
        const isDifferentOrNone = !lastAnalysis || lastAnalysis !== photoExifMeta.locationName;
        if (isDifferentOrNone) {
          setPhotoLocationHints(prev => ({
            ...prev,
            [assistantId]: { locationName: photoExifMeta.locationName!, countryCode: photoExifMeta.countryCode }
          }));
        }
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
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const loc = messageLocations[msg.id];
            const we = messageWeatherEurope[msg.id];
            const wo = messageWeatherOutput[msg.id];
            const srcs = messageSources[msg.id] ?? null;
            const hasAnalysisError = analysisErrors[msg.id] ?? false;
            const isAnalysis = !!loc;
            const isLast = msg.id === messages[messages.length - 1]?.id;
            const showUploadHint = msg.id === uploadHintAfterMsgId;

            if (isUser) {
              const preview = uploadPreviews[msg.id];
              const formatExifDate = (raw: string | null | undefined) => {
                if (!raw) return null;
                const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2})/);
                if (!m) return raw;
                return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
              };
              return (
                <div key={msg.id} className="flex justify-end" data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                  <div className="max-w-[75%]">
                    {preview ? (
                      <div>
                        {preview.isVideo ? (
                          <div className="relative">
                            {preview.url ? (
                              <img
                                src={preview.url}
                                alt="Standbild aus Video"
                                className="rounded-2xl rounded-br-md max-w-full max-h-72 object-cover block"
                              />
                            ) : (
                              <div className="rounded-2xl rounded-br-md w-48 h-32 bg-muted flex items-center justify-center">
                                <span className="text-muted-foreground text-sm">Lade...</span>
                              </div>
                            )}
                            <div className="absolute top-2 left-2 bg-black/60 rounded-md px-2 py-0.5 flex items-center gap-1">
                              <span className="text-white text-xs font-medium">▶ Video</span>
                            </div>
                          </div>
                        ) : (
                          <img
                            src={preview.url}
                            alt="Hochgeladenes Foto"
                            className="rounded-2xl rounded-br-md max-w-full max-h-72 object-cover block"
                          />
                        )}
                        {(preview.locationName || preview.time) && (
                          <div className="flex flex-col items-end gap-0.5 mt-1">
                            {preview.locationName && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> {preview.locationName}
                                {preview.countryCode && (
                                  <CountryFlag countryCode={preview.countryCode} />
                                )}
                              </span>
                            )}
                            {preview.time && (
                              <span className="text-xs text-muted-foreground">
                                {formatExifDate(preview.time)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : msg.content ? (
                      <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-normal bg-primary text-primary-foreground">
                        {msg.content}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (isAnalysis) {
              return (
                <div key={msg.id} data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                  <AnalysisView
                    location={loc}
                    weatherEurope={we || null}
                    weatherOutput={wo || null}
                    sources={srcs}
                    isStreaming={isStreaming && isLast}
                    hasError={hasAnalysisError}
                    loadingStatus={isStreaming && isLast ? loadingStatus : null}
                  />
                  {showUploadHint && !isStreaming && (
                    <div className="flex items-center gap-2 mt-3 text-[14px] text-muted-foreground italic" data-testid="text-upload-hint">
                      <Camera className="w-4 h-4 shrink-0" />
                      Lade ein aktuelles Wolken-Foto oder Video hoch für meteorologische Analyse.
                    </div>
                  )}
                </div>
              );
            }

            const photoHint = photoLocationHints[msg.id];
            const isCurrentlyStreaming = isStreaming && isLast && msg.role === "assistant";
            return (
              <div key={msg.id} className="w-full" data-testid={`message-${msg.id}`} data-message-id={msg.id}>
                {isCurrentlyStreaming
                  ? <div id={`stream-${msg.id}`} className="text-[15px] leading-relaxed whitespace-pre-wrap text-foreground" />
                  : msg.content ? <MarkdownContent content={msg.content} /> : null}
                {isCurrentlyStreaming && (loadingStatus ? <StatusLoader text={loadingStatus} /> : <BounceLoader />)}
                {photoHint && !isStreaming && (
                  <div className="mt-3 text-[14px]" data-testid="text-photo-location-hint">
                    <div className="flex items-center gap-2 flex-wrap text-muted-foreground italic">
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span>
                        Wetteranalyse für{" "}
                        <strong className="not-italic text-foreground/80">
                          {photoHint.locationName}
                          {photoHint.countryCode && (
                            <>
                              {" "}
                              <CountryFlag countryCode={photoHint.countryCode} />
                            </>
                          )}
                        </strong>
                        {" "}durchführen?
                      </span>
                      <Button
                        size="sm"
                        data-testid="button-confirm-location-yes"
                        disabled={isStreaming}
                        onClick={() => {
                          if (isStreaming) return;
                          const locText = photoHint.countryCode
                            ? `${photoHint.locationName}, ${photoHint.countryCode}`
                            : photoHint.locationName;
                          setPhotoLocationHints(prev => {
                            const next = { ...prev };
                            delete next[msg.id];
                            return next;
                          });
                          setMessages((prev) => [
                            ...prev,
                            { id: `user-${Date.now()}`, role: "user" as const, content: locText },
                          ]);
                          sendMessage(locText);
                        }}
                      >
                        ja
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="button-confirm-location-no"
                        className="not-italic"
                        onClick={() => {
                          setPhotoLocationHints(prev => {
                            const next = { ...prev };
                            delete next[msg.id];
                            return next;
                          });
                        }}
                      >
                        nein
                      </Button>
                    </div>
                  </div>
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
            <input
              type="file"
              accept="image/*,video/*"
              capture="environment"
              ref={captureInputRef}
              onChange={onFileChange}
              className="hidden"
              data-testid="input-capture"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => captureInputRef.current?.click()}
              disabled={isStreaming}
              data-testid="button-capture"
              title="Foto aufnehmen"
              className="shrink-0"
            >
              <Camera className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              data-testid="button-upload"
              title="Foto/Video aus Galerie"
              className="shrink-0"
            >
              <Image className="w-4 h-4" />
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
