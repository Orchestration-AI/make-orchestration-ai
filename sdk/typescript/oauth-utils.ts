import type { Client } from './client';
import type { OAuthTokenResponse } from './types.gen';
import { oAuthToken } from './sdk.gen';

const STORAGE_KEY = 'oai_oauth_tokens';

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  expires_at: number;
}

export interface OAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scope?: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function saveTokens(tokenResponse: OAuthTokenResponse): OAuthTokens | null {
  if (!isBrowser() || !tokenResponse?.access_token) return null;
  const tokens: OAuthTokens = {
    access_token: tokenResponse.access_token!,
    refresh_token: tokenResponse.refresh_token!,
    token_type: tokenResponse.token_type || 'Bearer',
    expires_in: tokenResponse.expires_in || 3600,
    scope: tokenResponse.scope,
    expires_at: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  return tokens;
}

function getStoredTokens(): OAuthTokens | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearTokens(): void {
  if (isBrowser()) localStorage.removeItem(STORAGE_KEY);
}

function isTokenExpired(tokens: OAuthTokens): boolean {
  return Date.now() >= tokens.expires_at - 30_000; // 30s buffer
}

export function getCurrentLogin(): OAuthTokens | null {
  return getStoredTokens();
}

export function logout(): void {
  clearTokens();
}

export function initiateLogin(baseUrl: string, config: OAuthConfig, state?: string): void {
  if (!isBrowser()) throw new Error('initiateLogin can only be used in the browser');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    ...(config.scope && { scope: config.scope }),
    ...(state && { state }),
  });
  window.location.href = `${baseUrl}/oauth/ui/authorize?${params.toString()}`;
}

export type OAuthRedirectResult =
  | { granted: true; code: string; state?: string }
  | { granted: false; error: string; error_description: string; state?: string };

export function parseLoginRedirect(): OAuthRedirectResult {
  if (!isBrowser()) throw new Error('parseLoginRedirect can only be used in the browser');
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) {
    return {
      granted: false,
      error,
      error_description: params.get('error_description') || '',
      state: params.get('state') || undefined,
    };
  }
  const code = params.get('code');
  if (!code) throw new Error('No code or error found in redirect URL');
  return { granted: true, code, state: params.get('state') || undefined };
}

export function setupOAuthInterceptors(sdkClient: Client, config: OAuthConfig): void {
  if (!isBrowser()) return;

  let refreshPromise: Promise<OAuthTokens | null> | null = null;

  async function refreshAccessToken(): Promise<OAuthTokens | null> {
    const tokens = getStoredTokens();
    if (!tokens?.refresh_token) {
      clearTokens();
      return null;
    }
    try {
      const response = await oAuthToken({
        client: sdkClient,
        body: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: config.client_id,
          client_secret: config.client_secret,
        },
      });
      if (response.error) {
        clearTokens();
        return null;
      }
      return saveTokens(response.data as OAuthTokenResponse);
    } catch {
      clearTokens();
      return null;
    }
  }

  // Request interceptor: attach access token, refresh if expired
  sdkClient.instance.interceptors.request.use(async (reqConfig) => {
    let tokens = getStoredTokens();
    if (!tokens) return reqConfig;

    if (isTokenExpired(tokens)) {
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      tokens = await refreshPromise;
      if (!tokens) return reqConfig;
    }

    reqConfig.headers = reqConfig.headers || {};
    reqConfig.headers['Authorization'] = `Bearer ${tokens.access_token}`;
    return reqConfig;
  });

  // Response interceptor: retry once on 401
  sdkClient.instance.interceptors.response.use(undefined, async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      const tokens = await refreshPromise;
      if (tokens) {
        originalRequest.headers['Authorization'] = `Bearer ${tokens.access_token}`;
        return sdkClient.instance(originalRequest);
      }
    }
    return Promise.reject(error);
  });

  // Intercept token/login/signup responses to auto-save tokens
  sdkClient.instance.interceptors.response.use((response) => {
    const url = response.config.url || '';
    if (url.includes('/oauth/token') || url.includes('/oauth/authorize/login') || url.includes('/oauth/authorize/signup')) {
      if (response.data?.access_token) {
        saveTokens(response.data);
      }
    }
    return response;
  });
}
