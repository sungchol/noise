"use strict";
import {
  postProcessNoise,
  postProcessFilter,
  postFilter_smf33,
} from "./client.js";

/* =========================================================
 * 1. 설정
 * ========================================================= */

// 전시용 이미지 경로를 여기에 추가한다.
// 주의: file:// 로 열면 브라우저 보안 정책 때문에 픽셀을 읽을 수 없으므로
//       로컬 서버(VS Code Live Server)로 실행해야 한다.
const IMAGE_LIST = [
  { name: "white_tree.jpg", src: "images/white_tree.jpg" },
  { name: "flower.jpg", src: "images/flower.jpg" },
  { name: "carbon.jpg", src: "images/carbon.jpg" },
  { name: "traffic.jpg", src: "images/traffic.jpg" },
  { name: "traffic2.jpg", src: "images/traffic2.jpg" },
  { name: "track_left.jpg", src: "images/track_left.jpg" },
  { name: "track_right.jpg", src: "images/track_right.jpg" },
];

const CONFIG = {
  maxSize: 256, // 처리 해상도 상한(긴 변 기준, px). 필터 연산량에 맞춰 조정한다.
  stepDelay: 0, // 단계 사이 연출용 지연(ms). 0이면 즉시 표시한다.
};

const PROPOSED_FILTERS = ["WMM_II", "Recursive_WMM_II", "Recursive_TWMF"]; // 시간이 많이 소요되는 함수
let proposedFilterIndex = 0; //2번째를 초기값으로 선택
/* =========================================================
 * 2. 상태 및 화면 요소
 * ========================================================= */

const els = {
  list: document.getElementById("imageList"),
  file: document.getElementById("fileInput"),
  fullscreen: document.getElementById("fullscreenBtn"),
  noiseStrength: document.getElementById("noiseStrength"),
  proposedToggle: document.getElementById("proposedToggle"),

  canvas: {
    original: document.getElementById("cv-original"),
    noisy: document.getElementById("cv-noisy"),
    conventional: document.getElementById("cv-conventional"),
    proposed: document.getElementById("cv-proposed"),
  },
  canvas_filter: {
    noisy: document.getElementById("cv-noisy"),
    conventional: document.getElementById("cv-conventional"),
    proposed: document.getElementById("cv-proposed"),
  },

  status: {
    original: document.getElementById("st-original"),
    noisy: document.getElementById("st-noisy"),
    conventional: document.getElementById("st-conventional"),
    proposed: document.getElementById("st-proposed"),
  },
};

let noiseImgBlob = null;
let cleanImgBlob = null;

/* =========================================================
 * 3. 유틸리티
 * ========================================================= */

function cloneImageData(src) {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 이미지파일을 캔버스에 그린다.
function drawToCanvas(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  canvas.classList.remove("empty");
}

// 서버가 준 data URL을 이미지파일로 변환후 캔버스에 그린다
async function drawDataUrl(canvas, dataUrl) {
  const img = await loadImage(dataUrl);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  canvas.classList.remove("empty");
}

//캔버스 class에 empty 속성 넣기
function clearCanvas(canvas) {
  canvas.classList.add("empty");
}

// 이미지 소스를 처리가능한 가로길이에 맞추어 가로세로비율대로 축소한 ImageData로 변환한다.
function imageToImageData(img) {
  const scale = Math.min(
    1,
    CONFIG.maxSize /
      Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height),
  );
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h); // file:// 환경에서는 여기서 SecurityError가 발생한다.
}

//서버에 넘어온 이미지데이터(src 경로)를 img형태로 메모리에 로딩한다
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했다: " + src));
    img.src = src;
  });
}

