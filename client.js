"use strict";

// 서버 오류를 상태 코드와 함께 전달하기 위한 오류 클래스
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0이면 네트워크 오류 또는 시간 초과
  }
}

///////////////노이즈처리 엔드포인트 호출/////////////////////////////////////////////
// endpoint = + /process/noise
export async function postProcessNoise(
  image,
  {
    filename = "image.png",
    noiseStrength = 10,
    timeoutMs = 60000,
    signal,
  } = {},
) {
  const form = new FormData();

  // append 첫번째 인자 'file'은 서버의 매개변수 이름과 같아야 한다
  form.append("file", image, image.name || filename);
  form.append("noise_strength", String(noiseStrength)); // 반드시 문자열로

  // 시간 초과와 외부 취소를 하나의 AbortController로 합친다
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("timeout", "TimeoutError")),
    timeoutMs,
  );

  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    // Content-Type 헤더는 지정하지 않는다 (브라우저가 boundary 포함해 자동 설정)
    // 서버에 그림파일보내서 결과회신받기
    const res = await fetch(API_BASE + "/process/noise", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    //응답이 정상이 아니면 오류코드 생성
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json(); // FastAPI 오류 형식: {"detail": "..."}
        if (body && body.detail) detail = body.detail;
      } catch {
        /* JSON이 아니면 statusText 사용 */
      }
      throw new ApiError(res.status, detail);
    }
    //정상이면 응답 회신
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) {
      if (controller.signal.reason?.name === "TimeoutError") {
        throw new ApiError(0, `${timeoutMs / 1000}초 안에 응답이 없다`);
      }
      throw err; // 외부 취소는 AbortError 그대로 전달
    }
    throw new ApiError(0, "서버연결실패 (서버 실행 여부 또는 주소 확인)");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

///////////////////////////////////////////////////////////////////////////////////
/* 노이지 처리이미지 필터링엔드포인드 process/filter 로 보내고 처리 결과(JSON)를 반환한다.
 * url + /process/filter
 * wwm_ii 방식은 노이지이미지와 클린이미지 2장이 필요 : 학습을 해서 가중치값 구함
 * 클린이미지가 없으면 기존 학습결과 저장한 가중치를 사용함
 * recursive_wwm_ii, recursive_twmf_rgb는 노이지이미지 1장보내면 됨
 * 또다른 필터함수를 등록할 경우, proposedFilter에 필터함수를 보내고
 * 서버쪽 server.py 파일내 process_filter_all 함수에 조건문으로 처리함수 추가해주면됨
 */
export async function postProcessFilter(
  image,
  imageClean,
  {
    filename = "image.png",
    filenameClean = "clean.png",
    timeoutMs = 600000,
    signal,
    noiseStrength = 10,
    proposedFilter = "WMM_II",
  } = {},
) {
  const form = new FormData();

  // 첫번째인자 'file_noise'은 서버의 매개변수 이름과 같아야 한다
  form.append("file_noise", image, image.name || filename);

  if (imageClean !== undefined && imageClean !== null) {
    form.append("file_clean", imageClean, imageClean.name || filenameClean);
  }
  form.append("noise_strength", String(noiseStrength)); // 반드시 문자열로
  if (proposedFilter !== undefined) {
    form.append("proposed_filter", proposedFilter);
  }
  // 시간 초과와 외부 취소를 하나의 AbortController로 합친다
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("timeout", "TimeoutError")),
    timeoutMs,
  );

  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    // Content-Type 헤더는 지정하지 않는다 (브라우저가 boundary 포함해 자동 설정)
    // 서버에 그림파일보내서 결과회신받기
    const res = await fetch(API_BASE + "/process/filter", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    //응답이 정상이 아니면 오류코드 생성
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json(); // FastAPI 오류 형식: {"detail": "..."}
        if (body && body.detail) detail = body.detail;
      } catch {
        /* JSON이 아니면 statusText 사용 */
      }
      throw new ApiError(res.status, detail);
    }
    //정상이면 응답 회신
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) {
      if (controller.signal.reason?.name === "TimeoutError") {
        throw new ApiError(0, `${timeoutMs / 1000}초 안에 응답이 없다`);
      }
      throw err; // 외부 취소는 AbortError 그대로 전달
    }
    throw new ApiError(0, "서버연결실패 (서버 실행 여부 또는 주소 확인)");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

////////////////////SMF33 호출함수////////////////////////////////////////
// endpoint == /process/filter_smf33
export async function postFilter_smf33(
  image,
  { filename = "image.png", timeoutMs = 60000, signal } = {},
) {
  const form = new FormData();

  // append 첫번째 인자 'file'은 서버의 매개변수 이름과 같아야 한다
  form.append("file", image, image.name || filename);

  // 시간 초과와 외부 취소를 하나의 AbortController로 합친다
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("timeout", "TimeoutError")),
    timeoutMs,
  );

  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    // Content-Type 헤더는 지정하지 않는다 (브라우저가 boundary 포함해 자동 설정)
    // 서버에 그림파일보내서 결과회신받기
    const res = await fetch(API_BASE + "/process/filter_smf33", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    //응답이 정상이 아니면 오류코드 생성
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json(); // FastAPI 오류 형식: {"detail": "..."}
        if (body && body.detail) detail = body.detail;
      } catch {
        /* JSON이 아니면 statusText 사용 */
      }
      throw new ApiError(res.status, detail);
    }
    //정상이면 응답 회신
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) {
      if (controller.signal.reason?.name === "TimeoutError") {
        throw new ApiError(0, `${timeoutMs / 1000}초 안에 응답이 없다`);
      }
      throw err; // 외부 취소는 AbortError 그대로 전달
    }
    throw new ApiError(0, "서버연결실패 (서버 실행 여부 또는 주소 확인)");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
