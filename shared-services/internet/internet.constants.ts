import process from "node:process";

export const MAX_RESPONSE_BYTES = +(process.env.INTERNET_MAX_RESPONSE_BYTES || 5242880);
export const MAX_DOWNLOAD_BYTES = +(process.env.INTERNET_MAX_DOWNLOAD_BYTES || 104857600);
