const API_BASE = resolveApiBase();

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!configured) return import.meta.env.DEV ? 'http://localhost:3000/api' : '/api';
  return import.meta.env.PROD && isLoopbackApi(configured) ? '/api' : configured.replace(/\/$/, '');
}

function isLoopbackApi(value: string) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export async function apiUploadImage(file: File): Promise<{ path: string }> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE}/uploads/images`, { method: 'POST', body, credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || '图片上传失败');
  return payload.data as { path: string };
}

export function assetUrl(path: string) {
  return `${API_BASE.replace(/\/api\/?$/, '')}${path}`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || '请求失败');
  }
  return payload.data as T;
}

export function authStartUrl(provider: 'natayarkid', mode: 'login' | 'link' = 'login') {
  return `${API_BASE}/auth/${provider}${mode === 'link' ? '/link' : ''}/start`;
}
