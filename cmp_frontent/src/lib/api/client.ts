/**
 * The HTTP client. One place that knows how to talk to the API.
 *
 * Four things happen here so that no component has to think about them:
 *
 * 1. **Credentials travel.** The session is an HttpOnly cookie, so `withCredentials`
 *    is on for every request and the token is never touched by JavaScript.
 * 2. **CSRF is automatic.** Unsafe verbs get the double-submit header, read from
 *    the readable CSRF cookie. Forgetting it once produces a 403 that looks like
 *    a permissions bug and wastes an afternoon.
 * 3. **Errors are normalised.** Every failure becomes an `ApiError` with the
 *    server's code, field and request id, so no component parses a response body.
 * 4. **401 is handled once.** A dead session redirects to sign-in from here,
 *    rather than from thirty different catch blocks.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

import { ApiError, type ApiErrorBody, networkError } from "@/lib/errors";
import { config } from "@/lib/config";

const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** Read a cookie by name. Only used for the CSRF cookie, which is deliberately
 *  script-readable - that is the whole mechanism. */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** Called when the server says the session is gone. Set by the auth provider so
 *  this module does not need to import React or the router. */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

export const http: AxiosInstance = axios.create({
  baseURL: config.apiUrl,
  withCredentials: true,
  timeout: 30_000, // never infinite: a hung request is a spinner nobody can cancel
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  // Cursors and filters can contain characters axios would otherwise mangle.
  paramsSerializer: { indexes: null },
});

/* ------------------------------------------------------------------ request */
http.interceptors.request.use((request: InternalAxiosRequestConfig) => {
  const method = (request.method ?? "get").toLowerCase();

  if (UNSAFE_METHODS.has(method)) {
    const token = readCookie(config.csrfCookie);
    if (token) request.headers.set(config.csrfHeader, token);
  }

  // Correlates this request with the server's log line for it.
  request.headers.set("X-Request-ID", requestId());

  // Let the browser set the boundary for multipart uploads.
  if (request.data instanceof FormData) {
    request.headers.delete("Content-Type");
  }

  return request;
});

/* ----------------------------------------------------------------- response */
http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiErrorBody }>) => {
    if (!error.response) {
      const message =
        error.code === "ECONNABORTED"
          ? "The request timed out. Try again."
          : "Could not reach the server.";
      return Promise.reject(networkError(message));
    }

    const { status, data } = error.response;
    const body: ApiErrorBody = data?.error ?? {
      code: "unexpected_response",
      message: error.message || "Request failed",
      request_id: (error.response.headers?.["x-request-id"] as string) ?? "-",
    };

    const apiError = new ApiError(status, body);

    // One redirect, from one place. `needsMfa` is excluded: the MFA screen is a
    // legitimate destination, not a lost session.
    if (apiError.isAuthError && !apiError.needsMfa && onUnauthenticated) {
      onUnauthenticated();
    }

    return Promise.reject(apiError);
  },
);

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* -------------------------------------------------------------------- verbs */
export async function apiGet<T>(url: string, cfg?: AxiosRequestConfig): Promise<T> {
  const { data } = await http.get<T>(url, cfg);
  return data;
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  cfg?: AxiosRequestConfig,
): Promise<T> {
  const { data } = await http.post<T>(url, body, cfg);
  return data;
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  cfg?: AxiosRequestConfig,
): Promise<T> {
  const { data } = await http.put<T>(url, body, cfg);
  return data;
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  cfg?: AxiosRequestConfig,
): Promise<T> {
  const { data } = await http.patch<T>(url, body, cfg);
  return data;
}

export async function apiDelete<T>(url: string, cfg?: AxiosRequestConfig): Promise<T> {
  const { data } = await http.delete<T>(url, cfg);
  return data;
}

/**
 * Download a file the API returns as an attachment.
 *
 * Kept here rather than in a component because the interesting part is the
 * headers: exports carry a staleness warning and both the recorded and served
 * SHA-256, and a caller that ignores those is handing someone a file whose
 * provenance they cannot check.
 */
export async function apiDownload(url: string): Promise<{
  blob: Blob;
  filename: string;
  generatedAt?: string;
  ageDays?: number;
  stalenessWarning?: string;
  recordedHash?: string;
  contentHash?: string;
}> {
  const response = await http.get(url, { responseType: "blob" });
  const disposition = String(response.headers["content-disposition"] ?? "");
  const match = disposition.match(/filename="?([^"]+)"?/);

  return {
    blob: response.data as Blob,
    filename: match?.[1] ?? "download",
    generatedAt: response.headers["x-export-generated-at"] as string | undefined,
    ageDays: response.headers["x-export-age-days"]
      ? Number(response.headers["x-export-age-days"])
      : undefined,
    stalenessWarning: response.headers["x-export-staleness-warning"] as string | undefined,
    recordedHash: response.headers["x-recorded-sha256"] as string | undefined,
    contentHash: response.headers["x-content-sha256"] as string | undefined,
  };
}

/** Build a query string, dropping empty values so `?status=` never reaches the
 *  API - it would be rejected as an unknown filter value rather than ignored. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}
