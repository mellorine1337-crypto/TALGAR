import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, normalizePlateNumber } from "./auth.js";
import { query, withTransaction } from "./db.js";
import { archivePhoto } from "./photoArchive.js";
import { buildNewTask, normalizeTask } from "../src/utils/taskHelpers.js";

let writeQueue = Promise.resolve();
let runtimeSchemaReady = false;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
const PUBLIC_UPLOADS_PREFIX = "/api/uploads";
const ONLINE_THRESHOLD_MS = 90 * 1000;
const MAX_BETA_DRIVERS = 4;

function clone(value) {
  return structuredClone(value);
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createNotFoundError(message) {
  return createHttpError(message, 404);
}

function createBadRequestError(message) {
  return createHttpError(message, 400);
}

function getTodayLabel() {
  return new Date().toLocaleDateString("ru-RU");
}

function toIso(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function toDbTimestamp(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function isPublicUploadPath(value) {
  return typeof value === "string" && value.startsWith(`${PUBLIC_UPLOADS_PREFIX}/`);
}

function publicUploadPath(taskId, fileName) {
  return `${PUBLIC_UPLOADS_PREFIX}/tasks/${encodeURIComponent(String(taskId))}/${fileName}`;
}

function parseDataUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/s);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2],
  };
}

function extensionFromMimeType(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  return map[mimeType] || ".jpg";
}

async function deleteStoredPhoto(value) {
  if (!isPublicUploadPath(value)) {
    return;
  }

  const relativePath = value.replace(`${PUBLIC_UPLOADS_PREFIX}/`, "");
  const filePath = path.join(UPLOADS_DIR, relativePath);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files or cleanup races.
  }
}

async function storePhoto(task, fieldName, value, previousValue = null) {
  const taskId = task.id;

  if (value === null || value === undefined || value === "") {
    await deleteStoredPhoto(previousValue);
    return null;
  }

  if (isPublicUploadPath(value)) {
    if (previousValue && previousValue !== value) {
      await deleteStoredPhoto(previousValue);
    }

    return value;
  }

  const parsed = parseDataUrl(value);

  if (!parsed) {
    return value;
  }

  const taskFolder = path.join(UPLOADS_DIR, "tasks", String(taskId));
  await mkdir(taskFolder, { recursive: true });

  const extension = extensionFromMimeType(parsed.mimeType);
  const fileName = `${fieldName}-${Date.now()}${extension}`;
  const filePath = path.join(taskFolder, fileName);
  const publicPath = publicUploadPath(taskId, fileName);
  const buffer = Buffer.from(parsed.base64, "base64");

  await writeFile(filePath, buffer);

  try {
    await archivePhoto({
      taskId,
      fieldName,
      mimeType: parsed.mimeType,
      extension,
      buffer,
    });
  } catch (error) {
    await deleteStoredPhoto(publicPath);
    throw error;
  }

  await deleteStoredPhoto(previousValue);

  return publicPath;
}

function rowToTask(row) {
  return normalizeTask(
    {
      id: row.id,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      comment: row.comment,
      assignedDriver: row.assigned_driver_name || "",
      routeOrder: row.route_order,
      status: row.status,
      beforePhoto: row.before_photo,
      afterPhoto: row.after_photo,
      startedAt: toIso(row.started_at),
      finishedAt: toIso(row.finished_at),
      createdAt: toIso(row.created_at),
      source: row.source,
      reporterName: row.reporter_name,
      reporterUsername: row.reporter_username,
      reporterChatId: row.reporter_chat_id,
    },
    row.assigned_driver_name || ""
  );
}

