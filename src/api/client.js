const AUTH_TOKEN_STORAGE_KEY = "talgarclean.authToken";

export function getStoredAuthToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return String(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "");
}

export function persistAuthToken(token) {
  if (typeof window === "undefined") {
    return "";
  }

  const normalizedToken = String(token || "").trim();

  if (normalizedToken) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalizedToken);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }

  return normalizedToken;
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

async function request(path, options = {}, token = "") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Сервер не отвечает. Подожди немного и попробуй снова.");
    }
    throw err;
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    let message = "Request failed.";

    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function createApi(token = "") {
  return {
    login(payload) {
      return request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    getSession() {
      return request("/api/auth/session", {}, token);
    },

    getBootstrap() {
      return request("/api/bootstrap", {}, token);
    },

    createDriver(payload) {
      return request(
        "/api/drivers",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
    },

    updateDriver(driverName, patch) {
      return request(
        `/api/drivers/${encodeURIComponent(driverName)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
        token
      );
    },

    updateDriverLocation(driverName, payload) {
      return request(
        `/api/drivers/${encodeURIComponent(driverName)}/location`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
    },

    deleteDriver(driverName) {
      return request(
        `/api/drivers/${encodeURIComponent(driverName)}`,
        {
          method: "DELETE",
        },
        token
      );
    },

    createTask(payload) {
      return request(
        "/api/tasks",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
    },

    updateTask(taskId, patch) {
      return request(
        `/api/tasks/${taskId}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
        token
      );
    },

    resetTask(taskId) {
      return request(
        `/api/tasks/${taskId}/reset`,
        {
          method: "POST",
        },
        token
      );
    },

    deleteTask(taskId) {
      return request(
        `/api/tasks/${taskId}`,
        {
          method: "DELETE",
        },
        token
      );
    },
  };
}
