// Central API client: attaches the demo token and normalizes errors.

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function token(): string | null {
  try {
    return localStorage.getItem("scq_token");
  } catch {
    return null;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError("Cannot reach the server. Check that the backend is running.", 0);
  }

  if (res.status === 401 && !path.includes("/auth/login")) {
    localStorage.removeItem("scq_token");
    localStorage.removeItem("scq_user");
    // Let the router's auth guard redirect on next render.
    window.dispatchEvent(new Event("scq-unauthorized"));
    throw new ApiError("Session expired — please sign in again.", 401);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.message || body.detail || message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const t = token();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form, headers });
  if (!res.ok) {
    let message = "Import failed";
    try {
      const body = await res.json();
      message = body.message || body.detail || message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export async function downloadCsv(entity: string): Promise<void> {
  const t = token();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}/export/${entity}`, { headers });
  if (!res.ok) throw new ApiError("Export failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entity}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Re-downloads an import's original file with the auth header, honoring the server filename. */
export async function downloadImportFile(id: number, fallbackName: string): Promise<void> {
  const t = token();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}/import/history/${id}/file`, { headers });
  if (!res.ok) throw new ApiError("Could not retrieve the original file", res.status);
  const blob = await res.blob();
  const dispo = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(dispo);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
