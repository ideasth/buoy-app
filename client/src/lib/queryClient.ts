import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const TOKEN_KEY = "anchor_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getStoredToken();
  if (token) {
    // Send via headers as well — these are stripped by the deploy_website
    // proxy but work on a published pplx.app URL or direct localhost calls.
    headers["X-Anchor-Token"] = token;
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

// Append ?t=<token> to API URLs. Required to authenticate through the
// deploy_website proxy, which strips Cookie / Authorization / X-Anchor-Token.
// Public/auth endpoints (status, login, setup) don't need it but accepting
// the param does no harm so we always append when a token is present.
function withAuthQuery(url: string): string {
  const token = getStoredToken();
  if (!token) return url;
  // Don't double-add
  if (/[?&]t=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${encodeURIComponent(token)}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function handleAuthFailure(res: Response) {
  if (res.status === 401) {
    // Token invalid/expired — clear so Login.tsx re-prompts.
    setStoredToken(null);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = buildHeaders(data ? { "Content-Type": "application/json" } : undefined);
  const res = await fetch(`${API_BASE}${withAuthQuery(url)}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "omit",
  });

  if (!res.ok) handleAuthFailure(res);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${withAuthQuery(queryKey.join("/"))}`, {
      credentials: "omit",
      headers: buildHeaders(),
    });

    if (res.status === 401) {
      handleAuthFailure(res);
      if (unauthorizedBehavior === "returnNull") return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
