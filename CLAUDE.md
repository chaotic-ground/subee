# Terminology

- **페이지 새로고침** — 브라우저 F5/Cmd+R. 전체 JS 상태 초기화.
- **피드 로딩/새로고침** — 당겨서 새로고침(또는 미로드 계정이 있을 때 뜨는 'Load N accounts' 버튼)이 호출하는 `refresh()`. 피드가 네트워크로 채워지는 **유일한** 경로(첫 로드·새 계정 로드·새 글 폴링 모두 포함). 앱은 스스로 로딩하지 않음. 별도의 idle "Refresh" 버튼은 없으며, 기존 계정을 polling(새 글 확인)하는 건 **당겨서 새로고침** 전용.

## 묵시적 포그라운드 로딩 없음 (핵심 원칙)

**앱 오픈·재개·로그인·subscribe·import 어느 경우에도 자동으로 포그라운드 로딩(`initCursors`/`fetchMore`/grid)을 하지 않는다.** 피드 로딩은 오직 사용자의 당겨서 새로고침(또는 미로드 계정이 있을 때의 'Load N accounts' 버튼)이 호출하는 `refresh()`으로만 일어난다. 이 원칙이 "오랜만에 켜면 켜자마자 로딩(grid/pill)" 증상을 구조적으로 제거한다.

## 페이지 새로고침(앱 오픈) 흐름

1. 커서 캐시(`subee:cursors:{instanceUrl}`, TTL 7일)와 게시물 캐시(`subee:posts:{instanceUrl}`, TTL 7일)를 복원해 **즉시 피드 표시 (API 호출 없음)**. 마운트 시 커서를 `cursorsRef`로 복원(모두 `done` 처리)해 두므로 이후 `refresh()`가 재-resolve 없이 폴링 가능. 커버되지 않은 handle이 있어도 grid를 띄우지 않음.
2. 백그라운드가 받아둔 글은 콜드 스타트 시 `consumeNativeSyncResults`로 게시물 캐시에 병합돼 피드에 바로 보임. 이때 새 글이 있으면 병합 직전의 최신 글 id(읽음 경계)를 `consumeNativeSyncResults`가 반환하고, 마운트 효과가 `dividerPostId`로 세팅해 **"New posts above" 구분선**을 그리며, `boundaryNonce`를 올려 **그 구분선이 화면 세로 중앙에 오도록 스크롤**(네트워크 호출 없음, 알림을 눌러 진입하는 경우 등). 구분선 위=처음 보는 새 글, 아래=이미 본 글이라 사용자는 위로 스크롤해 새 글을 읽음. 이 콜드 스타트 스크롤은 저장된 스크롤 앵커 복원을 대체함(둘이 충돌하지 않도록 `useRestoreScrollAnchor`를 skip). 한 화면 이상 아래로 스크롤하면 뜨는 "↑ Top" 버튼으로 최상단(=가장 새 글)으로 이동.
3. **자동 폴링/로딩 없음.** 추가 갱신은 백그라운드 동기화(자동) 또는 당겨서 새로고침(수동, `refresh()`)으로만.
4. 백그라운드에서 포그라운드로 복귀(`visibilitychange`)해도 폴링하지 않음 — 백그라운드 워커가 가져온 글만 끌어와 "N new" 버퍼로 노출.

## `refresh()` — 유일한 로딩 진입점

당겨서 새로고침과 Refresh 버튼이 호출. 동작 분기:

1. 아직 커서가 없는 구독 계정이 있으면(로그인 첫 로드, subscribe/import로 새로 추가된 계정) → 그 계정만 `resolveMissingCursors`로 resolve 후 초기 게시물 fetch. **grid는 이 명시적 로드 중에만** 표시. 빈 피드면 피드에 직접 채우고, 이미 글이 있으면 "N new" 버퍼로. 아직 로드 안 된 계정이 있으면 플로팅 버튼이 **"Load N accounts"**로 떠 로드가 대기 중임을 알림(`unloadedCount`, 커서 복원 완료 후에만 표시해 재오픈 시 깜빡임 없음).
2. 모든 구독 계정이 이미 로드돼 있으면 → 기존 계정을 poll해 새 글을 "N new" 버퍼로(`N/total` pill, grid 없음).

