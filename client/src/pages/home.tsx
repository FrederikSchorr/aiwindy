import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MapPin, Cloud, Wind, Thermometer, Loader2 } from "lucide-react";
import type { ChatMessage, GeocodeResult } from "@shared/schema";

function WindyEmbed({ lat, lon, label, overlay, zoom }: { lat: number; lon: number; label: string; overlay: string; zoom: number }) {
  const src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=${zoom}&overlay=${overlay}&product=ecmwf&level=surface&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=true&message=true`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {overlay === "temp" ? <Thermometer className="w-4 h-4" /> : <Wind className="w-4 h-4" />}
        <span>{label}</span>
      </div>
      <div className="rounded-md border border-border overflow-hidden">
        <iframe
          title={label}
          src={src}
          className="w-full h-full min-h-[300px]"
          frameBorder="0"
          data-testid={`iframe-windy-${overlay}`}
        />
      </div>
    </div>
  );
}

function MessageBubble({ message, onLocationSelect }: { message: ChatMessage; onLocationSelect: (loc: GeocodeResult, name: string) => void }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`} data-testid={`message-${message.id}`}>
      <div className={`max-w-[90%] ${isUser ? "order-2" : "order-1"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-card text-card-foreground border border-border rounded-bl-md"
          }`}
        >
          {message.content}
        </div>
        {message.location && (
          <button
            onClick={() => onLocationSelect(message.location!, message.content)}
            className="mt-1.5 flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline"
            data-testid={`button-show-map-${message.id}`}
          >
            <MapPin className="w-3 h-3" />
            Show on map
          </button>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! Tell me a location and I'll show you the current weather maps. Try something like \"Vienna\", \"Rome\", or \"Munich\".",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLocation, setActiveLocation] = useState<{ location: GeocodeResult; label: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const geocodeMutation = useMutation({
    mutationFn: async (location: string): Promise<GeocodeResult> => {
      const res = await apiRequest("POST", "/api/geocode", { location });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Found: ${data.displayName}`,
          location: data,
        },
      ]);
      setActiveLocation({ location: data, label: data.displayName });
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I couldn't find that location. Please try a different city or place name.",
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, geocodeMutation.isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || geocodeMutation.isPending) return;

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: trimmed },
    ]);
    setInput("");
    geocodeMutation.mutate(trimmed);
  };

  const handleLocationSelect = (loc: GeocodeResult, label: string) => {
    setActiveLocation({ location: loc, label: loc.displayName });
  };

  return (
    <div className="flex h-screen bg-background">
      <div className="flex flex-col w-[360px] min-w-[320px] border-r border-border bg-background">
        <header className="border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
              <Cloud className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold" data-testid="text-app-title">Windy Weather</h1>
              <p className="text-xs text-muted-foreground">Enter a location to see live weather</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="px-4 py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onLocationSelect={handleLocationSelect} />
            ))}
            {geocodeMutation.isPending && (
              <div className="flex justify-start mb-3">
                <div className="bg-card text-card-foreground border border-border rounded-2xl rounded-bl-md px-4 py-2.5 flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-muted-foreground">Looking up...</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card/50 backdrop-blur-sm shrink-0">
          <form onSubmit={handleSubmit} className="px-4 py-3 flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter a city or location..."
                className="pl-9"
                disabled={geocodeMutation.isPending}
                data-testid="input-location"
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || geocodeMutation.isPending}
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
            <div className="px-5 py-3 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium" data-testid="text-active-location">{activeLocation.label}</span>
              </div>
            </div>
            <div className="flex-1 grid grid-rows-2 gap-4 p-4 overflow-y-auto">
              <WindyEmbed
                lat={activeLocation.location.lat}
                lon={activeLocation.location.lon}
                label="Temperature"
                overlay="temp"
                zoom={6}
              />
              <WindyEmbed
                lat={activeLocation.location.lat}
                lon={activeLocation.location.lon}
                label="Wind"
                overlay="wind"
                zoom={6}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mx-auto">
                <Cloud className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No location selected</p>
                <p className="text-xs text-muted-foreground mt-1">Type a city in the chat to see weather maps</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
