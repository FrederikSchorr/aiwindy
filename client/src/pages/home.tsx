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
          className="w-full h-[350px] md:h-[400px]"
          frameBorder="0"
          data-testid={`iframe-windy-${overlay}`}
        />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`} data-testid={`message-${message.id}`}>
      <div className={`max-w-[85%] md:max-w-[75%] ${isUser ? "order-2" : "order-1"}`}>
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
          <div className="mt-3 space-y-3">
            <WindyEmbed
              lat={message.location.lat}
              lon={message.location.lon}
              label="Temperature"
              overlay="temp"
              zoom={6}
            />
            <WindyEmbed
              lat={message.location.lat}
              lon={message.location.lon}
              label="Wind"
              overlay="wind"
              zoom={6}
            />
          </div>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const geocodeMutation = useMutation({
    mutationFn: async (location: string): Promise<GeocodeResult> => {
      const res = await apiRequest("POST", "/api/geocode", { location });
      return res.json();
    },
    onSuccess: (data, location) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Here are the weather maps for ${data.displayName}:`,
          location: data,
        },
      ]);
    },
    onError: (error: Error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Sorry, I couldn't find that location. Please try a different city or place name.`,
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
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
      },
    ]);
    setInput("");
    geocodeMutation.mutate(trimmed);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
            <Cloud className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold" data-testid="text-app-title">Windy Weather Maps</h1>
            <p className="text-xs text-muted-foreground">Enter a location to see live weather</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {geocodeMutation.isPending && (
            <div className="flex justify-start mb-4">
              <div className="bg-card text-card-foreground border border-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-muted-foreground">Looking up location...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card/50 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={inputRef}
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
  );
}
