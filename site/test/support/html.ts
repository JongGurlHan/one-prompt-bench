/* ────────────────────────────────────────────────────────────
 * 빌드한 HTML을 검사하는 작은 도구 (파서 의존성 없이)
 * Astro 출력은 속성을 큰따옴표로 감싸고 요소를 같은 이름으로 중첩하지 않는 범위에서만 쓴다.
 * ──────────────────────────────────────────────────────────── */

export interface Element {
  /** 시작 태그 문자열 (<iframe …>) */
  tag: string;
  attrs: Map<string, string>;
  /** 닫는 태그까지의 안쪽 HTML. 빈 요소(meta·link 등)는 '' */
  inner: string;
}

const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);

/** 이름이 name인 요소 전부. 같은 이름의 요소가 중첩되면 안쪽은 따로 찾지 않는다 */
export function elements(html: string, name: string): Element[] {
  const re = VOID.has(name)
    ? new RegExp(`<${name}\\b([^>]*)>`, 'gi')
    : new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi');
  return [...html.matchAll(re)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf('>') + 1), attrs: attributes(m[1] ?? ''), inner: m[2] ?? '' }));
}

/** 첫 요소. 없으면 throw */
export function element(html: string, name: string): Element {
  const found = elements(html, name)[0];
  if (!found) throw new Error(`no <${name}> element`);
  return found;
}

/**
 * 이름이 name이고 속성이 where를 만족하는 요소 전부. elements와 달리 같은 이름의 중첩을 세어
 * 짝이 맞는 닫는 태그까지를 inner로 준다 (div 안의 div 등). 바깥 요소와 그 안의 요소를 모두 돌려준다.
 */
export function findAll(html: string, name: string, where: (attrs: Map<string, string>) => boolean = () => true): Element[] {
  const tags = [...html.matchAll(new RegExp(`<(/?)${name}\\b([^>]*)>`, 'gi'))];
  const out: Element[] = [];
  tags.forEach((open, i) => {
    if (open[1] === '/') return;
    const attrs = attributes(open[2] ?? '');
    if (!where(attrs)) return;
    const start = open.index + open[0].length;
    let inner = '';
    if (!VOID.has(name)) {
      let depth = 1;
      for (const tag of tags.slice(i + 1)) {
        depth += tag[1] === '/' ? -1 : 1;
        if (depth === 0) {
          inner = html.slice(start, tag.index);
          break;
        }
      }
      if (depth !== 0) throw new Error(`unclosed ${open[0]}`);
    }
    out.push({ tag: open[0], attrs, inner });
  });
  return out;
}

/** findAll의 첫 요소. 없으면 throw */
export function find(html: string, name: string, where?: (attrs: Map<string, string>) => boolean): Element {
  const found = findAll(html, name, where)[0];
  if (!found) throw new Error(`no matching <${name}> element`);
  return found;
}

/** class 속성에 그 이름이 있는지 (findAll의 where용) */
export const hasClass = (cls: string) => (attrs: Map<string, string>) => (attrs.get('class') ?? '').split(/\s+/).includes(cls);

/** 속성 name이 있는지, value를 주면 값까지 같은지 (findAll의 where용) */
export const hasAttr = (name: string, value?: string) => (attrs: Map<string, string>) =>
  value === undefined ? attrs.has(name) : attrs.get(name) === value;

/** 속성 문자열 → 이름(소문자)·값(엔티티 해제). 값 없는 속성은 '' */
export function attributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(/([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs.set(m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/** 태그를 지우고 엔티티를 푼 텍스트 (공백은 하나로) */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[lower]!;
  });
}

/** <meta name|property="key" content="…">의 content */
export function metaContent(html: string, key: string): string | undefined {
  return elements(html, 'meta').find((m) => m.attrs.get('name') === key || m.attrs.get('property') === key)?.attrs.get('content');
}

/** 링크·에셋 주소: a·link의 href, script·img·iframe·source의 src */
export function urls(html: string): string[] {
  const out: string[] = [];
  for (const [name, attr] of [
    ['a', 'href'],
    ['link', 'href'],
    ['script', 'src'],
    ['img', 'src'],
    ['iframe', 'src'],
    ['source', 'src'],
  ] as const) {
    for (const el of elements(html, name)) {
      const value = el.attrs.get(attr);
      if (value !== undefined) out.push(value);
    }
  }
  return out;
}
