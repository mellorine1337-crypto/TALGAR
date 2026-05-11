export const STATUS_OPTIONS = [
  { value: "pending", label: "Ожидает" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Завершено" },
];

const STATUS_PRIORITY = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

function parseCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseRouteOrder(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function buildTaskId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return String(Date.now());
}

function getRouteRank(task) {
  return task.routeOrder ?? Number.MAX_SAFE_INTEGER;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

export function getStatusText(status) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label || status;
}

export function getSourceText(source) {
  return source === "telegram" ? "Telegram" : "Панель";
}

export function getReporterText(task) {
  if (task.source !== "telegram") {
    return "Создано диспетчером";
  }

  if (task.reporterUsername) {
    return `Telegram: @${task.reporterUsername}`;
  }

  return `Telegram: ${task.reporterName || "пользователь"}`;
}

export function hasCoordinates(task) {
  return Number.isFinite(task.lat) && Number.isFinite(task.lon);
}

export function normalizeTask(task, fallbackDriver = "") {
  const assignedDriver = task.assignedDriver || fallbackDriver || "";

  return {
    id: task.id ?? buildTaskId(),
    address: task.address?.trim() || "Без адреса",
    lat: parseCoordinate(task.lat),
    lon: parseCoordinate(task.lon),
    comment: task.comment?.trim() || "",
    assignedDriver,
    routeOrder: assignedDriver ? parseRouteOrder(task.routeOrder) : null,
    status: task.status || "pending",
    beforePhoto: task.beforePhoto || null,
    afterPhoto: task.afterPhoto || null,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    createdAt: task.createdAt || new Date().toISOString(),
    source: task.source || "dispatcher",
    reporterName: task.reporterName || "",
    reporterUsername: task.reporterUsername || "",
    reporterChatId: task.reporterChatId ?? null,
  };
}

export function buildNewTask(payload, fallbackDriver = "") {
  return normalizeTask(
    {
      ...payload,
      id: buildTaskId(),
      status: payload.status || "pending",
      beforePhoto: payload.beforePhoto || null,
      afterPhoto: payload.afterPhoto || null,
      startedAt: payload.startedAt || null,
      finishedAt: payload.finishedAt || null,
      createdAt: payload.createdAt || new Date().toISOString(),
      source: payload.source || "dispatcher",
    },
    payload.assignedDriver || fallbackDriver
  );
}

export function buildStatusPatch(task, nextStatus) {
  const now = new Date().toISOString();

  if (nextStatus === "pending") {
    return {
      status: "pending",
      startedAt: null,
      finishedAt: null,
    };
  }

  if (nextStatus === "in_progress") {
    return {
      status: "in_progress",
      startedAt: task.startedAt || now,
      finishedAt: null,
    };
  }

  if (nextStatus === "completed") {
    return {
      status: "completed",
      startedAt: task.startedAt || now,
      finishedAt: task.finishedAt || now,
    };
  }

  return { status: nextStatus };
}

export function sortDispatcherTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftUnassigned = left.assignedDriver ? 1 : 0;
    const rightUnassigned = right.assignedDriver ? 1 : 0;

    if (leftUnassigned !== rightUnassigned) {
      return leftUnassigned - rightUnassigned;
    }

    const statusDelta =
      (STATUS_PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
      (STATUS_PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER);

    if (statusDelta !== 0) {
      return statusDelta;
    }

    const routeDelta = getRouteRank(left) - getRouteRank(right);

    if (routeDelta !== 0) {
      return routeDelta;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

export function sortDriverTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftCompleted = left.status === "completed" ? 1 : 0;
    const rightCompleted = right.status === "completed" ? 1 : 0;

    if (leftCompleted !== rightCompleted) {
      return leftCompleted - rightCompleted;
    }

    const routeDelta = getRouteRank(left) - getRouteRank(right);

    if (routeDelta !== 0) {
      return routeDelta;
    }

    const statusDelta =
      (STATUS_PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
      (STATUS_PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER);

    if (statusDelta !== 0) {
      return statusDelta;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}
