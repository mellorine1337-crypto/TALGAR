import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDispatcherCredentials,
  issueAuthToken,
  normalizeDispatcherLogin,
  normalizePlateNumber,
  verifyAuthToken,
  verifyPassword,
} from "./auth.js";
import {
  createTask,
  createDriver,
  createTaskFromTelegram,
  deleteDriver,
  deleteTask,
  findDriverByLogin,
  getStore,
  getTaskById,
  markTelegramUpdateHandled,
  resetTask,
  updateDriver,
  updateDriverLocation,
  updateTask,
} from "./store.js";
import { ensureDatabaseSchema } from "./db.js";
import { startTelegramBot } from "./telegramBot.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const UPLOADS_DIR = String(process.env.UPLOADS_DIR || "").trim() || path.join(__dirname, "uploads");
const HAS_DIST = existsSync(DIST_DIR);
const EMPTY_BOT_STATE = {
  configured: false,
  running: false,
  lastMessageAt: null,
  lastError: null,
};

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use("/api/uploads", express.static(UPLOADS_DIR));

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createBadRequest(message) {
  return createHttpError(message, 400);
}

function createUnauthorized(message = "Нужно войти в систему.") {
  return createHttpError(message, 401);
}

function createForbidden(message = "Недостаточно прав.") {
  return createHttpError(message, 403);
}

function createNotFound(message) {
  return createHttpError(message, 404);
}

function parseCoordinate(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue =
    typeof value === "string" ? Number(value.trim().replace(",", ".")) : Number(value);

  if (!Number.isFinite(numberValue)) {
    throw createBadRequest(`${fieldLabel} должна быть числом.`);
  }

  return numberValue;
}

function validateCoordinates(lat, lon) {
  if (lat !== null && (lat < -90 || lat > 90)) {
    throw createBadRequest("Широта вне допустимого диапазона.");
  }

  if (lon !== null && (lon < -180 || lon > 180)) {
    throw createBadRequest("Долгота вне допустимого диапазона.");
  }
}

function parseRouteOrder(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createBadRequest("Порядок в маршруте должен быть положительным числом.");
  }

  return parsed;
}

function parseOptionalMetric(value, fieldLabel, { min = null, max = null } = {}) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw createBadRequest(`${fieldLabel} должно быть числом.`);
  }

  if (min !== null && parsed < min) {
    throw createBadRequest(`${fieldLabel} вне допустимого диапазона.`);
  }

  if (max !== null && parsed > max) {
    throw createBadRequest(`${fieldLabel} вне допустимого диапазона.`);
  }

  return parsed;
}

function sanitizeTaskPayload(body, { requireAddress = false } = {}) {
  const payload = {};
  const hasLat = Object.prototype.hasOwnProperty.call(body, "lat");
  const hasLon = Object.prototype.hasOwnProperty.call(body, "lon");

  if (hasLat !== hasLon) {
    throw createBadRequest("Для координат нужно передать и широту, и долготу.");
  }

  if (requireAddress || Object.prototype.hasOwnProperty.call(body, "address")) {
    const address = String(body.address || "").trim();

    if (!address) {
      throw createBadRequest("Адрес обязателен.");
    }

    payload.address = address;
  }

  if (Object.prototype.hasOwnProperty.call(body, "comment")) {
    payload.comment = String(body.comment || "").trim();
  }

  if (requireAddress || hasLat) {
    payload.lat = parseCoordinate(body.lat, "Широта");
  }

  if (requireAddress || hasLon) {
    payload.lon = parseCoordinate(body.lon, "Долгота");
  }

  validateCoordinates(payload.lat ?? null, payload.lon ?? null);

  if (Object.prototype.hasOwnProperty.call(body, "assignedDriver")) {
    payload.assignedDriver = String(body.assignedDriver || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, "routeOrder")) {
    payload.routeOrder = parseRouteOrder(body.routeOrder);
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    payload.status = String(body.status || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, "beforePhoto")) {
    payload.beforePhoto = body.beforePhoto || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "afterPhoto")) {
    payload.afterPhoto = body.afterPhoto || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "startedAt")) {
    payload.startedAt = body.startedAt || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "finishedAt")) {
    payload.finishedAt = body.finishedAt || null;
  }

  return payload;
}