빈 상태 메시지: 구독이 아예 없으면 **"No subscriptions yet"**, 구독은 있는데 아직 로드 전이면 **"Slide to load"**(당겨서 새로고침 또는 'Load N accounts' 버튼 안내).

## 피드 새로고침 흐름

1. **폴링 (polling)** — 당겨서 새로고침 후 각 계정의 새 게시물을 API로 가져오는 작업. 진행 중에는 `N/total` pill 표시. 폴링은 조용히 진행됨 — 계정 상태 dot(초기 로딩 표시)을 띄우지 않음. HTTP 429를 받으면 이번 회차를 즉시 중단하고 `Retry-After`(없으면 `X-RateLimit-Reset`, 그래도 없으면 5분, 최대 1시간)만큼 다음 폴링을 건너뜀(웹·포그라운드 폴링도 Android 워커와 동일 정책). 폴링 중 일시적 실패(429·네트워크)는 dot으로 노출하지 않음.
2. **버퍼 (buffer)** — 폴링 완료 후 피드에 아직 반영되지 않은 게시물 임시 보관소. "N new" 버튼으로 표시됨 (대기 중 상태).
3. **피드 반영 (flush)** — "N new" 클릭 시 버퍼를 피드에 표시하는 동작. 새 글은 최상단에 삽입되고 화면은 **최상단(가장 새 글)으로 스크롤**(사용자가 새 글을 바로 읽도록). 구분선은 새 글과 기존 글 사이 경계로 남음. (콜드 스타트에서 마운트가 세팅한 경계 구분선은 `flushNonce`가 아닌 `boundaryNonce`를 올려 최상단이 아니라 구분선을 화면 중앙에 맞춰 스크롤함.)

## 엔드유저 UI

### 화면 구성

- **헤더** — 화면 상단 고정. 앱 이름(subee)과 구독 수 배지, 설정 버튼(⚙). (탭은 없음 — 구독 피드 단일 화면.)
- **피드** — 헤더 아래 스크롤 영역. 게시물 카드 목록(구독 계정 통합 피드).
- **계정 상태 표시** — 피드 상단에 계정별 컬러 dot. **사용자가 시작한 로드(`refresh()` → `resolveMissingCursors`+fetch) 전용** 표시 — 첫 로드/새 계정 로드 중 또는 거기서 실패한 계정이 있을 때만 표시. 캐시 적중으로 즉시 피드를 보여주는 재오픈이나 폴링(새 글만 가져오는 경우)에서는 표시되지 않음(성공한 폴링은 기존 실패 dot을 해제만 함). dot을 탭하면 해당 계정 handle과 상태 확인 가능.
- **플로팅 버튼** — 화면 상단 중앙에 뜨는 버튼. 스크롤 위치·상태에 따라 모습이 바뀌고, **최상단·할 일 없음(idle)이면 숨겨짐** (아래 참고). 모든 버튼은 탭 시 눌림 피드백(살짝 어두워지며 축소)을 줌.
- **당겨서 새로고침 (pull-to-refresh)** — 피드 최상단에서 아래로 당기면 폴링 시작. 당기는 동안 상단에 원형 인디케이터가 따라 내려오고, 임계값(`PULL_THRESHOLD`)을 넘기면 색이 바뀜(arm). 임계값을 넘겨 손을 떼면 폴링, 못 넘기면 취소. 최상단(scrollTop 0)에서만 작동해 일반 스크롤과 충돌하지 않음.
- **구분선** — 새 게시물(위)과 기존 게시물(아래) 사이에 **"New posts above"** 텍스트와 함께 표시되는 **수동 표시선** (버튼 없음). 피드 반영(flush) 시 또는 콜드 스타트에서 백그라운드가 받아둔 새 글이 있을 때 표시됨. 콜드 스타트 시에는 이 구분선이 화면 세로 중앙에 오도록 스크롤됨. 새로고침은 당겨서 새로고침 또는 플로팅 버튼으로.

### 플로팅 버튼 상태

최상단에서는 새 글 신호(pill·"N new"·"Load N")만 뜨고, 할 일이 없으면 숨겨짐. 한 화면 이상 아래로 스크롤하면 같은 버튼이 "↑ Top"으로 바뀜.

