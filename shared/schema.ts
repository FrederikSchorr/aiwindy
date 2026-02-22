import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const geocodeRequestSchema = z.object({
  location: z.string().min(1, "Location is required"),
});

export type GeocodeRequest = z.infer<typeof geocodeRequestSchema>;

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  regionalModel: string;
  regionalModelLabel: string;
  regionalModelZoom: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ForecastHour {
  time: string;
  temp: number;
  rain: number;
  windSpeed: number;
  windGusts: number;
  windDir: number;
  weatherCode: number;
}

export interface ForecastData {
  hours: ForecastHour[];
  timezone: string;
}