function sanitizeDriverPayload(body) {
  return {
    name: String(body?.name || "").trim(),
    plateNumber: normalizePlateNumber(body?.plateNumber),
    password: String(body?.password || ""),
  };
}

function sanitizeDriverLocationPayload(body) {
  const payload = {
    lat: parseCoordinate(body?.lat, "Широта"),
    lon: parseCoordinate(body?.lon, "Долгота"),
    accuracy: parseOptionalMetric(body?.accuracy, "Точность", { min: 0 }),
    heading: parseOptionalMetric(body?.heading, "Курс", { min: 0, max: 360 }),
    speed: parseOptionalMetric(body?.speed, "Скорость", { min: 0 }),
  };

  validateCoordinates(payload.lat, payload.lon);

  return payload;
}

function sanitizeDriverTaskPatch(body) {
  const allowedKeys = new Set([
    "status",
    "beforePhoto",
    "afterPhoto",
    "startedAt",
    "finishedAt",
  ]);
  const receivedKeys = Object.keys(body || {});
  const forbiddenKeys = receivedKeys.filter((key) => !allowedKeys.has(key));

  if (forbiddenKeys.length > 0) {
    throw createForbidden("Водитель не может менять адрес, маршрут или назначение.");
  }

  return sanitizeTaskPayload(body || {});
}

function getTokenFromRequest(request) {
  const header = String(request.headers.authorization || "");

  if (!header.startsWith("Bearer ")) {
    return "";
  }

  return header.slice("Bearer ".length).trim();
}

function attachAuth(request, response, next) {
  const token = getTokenFromRequest(request);

  if (!token) {
    next();
    return;
  }

  const session = verifyAuthToken(token);

  if (!session) {
    next(createUnauthorized("Сессия истекла. Войди заново."));
    return;
  }

  request.auth = session;
  next();
}

function requireAuth(request, response, next) {
  if (!request.auth) {
    next(createUnauthorized("Нужно войти в систему."));
    return;
  }

  next();
}

function requireDispatcher(request, response, next) {
  if (!request.auth) {
    next(createUnauthorized("Нужно войти в систему."));
    return;
  }

  if (request.auth.role !== "dispatcher") {
    next(createForbidden("Этот раздел доступен только диспетчеру."));
    return;
  }

  next();
}

function scopeStoreForAuth(store, auth) {
  if (!auth || auth.role === "dispatcher") {
    return store;
  }

  return {
    ...store,
    drivers: store.drivers.filter((driver) => driver === auth.driverName),
    tasks: store.tasks.filter((task) => task.assignedDriver === auth.driverName),
    fleet: (store.fleet || []).filter((item) => item.name === auth.driverName),
  };
}

function buildApiResponse(store, botStatus, auth = null) {
  return {
    drivers: store.drivers,
    tasks: store.tasks,
    fleet: store.fleet || [],
    bot: auth?.role === "dispatcher" ? botStatus : EMPTY_BOT_STATE,
  };
}

async function getOwnedTask(taskId, auth) {
  const task = await getTaskById(taskId);

  if (!task) {
    throw createNotFound("Заявка не найдена.");
  }

  if (auth.role === "dispatcher") {
    return task;
  }

  if (task.assignedDriver !== auth.driverName) {
    throw createForbidden("Нельзя работать с чужой заявкой.");
  }

  return task;
}

function createAuthSession({ role, login, driverName = null }) {
  return {
    role,
    login,
    driverName,
  };
}

const bot = startTelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN || "",
  async getLastUpdateId() {
    const store = await getStore();
    return store.meta.lastTelegramUpdateId || 0;
  },
  async onTaskReceived(updateId, payload) {
    await createTaskFromTelegram(updateId, payload);
  },
  async onUpdateHandled(updateId) {
    await markTelegramUpdateHandled(updateId);
  },
});

