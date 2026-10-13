import type { ResultView } from '../lib/results-view.ts';

/* ────────────────────────────────────────────────────────────
 * 결과 탭 클라이언트 동작 (ADR-018 — 순수 TypeScript): 모델 전환 · 다시 시작 · 응답 원문 불러오기
 * 표시 값은 빌드 때 페이지에 넣은 JSON(#result-views)을 그대로 옮긴다. 라벨·포맷을 여기서 만들지 않는다.
 * 모델은 버튼 목록(넓은 화면)이나 선택기(휴대폰)로 고른다. 둘 다 같은 select()를 지나고, 두 컨트롤의 선택 상태는 늘 같다.
 * 결과물은 한 번에 하나만 실행한다(ADR-009): 결과물이 없는 모델을 고르면 iframe을 문서에서 떼어 내서
 * 앞의 결과물이 계속 돌지 않게 하고, 결과물이 있는 모델을 고르면 같은 iframe을 새 src로 다시 붙인다.
 * ──────────────────────────────────────────────────────────── */

export function setupResultsTab(doc: Document = document): void {
  const root = doc.querySelector<HTMLElement>('[data-results-tab]');
  const data = doc.getElementById('result-views');
  if (!root || !data) return; // 모델이 하나도 없다

  const views = new Map((JSON.parse(data.textContent ?? '[]') as ResultView[]).map((v) => [v.slug, v]));
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`results tab: no ${selector}`);
    return el;
  };
  const field = (name: string) => one(`[data-field="${name}"]`);

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-slug]')];
  const picker = one<HTMLSelectElement>('select[data-field="model-select"]');
  const name = field('name');
  const meta = field('meta');
  const actions = field('actions');
  const restart = one<HTMLButtonElement>('button[data-action="restart"]');
  const openLink = one<HTMLAnchorElement>('a[data-action="open"]');
  const viewer = field('viewer');
  const missing = field('missing');
  const reason = field('reason');
  const response = field('response');
  const responseText = field('response-text');
  const responseError = field('response-error');
  const note = field('note');
  // 빌드 HTML에 iframe이 없으면 결과물이 있는 모델도 없다 (첫 선택은 결과물이 있는 첫 모델)
  const frame = viewer.querySelector('iframe');

  let selected = buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.slug;
  // 선택기는 눌린 버튼을 따른다 (뒤로 가기로 돌아올 때 브라우저가 예전 선택기 값을 되살려도 어긋나지 않게)
  if (selected !== undefined) picker.value = selected;
  /** 마지막으로 고른 모델의 원문 요청 번호. 늦게 온 앞 모델의 원문을 버린다 */
  let responseTicket = 0;
  const responseCache = new Map<string, string>();

  function select(slug: string) {
    const view = views.get(slug);
    if (!view || slug === selected) return;
    selected = slug;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.slug === slug));
    picker.value = slug;
    name.textContent = view.displayName;
    meta.textContent = view.runMeta;
    showOutput(view);
    void showResponse(view);
    fillCards(view);
  }

  function showOutput({ output, missing: why }: ResultView) {
    if (output && frame) {
      frame.title = output.frameTitle;
      // 떼어 낸 iframe은 src를 바꿔도 불러오지 않는다 → 붙일 때 한 번만 불러온다
      if (frame.getAttribute('src') !== output.src) frame.setAttribute('src', output.src);
      if (!frame.isConnected) viewer.prepend(frame);
      openLink.setAttribute('href', output.viewHref);
    } else {
      frame?.remove();
    }
    actions.hidden = output === null;
    missing.hidden = output !== null;
    reason.textContent = why?.reason ?? '';
  }

  async function showResponse({ missing: why }: ResultView) {
    const src = why?.responseTextSrc ?? null;
    const ticket = ++responseTicket;
    response.hidden = src === null;
    responseText.textContent = '';
    responseText.hidden = false;
    responseError.hidden = true;
    if (src === null) return;

    let text = responseCache.get(src);
    if (text === undefined) {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
        responseCache.set(src, text);
      } catch {
        if (ticket !== responseTicket) return;
        responseText.hidden = true;
        responseError.hidden = false;
        return;
      }
    }
    if (ticket === responseTicket) responseText.textContent = text; // 글자 그대로 (HTML로 해석하지 않는다)
  }

  function fillCards(view: ResultView) {
    for (const r of view.requirements) {
      const cell = one(`[data-req="${r.key}"]`);
      cell.textContent = r.text;
      cell.dataset.mark = r.mark ?? 'none';
    }
    note.hidden = view.note === null;
    note.textContent = view.note ?? '';
    for (const [key, value] of Object.entries(view.record)) one(`[data-record="${key}"]`).textContent = value;
  }

  for (const b of buttons) b.addEventListener('click', () => b.dataset.slug && select(b.dataset.slug));
  // 같은 모델을 다시 고르면 select()가 아무것도 하지 않는다
  picker.addEventListener('change', () => select(picker.value));

  // 같은 src를 다시 설정하면 결과물을 처음부터 다시 불러온다
  restart.addEventListener('click', () => {
    const src = frame?.getAttribute('src');
    if (frame?.isConnected && src) frame.setAttribute('src', src);
  });

  // 첫 선택이 원문을 보여 주는 모델이면 (결과물이 하나도 없을 때) 바로 불러온다
  const first = selected === undefined ? undefined : views.get(selected);
  if (first) void showResponse(first);
}
