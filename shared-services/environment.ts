import process from "node:process";

export function getRequiredEnvValue(key: string) {
  if (process.env[key]) {
    return JSON.parse(process.env[key]);
  } else {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
}