| 모습 | 의미 | 탭 시 동작 |
|------|------|-----------|
| (없음) | 최상단·할 일 없음(idle) | — (로딩은 당겨서 새로고침으로) |
| 회색 "Load N accounts" | 아직 로드 안 된 구독 계정 N개 있음 | 그 계정 resolve+초기 fetch |
| `● N/total` (회색 pill) | 폴링 진행 중 | 반응 없음 |
| 파란 "N new" | 버퍼에 N개 대기 중 | 피드 반영 |
| 회색 "↑ Top" | 한 화면 이상 아래로 스크롤됨 | 최상단(가장 새 글)으로 스크롤 |

### 설정 메뉴 (⚙)

헤더 우측 톱니바퀴 버튼을 탭하면 열리는 드롭다운.

- **인스턴스 hostname** — 현재 로그인된 인스턴스 표시 (비활성).
- **Export subscriptions** — 구독 목록을 텍스트로 클립보드에 복사.
- **Import subscriptions** — 텍스트로 구독 목록을 가져오기. **Merge**(기본, 기존 목록에 합집합으로 추가)와 **Replace**(전체 덮어쓰기, 빨간 경고로 현재 N개 삭제됨을 표시) 중 선택. 파괴적 전체 교체는 명시적으로 Replace를 골라야 함.
- **Subscribe to account** — 단일 handle을 구독 목록에 추가.
- **Background sync** — 체크 시 백그라운드(앱 닫혀 있을 때 포함)에서 주기적으로 새 게시물을 폴링. 브라우저에서는 Periodic Background Sync 사용(minInterval 12시간, 실제 간격은 브라우저가 결정, Firefox/Safari에서는 항목 숨김, 권한 거부 시 자동 off). Android APK에서는 네이티브 WorkManager가 약 4시간 주기(실제 간격은 Doze/배터리 상태에 따라 더 길어질 수 있음)로 계정을 **순차** 폴링(홈 인스턴스 부담·폰 피크 리소스 최소화)하고, 새 글 도착 시 단일 알림을 누적 대기 글 수로 in-place 갱신(IMPORTANCE_LOW·setOnlyAlertOnce로 무음·재알림 없음, 앱을 열면 해제). HTTP 429를 받으면 이번 회차 폴링을 즉시 중단하고 `Retry-After`(없으면 `X-RateLimit-Reset`, 그래도 없으면 5분, 최대 1시간)만큼 다음 회차를 건너뜀.
- **Log out** — 탭 시 "Log out? / Yes / Cancel" 확인 후 로그아웃.

### 게시물 카드

- 계정 이름, 아바타, 게시 시간, 본문, 미디어, boost/favourite 수 표시.
- **+ Subscribe / Subscribed** 버튼으로 해당 계정 구독 토글. 액션 아이콘 옆이라 오탭 방지를 위해 구독 추가는 한 번 탭, 해제는 'Subscribed'→'Unsubscribe?'(빨강) **두 번 탭**으로 확인(arm 후 3초 지나면 자동 해제).
- CW(content warning) 있는 게시물은 접힌 상태로 표시, "Show content"로 펼침.

## Android APK

- `android/` — WebView 래퍼 앱. `npm run build:android`가 웹 빌드를 `android/app/src/main/assets/www`로 출력하고, `WebViewAssetLoader`가 `https://appassets.androidplatform.net/`으로 서빙.
- 브리지: 웹 `src/native/android.ts` ↔ 네이티브 `SubeeBridge.kt` (`window.SubeeAndroid`). 웹이 auth와 계정별 커서를 push(`updateSyncState`)하면 네이티브 `FeedSyncWorker`(WorkManager, 1시간 주기)가 폴링해 알림을 띄우고, 앱 시작 시 웹이 `consumeSyncResults`로 새 글과 커서 갱신을 가져와 캐시에 병합.
- OAuth는 WebView 안에서 진행됨. redirect_uri가 appassets origin이라 외부 브라우저로 빼면 돌아올 수 없음.
- 빌드 순서: `npm run build:android` → `cd android && ./gradlew assembleDebug`. CI는 `.github/workflows/android.yaml`이 `subee-debug` artifact 업로드.
