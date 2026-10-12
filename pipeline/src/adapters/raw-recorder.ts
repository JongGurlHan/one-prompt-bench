/* ────────────────────────────────────────────────────────────
 * smoke용 원본 출력 기록기 (ARCHITECTURE "smoke").
 * core 어댑터 인터페이스는 그대로 두고, 어댑터에 주입하는 클라이언트(SDK 클라이언트·프로세스 실행 함수)를
 * 감싸 받은 그대로 모은다. 파일은 Runner가 끝난 뒤 smoke가 저장 폴더에 쓴다(Runner는 빈 폴더를 요구한다).
 * Gemini는 스트림 청크·에러, phase 3·4의 CLI는 stdout·stderr를 같은 모양으로 내준다.
 * ──────────────────────────────────────────────────────────── */

/** 저장 폴더에 쓸 파일 하나. name은 Runner 파일(meta.json 등)과 겹치지 않게 raw-로 시작한다 */
export interface RawFile {
  name: string;
  content: string;
}

/** 사람에게 보이거나 파일로 남는 문자열에서 비밀값(API 키)을 가린다 */
export type Redact = (text: string) => string;

export interface RawRecorder<Client> {
  /** 클라이언트를 감싼다. 요청·응답·에러는 바꾸지 않고 그대로 통과시킨다 */
  wrap(client: Client): Client;
  /** 지금까지 기록한 파일. 호출이 없었으면 빈 배열 */
  files(): RawFile[];
}

/** raw-<소문자·숫자·.·->만. 경로 구분자가 들어가 저장 폴더 밖을 가리키지 못하게 한다 */
export const RAW_FILE_NAME = /^raw-[a-z0-9][a-z0-9.-]*$/;
