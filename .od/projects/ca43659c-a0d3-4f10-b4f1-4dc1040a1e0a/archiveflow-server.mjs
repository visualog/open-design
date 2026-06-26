import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "runtime-data");
const DOWNLOAD_DIR = path.join(ROOT, "downloads");
const STATE_FILE = path.join(DATA_DIR, "archiveflow-state.json");
const PORT = Number(process.env.ARCHIVEFLOW_PORT || 4318);
const HOST = process.env.ARCHIVEFLOW_HOST || "0.0.0.0";
const activeProcesses = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

async function readState() {
  await ensureDirs();
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch (_) {
    return { jobs: [], videos: [] };
  }
}

async function writeState(state) {
  await ensureDirs();
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function nowLabel() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function mediaHeaders(type, length) {
  return {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Content-Length": length,
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length"
  };
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isPrivateIp(value) {
  const ipVersion = net.isIP(value);
  if (ipVersion === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  if (ipVersion === 6) {
    const normalized = value.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }
  return false;
}

async function assertPublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error("올바른 URL이 아닙니다.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("HTTP/HTTPS URL만 등록할 수 있습니다.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || isPrivateIp(host)) {
    throw new Error("로컬호스트와 사설망 주소는 차단됩니다.");
  }
  const records = await dns.lookup(host, { all: true });
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error("사설망으로 해석되는 URL은 차단됩니다.");
  }
  return parsed;
}

function safeRelativeUrl(filePath) {
  const relative = path.relative(ROOT, filePath).split(path.sep).map(encodeURIComponent).join("/");
  return `/files/${relative}`;
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "미확인";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "미확인";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function pushEvent(job, label, message) {
  job.events = [...(job.events || []), { label: `${nowLabel()} ${label}`, message }];
}

async function saveJob(update) {
  const state = await readState();
  const index = state.jobs.findIndex((job) => job.id === update.id);
  if (index >= 0) state.jobs[index] = update;
  else state.jobs.unshift(update);
  await writeState(state);
}

function capture(command, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("메타데이터 확인 시간이 초과되었습니다."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout || "yt-dlp 실행에 실패했습니다.").trim()));
    });
  });
}

async function listDownloadedFiles(jobDir) {
  const entries = await fs.readdir(jobDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".part") || entry.name.endsWith(".json")) continue;
    const filePath = path.join(jobDir, entry.name);
    const stat = await fs.stat(filePath);
    files.push({ filePath, size: stat.size });
  }
  return files.sort((a, b) => b.size - a.size);
}

function formatForQuality(quality) {
  if (quality === "1080p 이하") return "best[height<=1080]/best";
  if (quality === "오디오만 추출") return "bestaudio/best";
  return "best";
}

