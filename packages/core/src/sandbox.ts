/**
 * 모델이 만든 결과물을 실행하는 iframe의 sandbox 값 (ADR-009, 단일 출처).
 * 사이트(결과 탭·새 창 래퍼)와 검증기가 같은 조건으로 실행하도록 이 상수만 쓴다.
 * allow-same-origin을 넣지 않는다: GitHub Pages는 계정의 모든 사이트가 한 출처를 쓰므로
 * 결과물 코드가 다른 사이트의 저장소에 접근할 수 있게 된다.
 */
export const RESULT_IFRAME_SANDBOX = 'allow-scripts';