/////////////////////////////////////////////////////////////////////////////
// function itemToBlob(item)
// 이미지항목을 서버로 보낼 Blob으로 변환한다
//
// Blob으로 보내는 것은 별도의 변환 작업이 아니라 브라우저에서 이미지를 서버로 보낼 때
// 존재하는 유일한 실용적 방법이기 때문이다.
//
// 오해가 생기는 세 가지 경우를 나누어 설명한다.
//
// 첫째, File을 Blob으로 감싸는 것 아니냐는 오해이다.
// 실제로는 감싸는 것이 아니다.
// postProcess(file)에서 <input type="file">로 얻은 File 객체를 그대로 넘기고 있으며,
// File은 Blob을 상속한 인터페이스이므로 이미 그 자체가 Blob이다.
// 즉 File을 그냥 넘길 때는 아무런 변환도 일어나지 않고,
// 브라우저는 파일 시스템의 원본 바이트를 그대로 multipart 본문에 실어 보낸다.
// Blob 생성이 의미 있는 경우는 파일이 아닌 상태에서 시작할 때뿐이다.
// 예를 들어 캔버스에 그린 결과나 fetch로 받은 이미지처럼 파일 시스템이 아니라 메모리 안에 있는
//  데이터를 서버로 보내려면, 그것을 하나의 바이트 덩어리로 취급할 수 있는 손잡이가 필요하다.
// 이때 쓰이는 것이 Blob이다.
//
// 둘째, "원본"이 캔버스에 그려진 픽셀 상태를 뜻하는 경우이다.
// 캔버스에 표시된 그림을 서버로 보내는 방법은 canvas.toBlob이나 canvas.toDataURL로
// PNG 또는 JPEG 파일 형식으로 직렬화하는 것뿐이다.
// 캔버스의 픽셀 배열(RGBA 4바이트씩 이어진 원시 데이터)을 그대로 보낼 수도 있지만,
// 이 경우 폭과 높이, 채널 순서, 색 공간을 별도 필드로 함께 보내야 하고
// 수 MB의 무압축 데이터가 그대로 네트워크를 타고 흐른다.
// 384×384 이미지만 해도 원시 픽셀은 약 590KB이지만 PNG로 압축하면 수십 KB로 줄어든다.
// 서버 쪽 코드에서도 cv2.imdecode 한 줄로 numpy 배열로 되돌릴 수 있어 처리 코드가 짧아진다.
// Blob으로 보내는 이유는 결국 표준화된 파일 형식으로 압축된 바이트 덩어리를 다루는 것이
// 크기, 속도, 코드 단순성 모두에서 유리하기 때문이다.
//
// 셋째, "원본"이 이미지 경로 문자열이나 <img> 요소, HTMLCanvasElement 같은 객체를 뜻하는 경우이다.
// 이런 것들은 브라우저 안에서만 의미가 있는 참조이므로 네트워크로 보낼 수 없다.
// 문자열 경로를 보내면 서버는 그 경로가 자신의 파일 시스템에 존재하는지 알 방법이 없고,
// DOM 객체는 JavaScript 런타임에 묶인 참조라 직렬화 자체가 불가능하다.
// fetch의 body에 넣을 수 있는 타입은 문자열, ArrayBuffer, TypedArray, Blob(File 포함),
// FormData, ReadableStream, URLSearchParams로 제한되어 있으며,
// 이미지처럼 이진 데이터를 보내는 경우 사실상 Blob(FormData에 담긴 형태 포함) 외에는 선택지가 없다.
// 즉 Blob은 우회 경로가 아니라 이진 파일을 보내는 표준 통로이다.
//
// 그리고 왜 Blob을 FormData에 담아 보내는가 하는 부수적인 질문이 있을 수 있다.
// Blob을 fetch의 body에 직접 넣으면 파일명 없이 순수한 바이트만 전송되어
// 서버가 FastAPI의 UploadFile로 받을 수 없다.
// FormData에 담아 multipart/form-data 형식으로 보내야
// file이라는 필드 이름과 파일명이 함께 전달되어 서버가 UploadFile로 받을 수 있으며,
// 나중에 여러 필드(예: 노이즈 강도, 필터 종류)를 함께 보낼 때도 그대로 확장할 수 있다.
//
// 매개변수 item = {name, src(img file path), file (파일을 직접선택한 겅우)}
async function itemToBlob(item) {
  if (item.file) return item.file; // 업로드한 파일

  const res = await fetch(item.src); // IMAGE_LIST 경로

  if (!res.ok) throw new Error("이미지를 불러오지 못했다: " + item.src);
  return res.blob();
}

//서버에서 받은 이미지url을 다시 blob으로 변경
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl); // 네트워크 왕복 없음, base64 디코딩만 수행
  return res.blob();
}

//캔버스에서 서버로 보낼 image blob 추출
function canvasToBlob(canvas, type = "image/png") {
  if (canvas.classList.contains("empty") || !canvas.width || !canvas.height) {
    return Promise.reject(new Error("캔버스에 이미지가 없다"));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("캔버스 변환 실패"))),
      type,
    );
  });
}

// items: { name, src?, sampleKind? }
const state = { items: [], selected: -1, runId: 0 };

function getProposedFilterName() {
  return PROPOSED_FILTERS[proposedFilterIndex];
}

function setStatus(key, text, kind) {
  const el = els.status[key];
  el.textContent = text;
  el.dataset.state = kind || "";

  if (key === "proposed")
    if (kind === "busy") {
      els.proposedToggle.disabled = true;
    } else {
      els.proposedToggle.disabled = false;
    }
  //spinner 실행여부 토글
  el.closest(".stage").classList.toggle("busy", kind === "busy"); // 추가
}

