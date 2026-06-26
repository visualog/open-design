const DOWNLOAD_STAGES = [
  { key: "queued", label: "대기", progress: 8 },
  { key: "validating", label: "확인 중", progress: 22 },
  { key: "downloading", label: "수집 중", progress: 58 },
  { key: "processing", label: "정리 중", progress: 78 },
  { key: "completed", label: "완료", progress: 100 }
];

const STATUS_META = {
  queued: { label: "대기", progress: 8 },
  validating: { label: "확인 중", progress: 22 },
  downloading: { label: "수집 중", progress: 58 },
  processing: { label: "정리 중", progress: 78 },
  completed: { label: "완료", progress: 100 },
  failed: { label: "실패", progress: 100 },
  cancelled: { label: "취소", progress: 100 }
};

const SAMPLE_VIDEOS = [
  {
    id: "vid-0142",
    title: "제품 온보딩 세션 녹화본",
    source: "vimeo.com",
    duration: "42:18",
    size: "618 MB",
    owner: "온보딩 컬렉션",
    status: "completed",
    tag: "교육",
    date: "오늘 14:08"
  },
  {
    id: "vid-0137",
    title: "파트너 웨비나 Q2 편집본",
    source: "drive.google.com",
    duration: "28:04",
    size: "402 MB",
    owner: "웨비나 컬렉션",
    status: "completed",
    tag: "웨비나",
    date: "어제 18:44"
  },
  {
    id: "vid-0128",
    title: "사내 보안 교육 클립",
    source: "assets.company",
    duration: "09:51",
    size: "120 MB",
    owner: "학습 컬렉션",
    status: "completed",
    tag: "컴플라이언스",
    date: "6월 21일"
  }
];

const JOB_STORE_KEY = "archiveflow:jobs";
const VIDEO_STORE_KEY = "archiveflow:videos";
const NOTE_STORE_KEY = "archiveflow:notes";
const API_BASE_CANDIDATES = (() => {
  const bases = ["http://127.0.0.1:4318"];
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    bases.push(window.location.origin);
  }
  return Array.from(new Set(bases));
})();
let archiveflowApiBase = "";
let activeDetailVideoId = "";
let currentLibraryVideos = [];
let currentLibraryFilter = "all";
let currentLibraryQuery = "";
let currentInputMode = "url";
let lastLibraryRenderSignature = "";

