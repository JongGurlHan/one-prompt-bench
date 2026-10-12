/**
 * 조건 위반 규칙 (season-tree-v1 프롬프트의 "three.js만, 버전 고정, 다른 라이브러리·이미지 금지")
 *
 *  three          three.js 본체·부가 모듈, 버전 고정       → 허용
 *  three_unpinned three.js인데 버전이 고정되지 않음         → 지시 미준수
 *  library        three.js가 아닌 자바스크립트             → 위반
 *  image          이미지 파일                             → 위반
 *  other          웹폰트·스타일시트 등 그 밖의 요청          → 참고로만 표시
 *
 * 위반이어도 결과물은 그대로 보여주고 표시만 한다. 판정은 meta.json에 저장하지 않고
 * 기록된 externalRequests에서 매번 계산한다 (규칙이 바뀌어도 기록을 고칠 필요가 없게).
 */

export interface ExternalRequest {
  url: string;
  resourceType: string; // Playwright request.resourceType(): script, image, font, stylesheet, fetch ...
}

export type RequestKind = 'three' | 'three_unpinned' | 'library' | 'image' | 'other';
export type Verdict = 'ok' | 'instruction_miss' | 'violation';

export interface RequestReport {
  verdict: Verdict;
  items: { url: string; kind: RequestKind }[];
}

// three 패키지: jsDelivr·unpkg(/three@x/...), esm.sh(/three@x 또는 /v135/three@x/...), cdnjs(/three.js/r170/), 공식 사이트
// 'three-stdlib'처럼 이름만 비슷한 다른 패키지는 걸리지 않도록 'three' 뒤에 @, /, ?, 끝만 허용
const THREE_ANY = /(^|\/)three(@[^/?#]*)?(?=[/?#]|$)|\/three\.js\/|^threejs\.org\//;
// 고정 버전: three@0.170.0 처럼 정확한 x.y.z, 또는 cdnjs의 r170 (latest, ^0.170, 0.170 같은 범위는 고정 아님)
const THREE_PINNED = /(^|\/)three@\d+\.\d+\.\d+(?=[/?#]|$)|\/three\.js\/r\d+\//;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|hdr|exr|ktx2|basis)$/i;
const SCRIPT_EXT = /\.(m?js|cjs)$/i;

export function classifyRequest(req: ExternalRequest): RequestKind {
  const u = new URL(req.url);
  const target = `${u.hostname}${u.pathname}`;

  if (THREE_ANY.test(target)) return THREE_PINNED.test(target) ? 'three' : 'three_unpinned';
  if (req.resourceType === 'image' || IMAGE_EXT.test(u.pathname)) return 'image';
  if (req.resourceType === 'script' || SCRIPT_EXT.test(u.pathname)) return 'library';
  return 'other';
}

export function judgeRequests(requests: readonly ExternalRequest[]): RequestReport {
  const items = requests.map((r) => ({ url: r.url, kind: classifyRequest(r) }));
  const has = (k: RequestKind) => items.some((i) => i.kind === k);
  const verdict: Verdict =
    has('library') || has('image') ? 'violation' : has('three_unpinned') ? 'instruction_miss' : 'ok';
  return { verdict, items };
}
