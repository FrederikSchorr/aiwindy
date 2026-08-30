import React from "react";

export type WeatherIconKind =
  | "clear-night"
  | "partly-cloudy-night"
  | "overcast-night"
  | "clear-day"
  | "few-clouds-day"
  | "partly-cloudy-day"
  | "overcast-day"
  | "light-rain"
  | "heavy-rain"
  | "thunderstorm";

const moon = <path d="m10.8 4.3c-1.8-.1-5.2 2.1-5.1 5.7.3 6.5 7.2 7.6 9.9 3.7-4 .6-7.8-4.4-4.8-9.4Z" fill="#ccefee" stroke="#7fbaba" strokeWidth=".55" strokeLinecap="round" strokeLinejoin="round" />;

function ClearSun({ cx = 76.3 }: { cx?: number }) {
  const delta = cx - 76.3;
  return <g transform={`translate(${delta} 0)`}>
    <circle cx="76.3" cy="10" r="4" fill="#ffdd55" stroke="#daa31b" strokeWidth=".6" />
    <path d="M76.3 3.2v1.4m0 10.8V17M72.7 4.1l.8 1.2m5.4 9.4.8 1.4M70.2 6.6l1.4.7m9.2 5.5 1.4.8M69.3 10.1h1.6m10.6 0h1.6M70.2 13.5l1.4-.5m9.2-5.7 1.4-.7M72.7 16.1l.8-1.4m5.4-9.4.8-1.2" fill="none" stroke="#daa31b" strokeWidth=".6" strokeLinecap="round" />
  </g>;
}