async function detectApi() {
  if (archiveflowApiBase) return archiveflowApiBase;
  for (const base of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${base}/api/health`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.ok === true && typeof payload.downloadDir === "string") {
        archiveflowApiBase = base;
        return archiveflowApiBase;
      }
    } catch (_) {}
  }
  return "";
}

async function apiJson(path, options = {}) {
  const base = archiveflowApiBase || await detectApi();
  if (!base) throw new Error("ArchiveFlow 로컬 서버가 연결되지 않았습니다.");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  }
  return payload;
}

function absoluteApiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  const base = archiveflowApiBase || "http://127.0.0.1:4318";
  return new URL(path, base).href;
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function updatePressedState(buttons, activeButton) {
  buttons.forEach((item) => {
    const isActive = item === activeButton;
    item.classList.toggle("active", isActive);
    if (item.getAttribute("role") === "tab") {
      item.setAttribute("aria-selected", String(isActive));
    } else {
      item.setAttribute("aria-pressed", String(isActive));
    }
  });
}

function readJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function createJob(url, quality, collection, reason = "") {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return {
    id: `job-${Math.random().toString(16).slice(2, 8)}`,
    url,
    quality,
    collection,
    reason,
    title: `${host} 영상 수집 중`,
    status: "queued",
    promoted: false,
    createdAt: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
  };
}

function getJobStatus(job) {
  if (job.status) return job.status;
  return DOWNLOAD_STAGES[job.stageIndex || 0]?.key || "queued";
}

function getJobMeta(job) {
  const status = getJobStatus(job);
  const base = STATUS_META[status] || STATUS_META.queued;
  return {
    key: status,
    label: base.label,
    progress: typeof job.progress === "number" ? Math.max(base.progress, Math.min(100, job.progress)) : base.progress
  };
}

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0"];
    const allowedProtocols = ["https:", "http:"];
    return allowedProtocols.includes(url.protocol) && !blockedHosts.includes(url.hostname);
  } catch (_) {
    return false;
  }
}

async function initDownloads() {
  const form = document.querySelector("[data-download-form]");
  if (!form) return;

  const list = document.querySelector("[data-job-list]");
  const urlInput = form.querySelector("[name='url']");
  const qualityInput = form.querySelector("[name='quality']");
  const collectionInput = form.querySelector("[name='collection']");
  const reasonInput = form.querySelector("[name='reason']");
  const submitButton = form.querySelector("button[type='submit']");
  const inputMode = form.querySelector(".input-mode");
  const modeButtons = form.querySelectorAll("[data-input-mode]");

  const defaultJobs = [
    {
      id: "job-a18f22",
      url: "https://vimeo.com/approved/onboarding",
      quality: "1080p 이하",
      collection: "교육",
      title: "제품 온보딩 세션 녹화본",
      status: "completed",
      promoted: true,
      createdAt: "14:08"
    },
    {
      id: "job-b77c91",
      url: "https://drive.google.com/file/approved",
      quality: "원본 유지",
      collection: "웨비나",
      title: "파트너 웨비나 Q2 편집본",
      status: "downloading",
      progress: 58,
      promoted: false,
      createdAt: "14:22"
    }
  ];
  let jobs = readJson(JOB_STORE_KEY, defaultJobs);
  const apiBase = await detectApi();

  function saveJobs() {
    writeJson(JOB_STORE_KEY, jobs);
  }

  function updateSubmitState() {
    if (!submitButton) return;
    const hasValue = Boolean(urlInput.value.trim());
    const needsServer = currentInputMode === "url";
    const serverUnavailable = needsServer && !archiveflowApiBase;
    submitButton.disabled = !hasValue || serverUnavailable;
    submitButton.dataset.state = submitButton.disabled ? "disabled" : "active";
    submitButton.setAttribute("aria-disabled", String(submitButton.disabled));
  }

  function syncInputIntensity() {
    const hasValue = Boolean(urlInput.value.trim());
    form.classList.toggle("has-value", hasValue);
    form.classList.toggle("is-empty", !hasValue);
    updateSubmitState();
  }

  function promoteCompletedJobs() {
    const videos = readJson(VIDEO_STORE_KEY, SAMPLE_VIDEOS);
    let changed = false;
    jobs.forEach((job) => {
      if (getJobStatus(job) !== "completed" || job.promoted) return;
      const host = new URL(job.url).hostname.replace(/^www\./, "");
    videos.unshift({
      id: job.id.replace("job", "vid"),
      title: job.title,
      source: host,
      duration: "미확인",
      size: "수집 완료",
      owner: job.collection || "내 컬렉션",
      status: "completed",
      tag: job.collection || "미분류",
      date: "방금 전",
        quality: job.quality
      });
      job.promoted = true;
      changed = true;
    });
    if (changed) {
      writeJson(VIDEO_STORE_KEY, videos);
      saveJobs();
    }
  }

  function renderJobs() {
    if (!archiveflowApiBase) promoteCompletedJobs();
    updateSubmitState();

    list.innerHTML = jobs.map((job) => {
      const stage = getJobMeta(job);
      const canCancel = !["completed", "failed", "cancelled"].includes(stage.key);
      return `
        <article class="job" data-job-id="${job.id}">
          <div class="job-head">
            <div>
              <strong>${escapeHtml(job.title || "제목 확인 중")}</strong>
              <div class="meta"><span>${escapeHtml(job.id)}</span><span>${escapeHtml(job.collection || "미분류")}</span><span>${escapeHtml(job.quality || "기본")}</span><span>${escapeHtml(job.createdAt || "")}</span></div>
            </div>
            <span class="status ${stage.key}">${stage.label}</span>
          </div>
          <div class="progress-track" aria-label="수집 진행률">
            <div class="progress-bar" style="--progress:${stage.progress}%"></div>
          </div>
          ${job.error ? `<p class="field-error visible">${escapeHtml(job.error)}</p>` : ""}
          <div class="row-between">
            <span class="hint">${escapeHtml(job.url)}</span>
            <div class="actions">
              <button class="button" type="button" data-copy="${job.id}">ID 복사</button>
              ${stage.key === "completed"
                ? `<button class="button" type="button" data-open-video="${escapeHtml(job.videoId || job.id.replace("job", "vid"))}">라이브러리에서 보기</button>`
                : canCancel ? `<button class="button danger" type="button" data-cancel="${job.id}">취소</button>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  async function refreshJobs() {
    if (!archiveflowApiBase) {
      renderJobs();
      return;
    }
    try {
      const payload = await apiJson("/api/jobs");
      jobs = payload.jobs || [];
      saveJobs();
      renderJobs();
      if (document.querySelector("[data-inline-list]")) {
        await refreshLibraryVideos();
      }
    } catch (error) {
      archiveflowApiBase = "";
      showToast(error.message);
      renderJobs();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawValue = urlInput.value.trim();
    if (currentInputMode === "search") {
      currentLibraryQuery = rawValue;
      paintLibraryVideos();
      showToast(rawValue ? "라이브러리에서 찾았습니다." : "검색을 초기화했습니다.");
      return;
    }
    const url = rawValue;
    if (!isAllowedUrl(url)) {
      showToast("공개 HTTP/HTTPS URL만 등록할 수 있습니다.");
      urlInput.focus();
      return;
    }
    if (!archiveflowApiBase) {
      showToast("영상을 수집하려면 로컬 서버를 먼저 실행해야 합니다.");
      return;
    }
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.state = "loading";
      submitButton.setAttribute("aria-busy", "true");
    }
    try {
      await apiJson("/api/downloads", {
        method: "POST",
        body: JSON.stringify({
          url,
          quality: qualityInput.value,
          collection: collectionInput.value || "미분류",
          reason: reasonInput?.value.trim() || ""
        })
      });
      form.reset();
      syncInputIntensity();
      showToast("영상을 라이브러리에 수집하기 시작했습니다.");
      await refreshJobs();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (submitButton) {
        submitButton.removeAttribute("aria-busy");
        updateSubmitState();
      }
    }
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentInputMode = button.dataset.inputMode || "url";
      if (inputMode) inputMode.dataset.mode = currentInputMode === "search" ? "search" : "url";
      updatePressedState(modeButtons, button);
      urlInput.value = "";
      syncInputIntensity();
      urlInput.placeholder = currentInputMode === "search" ? "제목, 출처, 카테고리 검색" : "영상 주소를 붙여넣기";
      updateSubmitState();
      urlInput.focus();
    });
  });

  urlInput.addEventListener("input", syncInputIntensity);

  list.addEventListener("click", async (event) => {
    const copyId = event.target.closest("[data-copy]")?.dataset.copy;
    const cancelId = event.target.closest("[data-cancel]")?.dataset.cancel;
    const openVideoId = event.target.closest("[data-open-video]")?.dataset.openVideo;
    if (copyId) {
      const copied = await copyText(copyId);
      showToast(copied ? "ID를 복사했습니다." : "복사 권한이 없어 ID를 선택해 주세요.");
    }
    if (openVideoId) {
      await refreshLibraryVideos();
      const video = currentLibraryVideos.find((item) => item.id === openVideoId);
      renderDetailVideo(video || null);
      const detailPanel = document.querySelector("[data-inline-detail]");
      if (detailPanel) {
        const top = detailPanel.getBoundingClientRect().top + window.scrollY - 18;
        window.scrollTo({ top, behavior: "smooth" });
      }
    }
    if (cancelId) {
      if (archiveflowApiBase) {
        try {
          await apiJson(`/api/jobs/${encodeURIComponent(cancelId)}/cancel`, { method: "POST", body: "{}" });
          showToast("진행 중인 수집을 취소했습니다.");
          await refreshJobs();
        } catch (error) {
          showToast(error.message);
        }
      }
    }
  });

  document.querySelector("[data-refresh-board]")?.addEventListener("click", async () => {
    await refreshJobs();
    await refreshLibraryVideos();
      showToast("라이브러리를 새로고침했습니다.");
  });

  syncInputIntensity();
  await refreshJobs();
  window.setInterval(refreshJobs, 1800);
}

function renderVideos(container, filter = "all", sourceVideos = null) {
  const storedVideos = sourceVideos || readJson(VIDEO_STORE_KEY, SAMPLE_VIDEOS);
  const categoryVideos = filter === "all" ? storedVideos : storedVideos.filter((video) => video.tag === filter);
  const query = currentLibraryQuery.trim().toLowerCase();
  const videos = query
    ? categoryVideos.filter((video) => [video.title, video.source, video.owner, video.tag]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)))
    : categoryVideos;
  const empty = document.querySelector("[data-empty]");
  const inlineList = container.hasAttribute("data-inline-list");
  const renderSignature = JSON.stringify({
    filter,
    query,
    inlineList,
    videos: videos.map((video) => ({
      id: video.id,
      title: video.title,
      tag: video.tag,
      status: video.status,
      fileUrl: video.fileUrl || ""
    }))
  });
  if (renderSignature === lastLibraryRenderSignature) {
    if (empty) empty.classList.toggle("visible", videos.length === 0);
    return;
  }
  lastLibraryRenderSignature = renderSignature;
  container.innerHTML = videos.map((video) => {
    const posterText = (video.tag || video.title || "영상").slice(0, 2);
    const fileUrl = video.fileUrl ? absoluteApiUrl(video.fileUrl) : "";
    const thumbnail = fileUrl
      ? `
        <video class="thumb-video" src="${escapeHtml(fileUrl)}" muted preload="metadata" playsinline aria-hidden="true"></video>
        <span class="thumb-label" aria-hidden="true">${escapeHtml(posterText)}</span>
      `
      : `
        <span class="thumb-poster" aria-hidden="true">
          <span>${escapeHtml(posterText)}</span>
        </span>
      `;
    return `
    <article class="video-row bento-card" data-video-tag="${escapeHtml(video.tag)}">
      <a class="thumb" href="${inlineList ? `#video-${encodeURIComponent(video.id)}` : `video-detail.html?id=${encodeURIComponent(video.id)}`}" ${inlineList ? `data-video-open="${escapeHtml(video.id)}"` : ""} aria-label="${escapeHtml(video.title)} 미리보기">
        ${thumbnail}
        <span class="thumb-play" aria-hidden="true">▶</span>
      </a>
      <div class="video-copy">
        <p class="video-title">${escapeHtml(video.title)}</p>
        <div class="meta"><span>${escapeHtml(video.tag || "미분류")}</span></div>
      </div>
    </article>
  `;
  }).join("");
  if (empty) empty.classList.toggle("visible", videos.length === 0);
}

async function loadLibraryVideos() {
  let videos = readJson(VIDEO_STORE_KEY, SAMPLE_VIDEOS);
  const apiBase = await detectApi();
  if (apiBase) {
    try {
      const payload = await apiJson("/api/videos");
      videos = payload.videos || [];
      writeJson(VIDEO_STORE_KEY, videos);
    } catch (error) {
      showToast(error.message);
    }
  }
  currentLibraryVideos = videos;
  return videos;
}

function paintLibraryVideos() {
  const list = document.querySelector("[data-video-list]");
  if (!list) return;
  renderVideos(list, currentLibraryFilter, currentLibraryVideos);
  if (list.hasAttribute("data-inline-list")) {
    const filtered = currentLibraryFilter === "all"
      ? currentLibraryVideos
      : currentLibraryVideos.filter((video) => video.tag === currentLibraryFilter);
    const selected = activeDetailVideoId ? filtered.find((video) => video.id === activeDetailVideoId) || null : null;
    renderDetailVideo(selected);
  }
}

async function refreshLibraryVideos() {
  await loadLibraryVideos();
  paintLibraryVideos();
}

async function initLibrary() {
  const list = document.querySelector("[data-video-list]");
  if (!list) return;
  await refreshLibraryVideos();
  document.querySelector("[data-filters]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    currentLibraryFilter = button.dataset.filter;
    lastLibraryRenderSignature = "";
    updatePressedState(document.querySelectorAll("[data-filter]"), button);
    paintLibraryVideos();
  });
  list.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-video-open]");
    if (!trigger) return;
    event.preventDefault();
    const video = currentLibraryVideos.find((item) => item.id === trigger.dataset.videoOpen);
    renderDetailVideo(video || null);
  });
}

function renderActiveNotes() {
  const noteList = document.querySelector("[data-note-list]");
  if (!noteList) return;
  if (!activeDetailVideoId) {
    noteList.innerHTML = '<div class="timeline-row"><strong>대기</strong><span class="hint">선택된 영상이 없습니다.</span></div>';
    return;
  }
  const notes = readJson(NOTE_STORE_KEY, {});
  const videoNotes = notes[activeDetailVideoId] || ["다시 볼 구간이나 공유 맥락을 노트로 남겨보세요."];
  noteList.innerHTML = videoNotes.map((note) => `
    <div class="timeline-row"><strong>큐레이션 노트</strong><span class="hint">${escapeHtml(note)}</span></div>
  `).join("");
}

function renderDetailVideo(video) {
  const detailTitle = document.querySelector("[data-detail-title]");
  const detailEmpty = document.querySelector("[data-detail-empty]");
  const playerState = document.querySelector("[data-player-state]");
  if (!detailTitle) return;
  const setText = (selector, value) => {
    const target = document.querySelector(selector);
    if (target) target.textContent = value;
  };
  const setHtml = (selector, value) => {
    const target = document.querySelector(selector);
    if (target) target.innerHTML = value;
  };

  const detailGrid = document.querySelector(".detail-grid");
  const inlineDetail = document.querySelector("[data-inline-detail]");
  const detailActions = document.querySelector("[data-detail-actions]");
  const player = document.querySelector("[data-player]");
  const videoElement = document.querySelector("[data-video-el]");
  const playerButton = document.querySelector("[data-play]");

  if (!video) {
    activeDetailVideoId = "";
    detailGrid?.setAttribute("hidden", "");
    detailActions?.setAttribute("hidden", "");
    detailEmpty?.classList.add("visible");
    inlineDetail?.setAttribute("hidden", "");
    if (inlineDetail) {
      detailTitle.textContent = "영상을 선택하세요";
      setText("[data-detail-summary]", "선택한 영상을 바로 확인합니다.");
      setText("[data-detail-source]", "선택됨");
      setText("[data-player-state]", "영상 선택 필요");
      setText("[data-detail-file-state]", "대기 중");
      setText("[data-detail-review]", "선택 필요");
      setText("[data-detail-job]", "대기 중");
      setText("[data-detail-duration]", "미확인");
      setText("[data-detail-size]", "미확인");
      setText("[data-detail-owner]", "ArchiveFlow");
      setText("[data-detail-tag]", "미분류");
      setText("[data-detail-quality]", "저장 방식 대기");
      setText("[data-detail-storage]", "영상을 선택하면 표시됩니다.");
      setHtml("[data-detail-timeline]", '<div class="timeline-row"><strong>대기</strong><span class="hint">영상을 선택하세요.</span></div>');
    }
    if (videoElement) {
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.hidden = true;
    }
    player?.classList.remove("is-playing");
    if (playerButton) {
      playerButton.setAttribute("aria-pressed", "false");
      playerButton.querySelector(".play-symbol").textContent = "▶";
      playerButton.querySelector(".play-text").textContent = "재생";
    }
    renderActiveNotes();
    return;
  }

  const isSameActiveVideo = activeDetailVideoId === video.id;
  activeDetailVideoId = video.id;
  detailGrid?.removeAttribute("hidden");
  detailActions?.removeAttribute("hidden");
  inlineDetail?.removeAttribute("hidden");
  detailEmpty?.classList.remove("visible");

  const storagePath = video.storagePath || `downloads/${video.id}`;
  const shareUrl = absoluteApiUrl(video.fileUrl || "");
  document.title = `${video.title} | ArchiveFlow`;
  detailTitle.textContent = video.title;
  setText("[data-detail-summary]", `${video.tag || "미분류"} 컬렉션`);
  setText("[data-detail-source]", video.source || "ArchiveFlow");
  setText("[data-detail-duration]", video.duration || "미확인");
  setText("[data-detail-size]", video.size || "미확인");
  setText("[data-detail-owner]", video.owner || "ArchiveFlow");
  setText("[data-detail-tag]", video.tag || "미분류");
  setText("[data-detail-quality]", video.quality || "웹 감상용 1080p");
  setText("[data-detail-storage]", storagePath);
  document.querySelector("[data-copy-share]")?.setAttribute("data-copy-text", shareUrl || storagePath);
  setText("[data-detail-file-state]", video.fileUrl ? "재생 가능" : "파일 미연결");
  setText("[data-detail-review]", video.status === "completed" ? "다시보기 가능" : "수집 중");
  setText("[data-detail-job]", video.tag || video.jobId || video.id);

  if (videoElement) {
    if (video.fileUrl) {
      const fileUrl = absoluteApiUrl(video.fileUrl);
      const currentSrc = videoElement.currentSrc || videoElement.getAttribute("src") || "";
      player?.setAttribute("data-file-url", fileUrl);
      if (currentSrc !== fileUrl) {
        videoElement.pause();
        videoElement.src = fileUrl;
        videoElement.load();
      }
      videoElement.hidden = false;
      if (playerState) playerState.textContent = "재생 가능";
    } else {
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.hidden = true;
      if (playerState) playerState.textContent = "파일 미연결";
    }
  }
  if (!isSameActiveVideo) player?.classList.remove("is-playing");
  if (playerButton && !isSameActiveVideo) {
    playerButton.setAttribute("aria-pressed", "false");
    playerButton.setAttribute("aria-label", "미리보기 재생");
    playerButton.querySelector(".play-symbol").textContent = "▶";
    playerButton.querySelector(".play-text").textContent = "재생";
  }

  const timeline = document.querySelector("[data-detail-timeline]");
  if (timeline) {
    const events = Array.isArray(video.events) && video.events.length > 0
      ? video.events.slice().reverse()
      : [{ label: "라이브러리에 추가됨", message: "영상이 컬렉션에 들어왔습니다." }];
    timeline.innerHTML = events.map((item) => `
      <div class="timeline-row"><strong>${escapeHtml(item.label)}</strong><span class="hint">${escapeHtml(item.message)}</span></div>
    `).join("");
  }
  renderActiveNotes();
}

async function initDetail() {
  const detailTitle = document.querySelector("[data-detail-title]");
  if (detailTitle) {
    const params = new URLSearchParams(window.location.search);
    const apiBase = await detectApi();
    let storedVideos = readJson(VIDEO_STORE_KEY, SAMPLE_VIDEOS);
    if (apiBase) {
      try {
        const payload = await apiJson("/api/videos");
        storedVideos = payload.videos || [];
        writeJson(VIDEO_STORE_KEY, storedVideos);
      } catch (error) {
        showToast(error.message);
      }
    }
    const requestedId = params.get("id") || storedVideos[0]?.id;
    const video = storedVideos.find((item) => item.id === requestedId);
    renderDetailVideo(video || null);
  }

  const playerButton = document.querySelector("[data-play]");
  const player = document.querySelector("[data-player]");
  const videoElement = document.querySelector("[data-video-el]");
  const playerState = document.querySelector("[data-player-state]");
  const noteForm = document.querySelector("[data-note-form]");
  const noteList = document.querySelector("[data-note-list]");
  renderActiveNotes();

  if (playerButton) {
    playerButton.addEventListener("click", async () => {
      const willPlay = playerButton.getAttribute("aria-pressed") !== "true";
      const symbol = playerButton.querySelector(".play-symbol");
      const label = playerButton.querySelector(".play-text");
      if (videoElement?.src) {
        try {
          if (willPlay) await videoElement.play();
          else videoElement.pause();
        } catch (_) {
          showToast("브라우저가 이 파일 형식의 재생을 지원하지 않습니다.");
          return;
        }
      }
      if (symbol) symbol.textContent = willPlay ? "Ⅱ" : "▶";
      if (label) label.textContent = willPlay ? "일시정지" : "재생";
      playerButton.setAttribute("aria-pressed", String(willPlay));
      playerButton.setAttribute("aria-label", willPlay ? "미리보기 일시정지" : "미리보기 재생");
      player?.classList.toggle("is-playing", willPlay);
      if (playerState) playerState.textContent = willPlay ? "재생 중" : "일시정지됨";
      showToast(willPlay ? "미리보기를 재생합니다." : "미리보기를 일시정지했습니다.");
    });
  }
  if (noteForm && noteList) {
    noteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = noteForm.querySelector("textarea");
      const error = noteForm.querySelector("[data-note-error]");
      const text = input.value.trim();
      if (!text) {
        input.setAttribute("aria-invalid", "true");
        if (error) error.textContent = "저장할 노트를 입력해 주세요.";
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      if (error) error.textContent = "";
      if (activeDetailVideoId) {
        const notes = readJson(NOTE_STORE_KEY, {});
        notes[activeDetailVideoId] = [text, ...(notes[activeDetailVideoId] || [])].slice(0, 6);
        writeJson(NOTE_STORE_KEY, notes);
        renderActiveNotes();
      }
      input.value = "";
      showToast("큐레이션 노트를 저장했습니다.");
    });
  }

  document.querySelector("[data-preview-close]")?.addEventListener("click", () => {
    renderDetailVideo(null);
  });
}

function initCopyButtons() {
  document.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.setAttribute("aria-busy", "true");
      const copied = await copyText(button.dataset.copyText);
      const originalLabel = button.dataset.copyLabel || button.textContent;
      button.removeAttribute("aria-busy");
      if (copied) {
        button.textContent = "복사됨";
        button.classList.add("is-success");
        window.setTimeout(() => {
          button.textContent = originalLabel;
          button.classList.remove("is-success");
        }, 1400);
      }
      showToast(copied ? "복사했습니다." : "복사 권한이 없어 값을 직접 선택해 주세요.");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initDownloads();
  initLibrary();
  initDetail();
  initCopyButtons();
});