async function buildTaskRecord(task, previousTask = null) {
  return {
    id: task.id,
    address: task.address,
    lat: task.lat,
    lon: task.lon,
    comment: task.comment,
    assigned_driver_name: task.assignedDriver || null,
    route_order: task.routeOrder ?? null,
    status: task.status,
    before_photo: await storePhoto(
      task,
      "before",
      task.beforePhoto,
      previousTask?.beforePhoto || null
    ),
    after_photo: await storePhoto(
      task,
      "after",
      task.afterPhoto,
      previousTask?.afterPhoto || null
    ),
    started_at: toDbTimestamp(task.startedAt),
    finished_at: toDbTimestamp(task.finishedAt),
    source: task.source,
    reporter_name: task.reporterName || "",
    reporter_username: task.reporterUsername || "",
    reporter_chat_id: task.reporterChatId ?? null,
  };
}

async function ensureBotState(client) {
  await client.query(
    `INSERT INTO bot_state (id, last_telegram_update_id, last_bot_message_at)
     VALUES (1, 0, NULL)
     ON CONFLICT (id) DO NOTHING`
  );
}

async function ensureRuntimeSchema(client) {
  if (runtimeSchemaReady) {
    return;
  }

  await client.query(
    `ALTER TABLE drivers
     ADD COLUMN IF NOT EXISTS plate_number TEXT NOT NULL DEFAULT ''`
  );

  await client.query(
    `ALTER TABLE drivers
     ADD COLUMN IF NOT EXISTS driver_password_hash TEXT NOT NULL DEFAULT ''`
  );

  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS drivers_plate_number_unique
     ON drivers (plate_number)
     WHERE plate_number <> ''`
  );

  await client.query(
    `CREATE TABLE IF NOT EXISTS driver_locations (
      driver_name TEXT PRIMARY KEY REFERENCES drivers(name) ON UPDATE CASCADE ON DELETE CASCADE,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION NULL,
      heading DOUBLE PRECISION NULL,
      speed DOUBLE PRECISION NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await client.query(
    `CREATE INDEX IF NOT EXISTS driver_locations_updated_at_idx
     ON driver_locations (updated_at DESC)`
  );

  runtimeSchemaReady = true;
}

async function getActiveDrivers(client) {
  const { rows } = await client.query(
    `SELECT name
     FROM drivers
     WHERE is_active = TRUE
     ORDER BY sort_order ASC, name ASC, id ASC`
  );

  return rows.map((row) => String(row.name));
}

async function getActiveDriversCount(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM drivers
     WHERE is_active = TRUE`
  );

  return Number(rows[0]?.count || 0);
}

async function getNextDriverSortOrder(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
     FROM drivers`
  );

  return Number(rows[0]?.next_sort_order || 1);
}

async function plateNumberExists(client, plateNumber, excludeDriverName = "") {
  if (!plateNumber) {
    return false;
  }

  const { rows } = await client.query(
    `SELECT 1
     FROM drivers
     WHERE plate_number = $1
       AND ($2 = '' OR name <> $2)
     LIMIT 1`,
    [plateNumber, excludeDriverName]
  );

  return Boolean(rows[0]);
}