function resetStages(canvasEls) {
  for (const key of Object.keys(canvasEls)) {
    clearCanvas(els.canvas[key]);
    setStatus(key, "대기");
    noiseImgBlob = null;
    cleanImgBlob = null;
  }
}

/* =========================================================
 * 4. 사이드 목록버튼 선택시 실행 : 목록 -> 원본 -> 필터1,2,3
 * ========================================================= */

async function selectItem(i) {
  if (i < 0 || i >= state.items.length) return;

  if (state.selected === i) return;

  state.selected = i;

  //다른항목이 선택되었으므로 화면좌측 이미지목록을 다시그린다
  renderList();
  els.list.querySelectorAll("button")[i].focus({ preventScroll: false });

  //캔버스지우기, 캔버스 상태표시 지우기
  resetStages(els.canvas);

  //원본이미지그리기
  drawOriginal(state.items[i]);
  //원본이미지 서버로 보내서 필터이미지 받아온다
  await runPipelineRemote(state.items[i]);
}

/* =========================================================
 * 7. 목록 렌더링
 * ========================================================= */
//state = {name(파일명 또는 이미지번호), src(파일경로)}
function renderList() {
  els.list.innerHTML = "";
  state.items.forEach((item, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span>${item.name}</span> <img src="${item.src}" alt="${item.name}" class="sidebar-img" />`;
    btn.setAttribute("aria-current", i === state.selected ? "true" : "false");
    btn.setAttribute("class", "sidebar-btn");
    btn.addEventListener("click", () => selectItem(i));
    li.appendChild(btn);
    els.list.appendChild(li);
  });
  els.proposedToggle.textContent = getProposedFilterName();
}

//item = {name, src(img file path)}
//이미지경로를 매개변수로 받아 이미지파일 Image data 반환
async function getItemImageData(item) {
  const img = await loadImage(item.src);
  // img를 축소해서 반환
  return imageToImageData(img);
}

/* =========================================================
 * 8. 원본파일 캔버스에 그리기
 * ========================================================= */
async function drawOriginal(item) {
  // 상태설정
  setStatus("original", "불러오는 중", "busy");

  let original;
  try {
    original = await getItemImageData(item);
  } catch (err) {
    const msg =
      err.name === "SecurityError"
        ? "픽셀 접근 차단됨. 로컬 서버로 실행해야 한다."
        : "불러오기 실패";
    setStatus("original", msg);
    console.error(err);
    return;
  }

  drawToCanvas(els.canvas.original, original);

  //상태표시
  setStatus("original", original.width + "×" + original.height, "done");
  await sleep(CONFIG.stepDelay);
}

// server request 회신결과 json형태
//{
//   "width": w,
//   "height": h,
//   "original": { "image": to_data_url(img) },
//   "noisy": { "image": to_data_url(noisy), "ms": round(t_noise, 1) },
//   "conventional": { "image": to_data_url(conv), "ms": round(t_conv, 1) },
//   "proposed": { "image": to_data_url(prop), "ms": round(t_prop, 1) },
// }

let currentRequest = null;
let proposedRequest = null;
let proposedRequest2 = null;
let noise_result, filter_result;

/* =========================================================
 *  9. 서버로 이미지를 보내서 필터처리후 필터처리된 이미지 회신받아서 캔버스 그리기
 * ========================================================= */
async function runPipelineRemote(item) {
  const myRun = ++state.runId;
  const alive = () => myRun === state.runId;
  //const keys = ["original", "noisy", "conventional", "proposed"];
  let keys = ["noisy", "conventional", "proposed"];

  currentRequest?.abort(); // 이전 요청을 실제로 취소
  proposedRequest?.abort();
  proposedRequest2?.abort();
  currentRequest = new AbortController();

  resetStages(els.canvas_filter);
  keys.forEach((k) => setStatus(k, "서버 처리 중", "busy"));

  //토글버튼잠금
  els.proposedToggle.disabled = true;

  try {
    //등록된 img파일 blob형태로 변경후 서버전송준비를 한다
    cleanImgBlob = await itemToBlob(item);
    const noiseStrength = Number(els.noiseStrength.value);

    //노이지이미지생성
    noise_result = await postProcessNoise(cleanImgBlob, {
      filename: item.name,
      filenameClean: "clean.png",
      noiseStrength,
      signal: currentRequest.signal,
    });

    //회신받은 노이지이미지 캔버스출력
    await drawDataUrl(els.canvas["noisy"], noise_result["noisy"].image);
    setStatus("noisy", `완료 · ${noise_result["noisy"].ms} ms`, "done");

    noiseImgBlob = await dataUrlToBlob(noise_result["noisy"].image);

    //필터처리하기
    //smf_3x3 필터처리하기
    filter_result = await postFilter_smf33(noiseImgBlob, {
      filename: item.name,
      signal: currentRequest.signal,
    });
    await drawDataUrl(
      els.canvas["conventional"],
      filter_result["conventional"].image,
    );
    setStatus(
      "conventional",
      `완료 · ${filter_result["conventional"].ms} ms`,
      "done",
    );

    //wmm_ii or recursive_twmf 필터처리하기
    filter_result = await postProcessFilter(noiseImgBlob, cleanImgBlob, {
      filename: item.name,
      signal: currentRequest.signal,
      noiseStrength,
      proposedFilter: getProposedFilterName(),
    });

    await drawDataUrl(els.canvas["proposed"], filter_result["proposed"].image);
    setStatus("proposed", `완료 · ${filter_result["proposed"].ms} ms`, "done");
  } catch (err) {
    if (err.name === "AbortError" || !alive()) return;
    keys.forEach((k) => setStatus(k, "오류"));
    setStatus("original", err.message);
    console.error(err);
    return;
  } finally {
    //  els.proposedToggle.disabled = false;
  }
}

/* =========================================================
 *   서버에서 필터처리된 이미지 회신받아서 캔버스 그리기
 * ========================================================= */
async function runToggleFilterRemote() {
  proposedRequest?.abort();
  proposedRequest = new AbortController();
  proposedRequest2?.abort();
  proposedRequest2 = new AbortController();

  clearCanvas(els.canvas.proposed);
  setStatus("proposed", "서버 처리 중", "busy");

  const noiseStrength = Number(els.noiseStrength.value);

  try {
    if (noiseImgBlob === null)
      noiseImgBlob = await canvasToBlob(els.canvas.noisy);

    const currentFilter = getProposedFilterName();

    if (currentFilter === "WMM_II") {
      filter_result = await postProcessFilter(noiseImgBlob, cleanImgBlob, {
        filename: "noisy.png",
        filenameClean: "clean.png",
        proposedFilter: currentFilter,
        signal: proposedRequest.signal,
      });
      //recursive_twmf, recursive_wmmii ..
    } else {
      filter_result = await postProcessFilter(noiseImgBlob, null, {
        filename: "noisy.png",
        filenameClean: "clean.png",
        proposedFilter: currentFilter,
        signal: proposedRequest2.signal,
        noiseStrength,
      });
    }
    await drawDataUrl(els.canvas.proposed, filter_result.proposed.image);
    setStatus("proposed", `완료 · ${filter_result.proposed.ms} ms`, "done");
    els.proposedToggle.disable = false;
  } catch (err) {
    console.log("err abort - index 373");
    if (err.name === "AbortError") return;
    setStatus("proposed", "오류");
    console.error(err);
  } finally {
  }
}
/* =========================================================
 * 8. 이벤트
 * ========================================================= */

// 사용자가 추가한 이미지 파일들을 목록에 넣는다.
els.file.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  const start = state.items.length;
  files.forEach((f) =>
    state.items.push({ name: f.name, src: URL.createObjectURL(f), file: f }),
  );
  renderList();
  if (files.length) selectItem(start);
  e.target.value = "";
});

// 위아래 방향키로 목록 이동 (전시장 키보드 조작용)
document.addEventListener("keydown", (e) => {
  if (!state.items.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectItem(Math.min(state.items.length - 1, state.selected + 1));
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    selectItem(Math.max(0, state.selected - 1));
  }
});

els.fullscreen.addEventListener("click", () => {
  if (!document.fullscreenElement)
    document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// 강도 select option 다른 값이 선택되었을 때
els.noiseStrength.addEventListener("change", () => {
  if (state.selected < 0) return;
  runPipelineRemote(state.items[state.selected]);
});

els.proposedToggle.addEventListener("click", async () => {
  const el = els.status["proposed"];
  if (el.dataset.state === "busy") return;

  proposedFilterIndex = (proposedFilterIndex + 1) % PROPOSED_FILTERS.length;
  els.proposedToggle.textContent = getProposedFilterName();

  // 오른쪽 아래 칸에 아직 그릴 원본(노이즈 이미지)이 없다면 여기서 끝
  if (els.canvas.noisy.classList.contains("empty")) return;

  //버튼잠금
  els.proposedToggle.disabled = true;

  await runToggleFilterRemote();
});
/* =========================================================
 * 10. 초기화
 * ========================================================= */

(function init() {
  state.items = IMAGE_LIST.map((x) => ({ ...x }));
  renderList();
})();
