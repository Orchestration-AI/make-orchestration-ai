import { defineService } from "@orchestration-ai/sdk/app-builder";
import { timeServiceFunctions } from "./time.description.ts";

type TimeUnit = "milliseconds" | "seconds" | "minutes" | "hours" | "days" | "weeks";

const unitToMs: Record<TimeUnit, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

export const timeService = defineService({
  unique_name: "time",
  service_name: "OAI Time",
  service_description: "Provides the current time and operations for adding durations or calculating differences between datetimes.",
  description: timeServiceFunctions,
  tools: {
    now: () => {
      const now = new Date();
      const iso = now.toISOString();
      const readable = now.toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
      return `${readable} (${iso})`;
    },

    add: (body: { datetime: string; amount: number; unit: TimeUnit }) => {
      const ms = unitToMs[body.unit];
      if (!ms) throw new Error(`Unknown unit: ${body.unit}`);
      return new Date(new Date(body.datetime).getTime() + body.amount * ms).toISOString();
    },

    diff: (body: { from: string; to: string; unit: TimeUnit }) => {
      const ms = unitToMs[body.unit];
      if (!ms) throw new Error(`Unknown unit: ${body.unit}`);
      return (new Date(body.to).getTime() - new Date(body.from).getTime()) / ms;
    },
  },
});
