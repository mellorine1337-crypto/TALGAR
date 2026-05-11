import path from "node:path";

function getProvider() {
  return String(process.env.PHOTO_ARCHIVE_PROVIDER || "").trim().toLowerCase();
}

function isYandexDiskEnabled() {
  return getProvider() === "yandex" && Boolean(String(process.env.YANDEX_DISK_TOKEN || "").trim());
}

function normalizeDiskPath(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "disk:/Talgarclean/photos";
  }

  if (trimmed.startsWith("disk:/")) {
    return trimmed.replace(/\/+$/, "");
  }

  return `disk:/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function getArchiveBasePath() {
  return normalizeDiskPath(process.env.YANDEX_DISK_BASE_PATH);
}

function buildArchivePath({ taskId, fieldName, extension }) {
  const basePath = getArchiveBasePath();
  const dateLabel = new Date().toISOString().slice(0, 10);
  return `${basePath}/${dateLabel}/${encodeURIComponent(String(taskId))}/${fieldName}${extension}`;
}

function getYandexHeaders() {
  return {
    Authorization: `OAuth ${String(process.env.YANDEX_DISK_TOKEN || "").trim()}`,
  };
}

async function createYandexDirectory(directoryPath) {
  const response = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(directoryPath)}`,
    {
      method: "PUT",
      headers: getYandexHeaders(),
    }
  );

  if (response.ok || response.status === 201 || response.status === 409) {
    return;
  }

  const payload = await response.text();
  throw new Error(`Yandex Disk folder create failed: ${response.status} ${payload}`);
}

async function ensureYandexDirectory(directoryPath) {
  const [prefix, rawPath] = directoryPath.split(":/");
  const cleanPath = String(rawPath || "").replace(/^\/+/, "").replace(/\/+$/, "");

  if (!cleanPath) {
    return;
  }

  const segments = cleanPath.split("/").filter(Boolean);
  let currentPath = `${prefix}:/`;

  for (const segment of segments) {
    currentPath = `${currentPath}${currentPath.endsWith("/") ? "" : "/"}${segment}`;
    await createYandexDirectory(currentPath);
  }
}

async function uploadToYandexDisk({ archivePath, buffer, mimeType }) {
  const directoryPath = path.posix.dirname(archivePath);
  await ensureYandexDirectory(directoryPath);

  const uploadLinkResponse = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(
      archivePath
    )}&overwrite=true`,
    {
      headers: getYandexHeaders(),
    }
  );

  if (!uploadLinkResponse.ok) {
    const payload = await uploadLinkResponse.text();
    throw new Error(
      `Yandex Disk upload link failed: ${uploadLinkResponse.status} ${payload}`
    );
  }

  const uploadLinkPayload = await uploadLinkResponse.json();
  const targetUrl = String(uploadLinkPayload.href || "").trim();

  if (!targetUrl) {
    throw new Error("Yandex Disk did not return an upload URL.");
  }

  const uploadResponse = await fetch(targetUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    const payload = await uploadResponse.text();
    throw new Error(`Yandex Disk upload failed: ${uploadResponse.status} ${payload}`);
  }
}

export async function archivePhoto({ taskId, fieldName, mimeType, extension, buffer }) {
  if (!isYandexDiskEnabled()) {
    return null;
  }

  const archivePath = buildArchivePath({
    taskId,
    fieldName,
    extension,
  });

  await uploadToYandexDisk({
    archivePath,
    buffer,
    mimeType,
  });

  return {
    provider: "yandex",
    archivePath,
  };
}

export function getPhotoArchiveStatus() {
  return {
    provider: getProvider() || "local",
    configured: isYandexDiskEnabled(),
    yandexBasePath: getArchiveBasePath(),
  };
}