export function WeatherIcon({ kind, className = "h-10 w-10" }: { kind: WeatherIconKind; className?: string }) {
  if (kind === "clear-night") return <svg viewBox="3 1 15 18" className={className} aria-hidden="true">{moon}</svg>;
  if (kind === "partly-cloudy-night") return <svg viewBox="23 1 20 18" className={className} aria-hidden="true">
    <path d="m39.8 12c-5.3 1-7.7-4.2-5.4-8.3-2.3.2-5 2.4-4.8 5.3.3 5.8 8.5 7.1 10.2 3Z" fill="#c4ebec" stroke="#77afaf" strokeWidth=".55" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m33.4 12.4c-.4-1.9-3.8-2.9-4.9-.7-1.2-.3-2.5.6-2.5 1.8-2.2 0-2 3-.2 2.9l7.8-.1c2.3.1 2.7-3.8-.2-3.9Z" fill="#bccacc" stroke="#525d63" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  if (kind === "overcast-night") return <svg viewBox="44 1 20 18" className={className} aria-hidden="true">
    <path d="m55.8 3.6c-1.6-.1-4.9 1.8-4.7 5.2.3 5.7 7.9 5.9 4.7 1.7-1.2-1.8-1.7-5.2 0-6.9Z" fill="#cdeeee" stroke="#7babad" strokeWidth=".55" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m61.2 9.5c-.7-2.1-3.4-2.5-4.2-.9-.5 0-1 .5-1 .9V11l4.5 2c2.9.3 3.1-3.3.7-3.5Z" fill="#5d6a6e" stroke="#364044" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m49.5 10.3c-.9 0-1.9.2-2.1 1.5-2.1-.1-2.4 2.9-.3 2.9H54v-3.1c.2-2.4-3.3-3.7-4.5-1.3Z" fill="#5d6a6e" stroke="#364044" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m59.3 12.4c-.4-2-3.2-3.1-5-.8-1.2-.3-2.3.5-2.3 1.7-2.4 0-2.7 3.2-.4 3.2l7.7-.1c2.6 0 3.1-4 0-4Z" fill="#58656a" stroke="#333e48" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  if (kind === "clear-day") return <svg viewBox="67 1 18 18" className={className} aria-hidden="true"><ClearSun /></svg>;
  if (kind === "few-clouds-day") return <svg viewBox="88 1 21 18" className={className} aria-hidden="true">
    <ClearSun cx={100.3} />
    <path d="m94.4 11.7c-.7-1.4-2.3-1.6-3.2-.2-.7-.1-1.1.2-1.1 1-1.4.2-1.2 1.8-.2 1.8l4.7-.1c1.7 0 1.5-2.5-.2-2.5Z" fill="#dae0e1" stroke="#acbcbe" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  if (kind === "partly-cloudy-day") return <svg viewBox="94 1 17 18" className={className} aria-hidden="true">
    <ClearSun cx={100.3} />
    <path d="m107 11.6c-.3-2.6-4.4-3.6-5.6-.8-1.4-.2-2.6.6-2.6 1.9-2.8.2-2.3 3.7-.2 3.6h8.8c2.9-.2 3.2-4.6-.4-4.7Z" fill="#abbbbd" stroke="#859195" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  if (kind === "overcast-day") return <svg viewBox="115 1 19 18" className={className} aria-hidden="true">
    <path d="m129.2 6.9c-.6-2.6-4.3-3.3-6.1-1L122 9l8.3 2.9c2.3-.8 2.1-4.6-1.1-5Z" fill="#606e73" stroke="#364044" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m117 8.9c-2.6.3-2.6 3.8.3 3.8l8.4-.2-.6-4.5c-.6-2.3-4.2-2.9-5.6-.6-1.2-.1-2.3.3-2.5 1.5Z" fill="#849193" stroke="#5b6569" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m128.6 10.8c-.4-2.9-4.4-3.5-6.1-1.1-1.6-.3-2.8.9-2.9 2.2-2.8.1-2.6 3.7-.2 3.7h9.2c3.3 0 3.9-4.9 0-4.8Z" fill="#8b99a0" stroke="#5a6366" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  if (kind === "light-rain") return <svg viewBox="136 1 19 19" className={className} aria-hidden="true">
    <path d="m149.5 6.6c-.5-6.7-7.1-2.4-6.8-.6l-.1 6h6.8c3.8.1 3.8-5.4.1-5.4Z" fill="#abb4b8" stroke="#7c868a" strokeWidth=".6" />
    <path d="m139.5 8 1.5-.5 1 4.5h-2.7c-2.7-.6-2.1-3.8.2-4Z" fill="#abb4b8" stroke="#7c868a" strokeWidth=".6" />
    <path d="m140 8c-.2-1.7 1.7-2.9 2.9-2.2l.6 1.5-1.5 2.7-2-2Z" fill="#abb4b8" stroke="#7c868a" strokeWidth=".6" />
    <path d="m141.6 15.5 1.1-2.2m.9 4.1.9-2.5m2.1.6 1.1-2.2" fill="none" stroke="#0686d8" strokeWidth=".94" strokeLinecap="round" />
  </svg>;
  if (kind === "heavy-rain") return <svg viewBox="157 1 18 19" className={className} aria-hidden="true">
    <path d="m170.3 6.8-.3-.2-.3-.1h-.4c-.3-3.3-5.1-4.1-6-.8-1.4-.5-3.3.4-3.3 2.3-2.9 0-3.2 4-.1 4H170c3-.3 3.3-4.3.3-5.2Z" fill="#566266" stroke="#374042" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m159.9 15.6.7-2.3m.6 4.1 1.1-2.4m2.2.6 1-2.2m.7 4 1-2.4m2.1.6 1.1-2.2" fill="none" stroke="#0686d8" strokeWidth=".94" strokeLinecap="round" />
  </svg>;
  return <svg viewBox="177 1 20 21" className={className} aria-hidden="true">
    <path d="m192.3 6.4-.9-.4-.4-.1c-1-3.9-5.7-3.9-7-1.1-1.7-.5-3.6.3-3.4 2.5-3.2-.4-3.7 4.3-.5 4.6H191c3.3-.3 4-4.2 1.3-5.5Z" fill="#657175" stroke="#353c41" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m180 15.6.8-2.3m.4 4.2 1.4-2.7m5.3.3-.4 2.5m3.2-2 .9-2.3" fill="none" stroke="#0686d8" strokeWidth=".94" strokeLinecap="round" />
    <g transform="translate(185.4 13.4) scale(1.7) translate(-185.4 -13.4)">
      <path d="M185.2 12.6h2.4l-3.3 4.4-1.1 1.4 1.8-4.1-1.6-.3 1.9-5.2h2.5Z" fill="#ff7015" stroke="#cd5000" strokeWidth=".49" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>;
}