async function reindexRoutes(client) {
  const drivers = await getActiveDrivers(client);

  for (const driver of drivers) {
    const { rows } = await client.query(
      `SELECT id
       FROM tasks
       WHERE assigned_driver_name = $1
       ORDER BY route_order ASC NULLS LAST, created_at ASC, id ASC`,
      [driver]
    );

    await client.query(
      `UPDATE tasks
       SET route_order = NULL,
           updated_at = NOW()
       WHERE assigned_driver_name = $1`,
      [driver]
    );

    for (let index = 0; index < rows.length; index += 1) {
      await client.query(
        `UPDATE tasks
         SET route_order = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [rows[index].id, index + 1]
      );
    }
  }

  await client.query(
    `UPDATE tasks
     SET route_order = NULL,
         updated_at = NOW()
     WHERE assigned_driver_name IS NULL`
  );
}

async function needsRouteReindex(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM tasks
     WHERE assigned_driver_name IS NOT NULL
       AND route_order IS NULL`
  );

  return Number(rows[0]?.count || 0) > 0;
}

function getNextTaskForDriver(tasks) {
  return [...tasks]
    .filter((task) => task.status !== "completed")
    .sort((left, right) => {
      const leftRoute = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
      const rightRoute = right.routeOrder ?? Number.MAX_SAFE_INTEGER;

      if (leftRoute !== rightRoute) {
        return leftRoute - rightRoute;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    })[0] || null;
}

function buildFleetSnapshot(driverRows, tasks, locationRows) {
  const todayLabel = getTodayLabel();
  const locationByDriver = new Map(
    locationRows.map((row) => [String(row.driver_name), row])
  );

  return driverRows.map((row) => {
    const name = String(row.name);
    const driverTasks = tasks.filter((task) => task.assignedDriver === name);
    const locationRow = locationByDriver.get(name);
    const lastSeenAt = toIso(locationRow?.updated_at);
    const nextTask = getNextTaskForDriver(driverTasks);

    return {
      name,
      plateNumber: normalizePlateNumber(row.plate_number),
      loginName: normalizePlateNumber(row.plate_number),
      hasPassword: Boolean(String(row.driver_password_hash || "").trim()),
      pendingCount: driverTasks.filter((task) => task.status === "pending").length,
      inProgressCount: driverTasks.filter((task) => task.status === "in_progress").length,
      completedCount: driverTasks.filter((task) => task.status === "completed").length,
      completedTodayCount: driverTasks.filter(
        (task) =>
          task.status === "completed" &&
          task.finishedAt &&
          new Date(task.finishedAt).toLocaleDateString("ru-RU") === todayLabel
      ).length,
      nextTaskId: nextTask?.id ?? null,
      nextTaskAddress: nextTask?.address ?? "",
      nextRouteOrder: nextTask?.routeOrder ?? null,
      lastSeenAt,
      isOnline: lastSeenAt
        ? Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_THRESHOLD_MS
        : false,
      lastLocation: locationRow
        ? {
            lat: Number(locationRow.lat),
            lon: Number(locationRow.lon),
            accuracy:
              locationRow.accuracy === null ? null : Number(locationRow.accuracy),
            heading: locationRow.heading === null ? null : Number(locationRow.heading),
            speed: locationRow.speed === null ? null : Number(locationRow.speed),
            updatedAt: lastSeenAt,
          }
        : null,
    };
  });
}

async function getStoreSnapshot(client = null) {
  const executor = client || { query };

  const [driversResult, tasksResult, botResult, locationsResult] = await Promise.all([
    executor.query(
      `SELECT name, plate_number, driver_password_hash
       FROM drivers
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, name ASC, id ASC`
    ),
    executor.query(
      `SELECT *
       FROM tasks
       ORDER BY created_at DESC, id DESC`
    ),
    executor.query(
      `SELECT last_telegram_update_id, last_bot_message_at
       FROM bot_state
       WHERE id = 1`
    ),
    executor.query(
      `SELECT driver_name, lat, lon, accuracy, heading, speed, updated_at
       FROM driver_locations`
    ),
  ]);

  const tasks = tasksResult.rows.map(rowToTask);

  return {
    drivers: driversResult.rows.map((row) => String(row.name)),
    tasks,
    fleet: buildFleetSnapshot(driversResult.rows, tasks, locationsResult.rows),
    meta: {
      lastTelegramUpdateId: Number.isFinite(
        Number(botResult.rows[0]?.last_telegram_update_id)
      )
        ? Number(botResult.rows[0]?.last_telegram_update_id)
        : 0,
      lastBotMessageAt: toIso(botResult.rows[0]?.last_bot_message_at),
    },
  };
}

function updateStore(mutator) {
  const operation = async () =>
    withTransaction(async (client) => {
      await ensureRuntimeSchema(client);
      await ensureBotState(client);
      const result = await mutator(client);
      return {
        store: await getStoreSnapshot(client),
        result: clone(result),
      };
    });

  const queuedOperation = writeQueue.then(operation, operation);
  writeQueue = queuedOperation.then(
    () => undefined,
    () => undefined
  );

  return queuedOperation;
}

function getNextRouteOrder(client, driver) {
  if (!driver) {
    return Promise.resolve(null);
  }

  return client
    .query(
      `SELECT COALESCE(MAX(route_order), 0) + 1 AS next_route_order
       FROM tasks
       WHERE assigned_driver_name = $1`,
      [driver]
    )
    .then((result) => Number(result.rows[0]?.next_route_order || 1));
}

export async function getStore() {
  return withTransaction(async (client) => {
    await ensureRuntimeSchema(client);
    await ensureBotState(client);

    if (await needsRouteReindex(client)) {
      await reindexRoutes(client);
    }

    return getStoreSnapshot(client);
  });
}

export async function createDriver(payload) {
  return updateStore(async (client) => {
    const rawName =
      typeof payload === "object" && payload !== null
        ? String(payload.name || "").trim()
        : String(payload || "").trim();
    const plateNumber =
      typeof payload === "object" && payload !== null
        ? normalizePlateNumber(payload.plateNumber)
        : "";
    const password =
      typeof payload === "object" && payload !== null
        ? String(payload.password || "")
        : "";
    const driverName = rawName || plateNumber;

    if (!driverName) {
      throw createBadRequestError("Укажи госномер водителя.");
    }

    if (!password.trim()) {
      throw createBadRequestError("Укажи пароль для входа водителя.");
    }

    if ((await getActiveDriversCount(client)) >= MAX_BETA_DRIVERS) {
      throw createBadRequestError("Для беты доступно только 4 машины.");
    }

    if (await plateNumberExists(client, plateNumber)) {
      throw createBadRequestError("Машина с таким госномером уже существует.");
    }

    const sortOrder = await getNextDriverSortOrder(client);
    const passwordHash = hashPassword(password);
    const { rows } = await client.query(
      `INSERT INTO drivers (
        name,
        plate_number,
        driver_password_hash,
        sort_order,
        is_active,
        created_at,
        updated_at
      )
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (name) DO NOTHING
       RETURNING name, plate_number`,
      [driverName, plateNumber, passwordHash, sortOrder]
    );

    if (!rows[0]) {
      throw createBadRequestError("Экипаж с таким названием уже существует.");
    }

    return rows[0];
  });
}

export async function updateDriver(name, patch) {
  return updateStore(async (client) => {
    const driverName = String(name || "").trim();

    if (!driverName) {
      throw createBadRequestError("Название экипажа не может быть пустым.");
    }

    const nextPlateNumber = Object.prototype.hasOwnProperty.call(patch, "plateNumber")
      ? normalizePlateNumber(patch.plateNumber)
      : null;
    const nextPasswordHash =
      Object.prototype.hasOwnProperty.call(patch, "password") &&
      String(patch.password || "").trim()
        ? hashPassword(String(patch.password || ""))
        : null;

    if (nextPlateNumber !== null && !nextPlateNumber) {
      throw createBadRequestError("Госномер не может быть пустым.");
    }

    if (
      nextPlateNumber !== null &&
      (await plateNumberExists(client, nextPlateNumber, driverName))
    ) {
      throw createBadRequestError("Машина с таким госномером уже существует.");
    }

    const { rows } = await client.query(
      `UPDATE drivers
       SET plate_number = COALESCE($2, plate_number),
           driver_password_hash = COALESCE($3, driver_password_hash),
           updated_at = NOW()
       WHERE name = $1
       RETURNING name, plate_number`,
      [driverName, nextPlateNumber, nextPasswordHash]
    );

    if (!rows[0]) {
      throw createNotFoundError("Экипаж не найден.");
    }

    return rows[0];
  });
}

export async function deleteDriver(name) {
  return updateStore(async (client) => {
    const driverName = String(name || "").trim();

    if (!driverName) {
      throw createBadRequestError("Название экипажа не может быть пустым.");
    }

    const { rows } = await client.query(
      `DELETE FROM drivers
       WHERE name = $1
       RETURNING name`,
      [driverName]
    );

    if (!rows[0]) {
      throw createNotFoundError("Экипаж не найден.");
    }

    await reindexRoutes(client);
    return rows[0];
  });
}

export async function findDriverByLogin(login) {
  return withTransaction(async (client) => {
    await ensureRuntimeSchema(client);

    const normalizedLogin = normalizePlateNumber(login);

    if (!normalizedLogin) {
      return null;
    }

    const { rows } = await client.query(
      `SELECT name, plate_number, driver_password_hash
       FROM drivers
       WHERE is_active = TRUE
         AND REPLACE(UPPER(plate_number), ' ', '') = $1
       LIMIT 1`,
      [normalizedLogin]
    );

    if (!rows[0]) {
      return null;
    }

    return {
      name: String(rows[0].name),
      plateNumber: normalizePlateNumber(rows[0].plate_number),
      passwordHash: String(rows[0].driver_password_hash || ""),
    };
  });
}

export async function getTaskById(taskId) {
  return withTransaction(async (client) => {
    await ensureRuntimeSchema(client);
    await ensureBotState(client);

    const { rows } = await client.query(
      `SELECT *
       FROM tasks
       WHERE id = $1
       LIMIT 1`,
      [String(taskId)]
    );

    return rows[0] ? rowToTask(rows[0]) : null;
  });
}

export async function createTask(payload) {
  return updateStore(async (client) => {
    const assignedDriver = payload.assignedDriver || "";
    const task = buildNewTask(
      {
        ...payload,
        assignedDriver,
        routeOrder: assignedDriver
          ? payload.routeOrder || (await getNextRouteOrder(client, assignedDriver))
          : null,
        source: payload.source || "dispatcher",
      },
      assignedDriver
    );

    const record = await buildTaskRecord(task);
    await client.query(
      `INSERT INTO tasks (
        id,
        address,
        lat,
        lon,
        comment,
        assigned_driver_name,
        route_order,
        status,
        before_photo,
        after_photo,
        started_at,
        finished_at,
        created_at,
        source,
        reporter_name,
        reporter_username,
        reporter_chat_id,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, NOW()
      )`,
      [
        record.id,
        record.address,
        record.lat,
        record.lon,
        record.comment,
        record.assigned_driver_name,
        record.route_order,
        record.status,
        record.before_photo,
        record.after_photo,
        record.started_at,
        record.finished_at,
        record.source,
        record.reporter_name,
        record.reporter_username,
        record.reporter_chat_id,
      ]
    );

    await reindexRoutes(client);
    return task;
  });
}

export async function updateTask(taskId, patch) {
  return updateStore(async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM tasks
       WHERE id = $1
       LIMIT 1`,
      [String(taskId)]
    );

    const existingRow = rows[0];

    if (!existingRow) {
      throw createNotFoundError("Заявка не найдена.");
    }

    const task = rowToTask(existingRow);
    const nextDriver = Object.prototype.hasOwnProperty.call(patch, "assignedDriver")
      ? String(patch.assignedDriver || "").trim()
      : task.assignedDriver;

    const nextRouteOrder = Object.prototype.hasOwnProperty.call(patch, "routeOrder")
      ? patch.routeOrder
      : nextDriver !== task.assignedDriver
        ? await getNextRouteOrder(client, nextDriver)
        : task.routeOrder;

    const nextTask = normalizeTask(
      {
        ...task,
        ...patch,
        assignedDriver: nextDriver,
        routeOrder: nextDriver ? nextRouteOrder : null,
      },
      nextDriver
    );

    const record = await buildTaskRecord(nextTask, task);

    await client.query(
      `UPDATE tasks
       SET address = $2,
           lat = $3,
           lon = $4,
           comment = $5,
           assigned_driver_name = $6,
           route_order = $7,
           status = $8,
           before_photo = $9,
           after_photo = $10,
           started_at = $11,
           finished_at = $12,
           source = $13,
           reporter_name = $14,
           reporter_username = $15,
           reporter_chat_id = $16,
           updated_at = NOW()
       WHERE id = $1`,
      [
        record.id,
        record.address,
        record.lat,
        record.lon,
        record.comment,
        record.assigned_driver_name,
        record.route_order,
        record.status,
        record.before_photo,
        record.after_photo,
        record.started_at,
        record.finished_at,
        record.source,
        record.reporter_name,
        record.reporter_username,
        record.reporter_chat_id,
      ]
    );

    await reindexRoutes(client);
    return nextTask;
  });
}

export async function resetTask(taskId) {
  return updateTask(taskId, {
    status: "pending",
    beforePhoto: null,
    afterPhoto: null,
    startedAt: null,
    finishedAt: null,
  });
}

export async function deleteTask(taskId) {
  return updateStore(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM tasks
       WHERE id = $1
       RETURNING *`,
      [String(taskId)]
    );

    const deletedTask = rows[0];

    if (!deletedTask) {
      throw createNotFoundError("Заявка не найдена.");
    }

    await reindexRoutes(client);
    return rowToTask(deletedTask);
  });
}

export async function markTelegramUpdateHandled(updateId) {
  return updateStore(async (client) => {
    await client.query(
      `UPDATE bot_state
       SET last_telegram_update_id = GREATEST(last_telegram_update_id, $1),
           updated_at = NOW()
       WHERE id = 1`,
      [Number(updateId)]
    );

    return {
      lastTelegramUpdateId: Number(updateId),
    };
  });
}

export async function createTaskFromTelegram(updateId, payload) {
  return updateStore(async (client) => {
    await client.query(
      `UPDATE bot_state
       SET last_telegram_update_id = GREATEST(last_telegram_update_id, $1),
           last_bot_message_at = NOW(),
           updated_at = NOW()
       WHERE id = 1`,
      [Number(updateId)]
    );

    const task = buildNewTask(
      {
        ...payload,
        assignedDriver: "",
        routeOrder: null,
        source: "telegram",
      },
      ""
    );

    const record = await buildTaskRecord(task);

    await client.query(
      `INSERT INTO tasks (
        id,
        address,
        lat,
        lon,
        comment,
        assigned_driver_name,
        route_order,
        status,
        before_photo,
        after_photo,
        started_at,
        finished_at,
        created_at,
        source,
        reporter_name,
        reporter_username,
        reporter_chat_id,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, NOW()
      )`,
      [
        record.id,
        record.address,
        record.lat,
        record.lon,
        record.comment,
        record.status,
        record.before_photo,
        record.after_photo,
        record.started_at,
        record.finished_at,
        record.source,
        record.reporter_name,
        record.reporter_username,
        record.reporter_chat_id,
      ]
    );

    return task;
  });
}

export async function updateDriverLocation(driverName, payload) {
  return withTransaction(async (client) => {
    await ensureRuntimeSchema(client);
    await ensureBotState(client);

    const normalizedDriverName = String(driverName || "").trim();

    if (!normalizedDriverName) {
      throw createBadRequestError("Название экипажа не может быть пустым.");
    }

    const { rows: driverRows } = await client.query(
      `SELECT name
       FROM drivers
       WHERE name = $1
       LIMIT 1`,
      [normalizedDriverName]
    );

    if (!driverRows[0]) {
      throw createNotFoundError("Экипаж не найден.");
    }

    await client.query(
      `INSERT INTO driver_locations (
        driver_name,
        lat,
        lon,
        accuracy,
        heading,
        speed,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      )
      ON CONFLICT (driver_name) DO UPDATE
      SET lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          accuracy = EXCLUDED.accuracy,
          heading = EXCLUDED.heading,
          speed = EXCLUDED.speed,
          updated_at = NOW()`,
      [
        normalizedDriverName,
        payload.lat,
        payload.lon,
        payload.accuracy ?? null,
        payload.heading ?? null,
        payload.speed ?? null,
      ]
    );

    return {
      driverName: normalizedDriverName,
      lat: payload.lat,
      lon: payload.lon,
    };
  });
}
