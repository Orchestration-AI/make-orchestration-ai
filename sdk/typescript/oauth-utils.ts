import type { Client } from './client';
import type { OAuthTokenResponse } from './types.gen';
import { oAuthToken } from './sdk.gen';

const STORAGE_KEY = 'oai_oauth_tokens';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  expires_at: number;
}

export interface OAuthConfig {
  client_id: string;
  client_secret: string;
  scope?: string;
}

export interface OAuthBrowserConfig {
  client_id: string;
  redirect_uri: string;
  scope?: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function toTokens(tokenResponse: OAuthTokenResponse): OAuthTokens | null {
  if (!tokenResponse?.access_token) return null;
  return {
    access_token: tokenResponse.access_token!,
    refresh_token: tokenResponse.refresh_token,
    token_type: tokenResponse.token_type || 'Bearer',
    expires_in: tokenResponse.expires_in || 3600,
    scope: tokenResponse.scope,
    expires_at: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
  };
}

function isTokenExpired(tokens: OAuthTokens): boolean {
  return Date.now() >= tokens.expires_at - 30_000;
}

// --- Browser: token storage ---

export function saveLogin(tokens: OAuthTokens): void {
  if (isBrowser()) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function getCurrentLogin(): OAuthTokens | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoginExpired(): boolean {
  const tokens = getCurrentLogin();
  if (!tokens) return true;
  return isTokenExpired(tokens);
}

export function logout(): void {
  if (isBrowser()) localStorage.removeItem(STORAGE_KEY);
}

// --- Browser: OAuth redirect flow ---

export function initiateLogin(baseUrl: string, config: OAuthBrowserConfig, state?: string): void {
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

// --- Browser: attach stored token to requests ---

export interface BrowserAuthOptions {
  onRefreshToken?: () => Promise<OAuthTokens | null>;
}

export function setupBrowserAuth(sdkClient: Client, options?: BrowserAuthOptions): void {
  if (!isBrowser()) return;

  let refreshPromise: Promise<OAuthTokens | null> | null = null;

  async function refresh(): Promise<OAuthTokens | null> {
    if (!options?.onRefreshToken) return null;
    try {
      const tokens = await options.onRefreshToken();
      if (tokens) saveLogin(tokens);
      return tokens;
    } catch { return null; }
  }

  sdkClient.instance.interceptors.request.use(async (reqConfig) => {
    let tokens = getCurrentLogin();
    if (!tokens) return reqConfig;

    if (isTokenExpired(tokens) && options?.onRefreshToken) {
      if (!refreshPromise) refreshPromise = refresh().finally(() => { refreshPromise = null; });
      tokens = await refreshPromise;
      if (!tokens) return reqConfig;
    }

    if (tokens && !isTokenExpired(tokens)) {
      reqConfig.headers = reqConfig.headers || {};
      reqConfig.headers['Authorization'] = `Bearer ${tokens.access_token}`;
    }
    return reqConfig;
  });

  if (options?.onRefreshToken) {
    sdkClient.instance.interceptors.response.use(undefined, async (error) => {
      const originalRequest = error.config;
      if (error.response?.status === 401 && !originalRequest._retried) {
        originalRequest._retried = true;
        if (!refreshPromise) refreshPromise = refresh().finally(() => { refreshPromise = null; });
        const tokens = await refreshPromise;
        if (tokens) {
          originalRequest.headers['Authorization'] = `Bearer ${tokens.access_token}`;
          return sdkClient.instance(originalRequest);
        }
      }
      return Promise.reject(error);
    });
  }
}

// --- Node.js: client_credentials flow ---

export function setupClientCredentials(sdkClient: Client, config: OAuthConfig): void {
  let tokens: OAuthTokens | null = null;
  let refreshPromise: Promise<OAuthTokens | null> | null = null;

  async function fetchToken(): Promise<OAuthTokens | null> {
    try {
      const response = await oAuthToken({
        client: sdkClient,
        body: {
          grant_type: 'client_credentials',
          client_id: config.client_id,
          client_secret: config.client_secret,
          ...(config.scope && { scope: config.scope }),
        },
      });
      if (response.error) return null;
      tokens = toTokens(response.data as OAuthTokenResponse);
      return tokens;
    } catch { return null; }
  }

  sdkClient.instance.interceptors.request.use(async (reqConfig) => {
    if (!tokens || isTokenExpired(tokens)) {
      if (!refreshPromise) refreshPromise = fetchToken().finally(() => { refreshPromise = null; });
      tokens = await refreshPromise;
    }
    if (tokens) {
      reqConfig.headers = reqConfig.headers || {};
      reqConfig.headers['Authorization'] = `Bearer ${tokens.access_token}`;
    }
    return reqConfig;
  });

  sdkClient.instance.interceptors.response.use(undefined, async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;
      if (!refreshPromise) refreshPromise = fetchToken().finally(() => { refreshPromise = null; });
      tokens = await refreshPromise;
      if (tokens) {
        originalRequest.headers['Authorization'] = `Bearer ${tokens.access_token}`;
        return sdkClient.instance(originalRequest);
      }
    }
    return Promise.reject(error);
  });
}
