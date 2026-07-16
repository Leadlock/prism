const API_URL = import.meta.env.VITE_API_URL || "";

export const apiFetch = async (path, options = {}) => {
  const { token, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...fetchOptions.headers
  };
  
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    if (response.status === 403 && error.code) {
      if (["COMPANY_REJECTED", "COMPANY_SUSPENDED"].includes(error.code)) {
        window.dispatchEvent(new CustomEvent("auth:company-blocked", { detail: { code: error.code, message: error.error } }));
      } else if (["TRIAL_EXPIRED", "SUBSCRIPTION_EXPIRED"].includes(error.code)) {
        window.dispatchEvent(new CustomEvent("auth:billing-blocked", { detail: { code: error.code, message: error.error } }));
      }
    }
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
};

export const apiUpload = async (path, file, body = {}, token) => {
  const form = new FormData();
  if (file) form.append("file", file);
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.append(k, v);
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: form
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
};

export const apiDownload = (path, token) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return `${API_URL}${path}`; // frontend can open this URL with Authorization header via fetch if needed
};
