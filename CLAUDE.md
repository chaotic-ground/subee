# Terminology

- **페이지 새로고침** — 브라우저 F5/Cmd+R. 전체 JS 상태 초기화.
- **피드 새로고침** — 앱 내 Refresh 버튼 클릭. 폴링을 시작하는 동작.

## 페이지 새로고침 흐름

1. 커서 캐시(`subee:cursors:{instanceUrl}`, TTL 7일)와 게시물 캐시(`subee:posts:{instanceUrl}`, TTL 7일)를 localStorage에서 복원.
2. 캐시가 유효하고 모든 구독 handle이 커서 캐시에 포함되면 → 즉시 피드 표시 (API 호출 없음).
3. 캐시가 없거나 새 handle이 있으면 → 계정 resolve(`initCursors`) 후 초기 게시물 fetch(`fetchMore`).
4. 페이지 새로고침 후 자동 폴링 없음 — 사용자가 직접 Refresh 버튼으로 폴링 시작.

## 피드 새로고침 흐름

1. **폴링 (polling)** — Refresh 클릭 후 각 계정의 새 게시물을 API로 가져오는 작업. 진행 중에는 `N/total` pill 표시.
2. **버퍼 (buffer)** — 폴링 완료 후 피드에 아직 반영되지 않은 게시물 임시 보관소. "N new" 버튼으로 표시됨 (대기 중 상태).
3. **피드 반영 (flush)** — "N new" 클릭 시 버퍼를 피드에 표시하는 동작. 구분선과 함께 해당 위치로 스크롤.

## 엔드유저 UI

### 화면 구성

- **헤더** — 화면 상단 고정. 앱 이름(subee), 탭 전환 버튼, 설정 버튼(⚙).
- **탭** — Subscribed(구독 피드)와 Home(인스턴스 홈 타임라인) 두 가지.
- **피드** — 탭 아래 스크롤 영역. 게시물 카드 목록.
- **계정 상태 표시** — 피드 상단에 계정별 컬러 dot. 초기 로딩 시 또는 실패 계정이 있을 때 표시. dot을 탭하면 해당 계정 handle과 상태 확인 가능.
- **새로고침 버튼** — 스크롤을 내리면 화면 상단 중앙에 뜨는 플로팅 버튼. 상태에 따라 세 가지 모습으로 변함 (아래 참고).
- **구분선** — 피드 반영 후 새 게시물과 기존 게시물 사이에 "New posts" 텍스트와 함께 표시되는 선.

### 새로고침 버튼 상태

| 모습 | 의미 | 탭 시 동작 |
|------|------|-----------|
| 회색 "Refresh · checked Xm ago" | 폴링 대기 중 | 폴링 시작 |
| `● N/total` (회색 pill) | 폴링 진행 중 | 반응 없음 |
| 파란 "N new" | 버퍼에 N개 대기 중 | 피드 반영 |

### 설정 메뉴 (⚙)

헤더 우측 톱니바퀴 버튼을 탭하면 열리는 드롭다운.

- **인스턴스 hostname** — 현재 로그인된 인스턴스 표시 (비활성).
- **Export subscriptions** — 구독 목록을 텍스트로 클립보드에 복사.
- **Import subscriptions** — 텍스트로 구독 목록을 일괄 교체.
- **Subscribe to account** — 단일 handle을 구독 목록에 추가.
- **Exclude subscribed** — 체크 시 Subscribed 탭의 게시물에서 이미 구독한 계정 게시물을 Home 탭에서 숨김.
- **Background sync** — 체크 시 브라우저가 백그라운드(앱 닫혀 있을 때 포함)에서 주기적으로 새 게시물을 폴링. minInterval 12시간이지만 실제 간격은 브라우저가 결정. 지원하지 않는 브라우저(Firefox/Safari)에서는 항목 숨김. 권한이 거부되면 자동으로 off로 되돌아감.
- **Log out** — 탭 시 "Log out? / Yes / Cancel" 확인 후 로그아웃.

### 게시물 카드

- 계정 이름, 아바타, 게시 시간, 본문, 미디어, boost/favourite 수 표시.
- **+ Subscribe / Subscribed** 버튼으로 해당 계정 구독 토글.
- CW(content warning) 있는 게시물은 접힌 상태로 표시, "Show content"로 펼침.