async function runJob(job) {
  try {
    job.status = "validating";
    job.progress = 18;
    pushEvent(job, "검증", "URL과 공개 네트워크 대상을 확인합니다.");
    await saveJob(job);

    await assertPublicUrl(job.url);
    const rawMeta = await capture("yt-dlp", ["--dump-json", "--no-playlist", "--skip-download", job.url]);
    const metaLine = rawMeta.trim().split("\n").filter(Boolean).at(-1);
    const metadata = metaLine ? JSON.parse(metaLine) : {};
    job.title = metadata.title || job.title;
    job.source = metadata.extractor_key || new URL(job.url).hostname.replace(/^www\./, "");
    job.duration = humanDuration(metadata.duration);
    job.owner = metadata.uploader || "Archive Ops";
    pushEvent(job, "메타데이터", "제목, 길이, 출처 정보를 확인했습니다.");

    job.status = "downloading";
    job.progress = 30;
    await saveJob(job);

    const jobDir = path.join(DOWNLOAD_DIR, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    const output = path.join(jobDir, "%(title).180B [%(id)s].%(ext)s");
    const args = [
      "--no-playlist",
      "--restrict-filenames",
      "--newline",
      "-f",
      formatForQuality(job.quality),
      "-o",
      output,
      job.url
    ];

    await new Promise((resolve, reject) => {
      const child = spawn("yt-dlp", args, { cwd: ROOT });
      activeProcesses.set(job.id, child);
      const onData = async (chunk) => {
        const line = chunk.toString();
        const match = line.match(/\[download\]\s+([0-9.]+)%/);
        if (match) {
          job.progress = Math.max(job.progress || 30, Math.min(74, 30 + Math.round(Number(match[1]) * 0.44)));
          await saveJob(job);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (code, signal) => {
        activeProcesses.delete(job.id);
        if (signal || job.status === "cancelled") {
          reject(new Error("작업이 취소되었습니다."));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error("yt-dlp 다운로드가 실패했습니다."));
        }
      });
    });

    job.status = "processing";
    job.progress = 86;
    pushEvent(job, "등록", "다운로드 파일을 라이브러리 레코드로 등록합니다.");
    await saveJob(job);

    const files = await listDownloadedFiles(jobDir);
    if (files.length === 0) throw new Error("다운로드된 파일을 찾지 못했습니다.");
    const primary = files[0];
    const video = {
      id: job.id.replace("job", "vid"),
      jobId: job.id,
      title: job.title,
      source: job.source,
      duration: job.duration || "미확인",
      size: humanSize(primary.size),
      owner: job.owner || "Archive Ops",
      status: "completed",
      tag: job.collection || "미분류",
      date: "방금 전",
      quality: job.quality,
      sourceUrl: job.url,
      storagePath: path.relative(ROOT, primary.filePath),
      fileUrl: safeRelativeUrl(primary.filePath),
      events: job.events || []
    };
    const state = await readState();
    state.videos = [video, ...state.videos.filter((item) => item.id !== video.id)];
    const index = state.jobs.findIndex((item) => item.id === job.id);
    job.status = "completed";
    job.progress = 100;
    job.videoId = video.id;
    pushEvent(job, "완료", "파일 저장과 라이브러리 등록이 완료되었습니다.");
    if (index >= 0) state.jobs[index] = job;
    await writeState(state);
  } catch (error) {
    if (job.status !== "cancelled") {
      job.status = "failed";
      job.progress = 100;
      job.error = error.message;
      pushEvent(job, "실패", error.message);
    }
    await saveJob(job);
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return true;
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      ytDlp: commandExists("yt-dlp"),
      ffmpeg: commandExists("ffmpeg"),
      downloadDir: DOWNLOAD_DIR
    });
    return true;
  }
  if (url.pathname === "/api/jobs" && req.method === "GET") {
    const state = await readState();
    json(res, 200, { jobs: state.jobs });
    return true;
  }
  if (url.pathname === "/api/videos" && req.method === "GET") {
    const state = await readState();
    json(res, 200, { videos: state.videos });
    return true;
  }
  if (url.pathname === "/api/downloads" && req.method === "POST") {
    if (!commandExists("yt-dlp")) {
      json(res, 500, { error: "yt-dlp가 설치되어 있지 않습니다." });
      return true;
    }
    const body = await parseBody(req);
    await assertPublicUrl(body.url);
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
      url: body.url,
      quality: body.quality || "1080p 이하",
      collection: body.collection || "미분류",
      reason: body.reason || "",
      title: `${new URL(body.url).hostname.replace(/^www\./, "")} 콘텐츠 검증 중`,
      status: "queued",
      progress: 8,
      createdAt: nowLabel(),
      events: []
    };
    pushEvent(job, "대기", "작업 큐에 등록되었습니다.");
    await saveJob(job);
    runJob(job);
    json(res, 202, { job });
    return true;
  }
  const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const id = decodeURIComponent(cancelMatch[1]);
    const state = await readState();
    const job = state.jobs.find((item) => item.id === id);
    if (!job) {
      json(res, 404, { error: "작업을 찾을 수 없습니다." });
      return true;
    }
    const child = activeProcesses.get(id);
    if (child) child.kill("SIGTERM");
    job.status = "cancelled";
    job.progress = 100;
    pushEvent(job, "취소", "사용자가 작업을 취소했습니다.");
    await writeState(state);
    json(res, 200, { job });
    return true;
  }
  return false;
}

async function serveFile(req, res, url) {
  let target;
  if (url.pathname === "/") {
    target = path.join(ROOT, "index.html");
  } else if (url.pathname.startsWith("/files/")) {
    const relative = decodeURIComponent(url.pathname.slice("/files/".length));
    target = path.resolve(ROOT, relative);
  } else {
    target = path.resolve(ROOT, decodeURIComponent(url.pathname.slice(1)));
  }
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("not file");
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    if (range && /^(video|audio)\//.test(type)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Access-Control-Allow-Origin": "*"
        });
        res.end();
        return;
      }
      const requestedStart = match[1] ? Number(match[1]) : 0;
      const requestedEnd = match[2] ? Number(match[2]) : stat.size - 1;
      const start = Math.max(0, Math.min(requestedStart, stat.size - 1));
      const end = Math.max(start, Math.min(requestedEnd, stat.size - 1));
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        ...mediaHeaders(type, chunkSize),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`
      });
      createReadStream(target, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      ...mediaHeaders(type, stat.size)
    });
    createReadStream(target).pipe(res);
  } catch (_) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

await ensureDirs();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) json(res, 404, { error: "API 경로를 찾을 수 없습니다." });
      return;
    }
    await serveFile(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
  }
}).listen(PORT, HOST, () => {
  console.log(`ArchiveFlow local server: http://localhost:${PORT}`);
});