app.get("/healthz", async (request, response, next) => {
  try {
    await ensureDatabaseSchema();
    response.json({
      ok: true,
      bot: bot.getStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const login = String(request.body?.login || "").trim();
    const password = String(request.body?.password || "");

    if (!login || !password) {
      throw createBadRequest("Укажи логин и пароль.");
    }

    const dispatcher = getDispatcherCredentials();

    if (
      normalizeDispatcherLogin(login) === dispatcher.login &&
      password === dispatcher.password
    ) {
      const session = createAuthSession({
        role: "dispatcher",
        login: dispatcher.login,
      });

      response.json({
        token: issueAuthToken(session),
        session,
      });
      return;
    }

    const driver = await findDriverByLogin(login);

    if (!driver || !verifyPassword(password, driver.passwordHash)) {
      throw createUnauthorized("Неверный логин или пароль.");
    }

    const session = createAuthSession({
      role: "driver",
      login: driver.plateNumber,
      driverName: driver.name,
    });

    response.json({
      token: issueAuthToken(session),
      session,
    });
  } catch (error) {
    next(error);
  }
});

app.use(attachAuth);

app.get("/api/auth/session", requireAuth, (request, response) => {
  response.json({ session: request.auth });
});

app.get("/api/bootstrap", requireAuth, async (request, response, next) => {
  try {
    const store = await getStore();
    const scopedStore = scopeStoreForAuth(store, request.auth);
    response.json(buildApiResponse(scopedStore, bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", requireDispatcher, async (request, response, next) => {
  try {
    const payload = sanitizeTaskPayload(request.body, { requireAddress: true });
    const { store } = await createTask(payload);
    response
      .status(201)
      .json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.post("/api/drivers", requireDispatcher, async (request, response, next) => {
  try {
    const payload = sanitizeDriverPayload(request.body);
    const { store } = await createDriver(payload);
    response
      .status(201)
      .json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/drivers/:driverName", requireDispatcher, async (request, response, next) => {
  try {
    const payload = sanitizeDriverPayload(request.body);
    const { store } = await updateDriver(request.params.driverName, payload);
    response.json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.post("/api/drivers/:driverName/location", requireAuth, async (request, response, next) => {
  try {
    if (
      request.auth.role === "driver" &&
      request.auth.driverName !== request.params.driverName
    ) {
      throw createForbidden("Нельзя отправлять геопозицию за другую машину.");
    }

    const payload = sanitizeDriverLocationPayload(request.body);
    await updateDriverLocation(request.params.driverName, payload);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/drivers/:driverName", requireDispatcher, async (request, response, next) => {
  try {
    const { store } = await deleteDriver(request.params.driverName);
    response.json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:taskId", requireAuth, async (request, response, next) => {
  try {
    await getOwnedTask(request.params.taskId, request.auth);
    const payload =
      request.auth.role === "dispatcher"
        ? sanitizeTaskPayload(request.body)
        : sanitizeDriverTaskPatch(request.body);
    const { store } = await updateTask(request.params.taskId, payload);
    response.json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:taskId/reset", requireAuth, async (request, response, next) => {
  try {
    await getOwnedTask(request.params.taskId, request.auth);
    const { store } = await resetTask(request.params.taskId);
    response.json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:taskId", requireDispatcher, async (request, response, next) => {
  try {
    const { store } = await deleteTask(request.params.taskId);
    response.json(buildApiResponse(scopeStoreForAuth(store, request.auth), bot.getStatus(), request.auth));
  } catch (error) {
    next(error);
  }
});

if (HAS_DIST) {
  app.use(express.static(DIST_DIR));

  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const statusCode = error.statusCode || 500;
  const message =
    statusCode >= 500 ? "Внутренняя ошибка сервера." : error.message;

  if (statusCode >= 500) {
    console.error(error);
  }

  response.status(statusCode).json({ message });
});

await ensureDatabaseSchema();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server is running on http://0.0.0.0:${PORT}`);
});

function shutdown() {
  bot.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
