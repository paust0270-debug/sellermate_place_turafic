# sellermate_place_turafic

플레이스 순위체크 GUI 실행기입니다.

## 실행 방법

1. 이 폴더에서 의존성 설치
   - `npm install`
2. GUI 실행
   - `npm start`
3. EXE(포터블) 빌드
   - `npm run pack`
   - 결과물: `dist-exe` 폴더

## 동작 방식

- GUI는 `C:\Users\{C\Desktop\sellermate_naver_place_all`의
  `place-check\batch\check-place-batch.ts`를 직접 실행합니다.
- 옵션에 따라 아래 플래그를 붙여 실행합니다.
  - `--slot-only`
  - `--free-only`
  - `--force-top20`
  - `--once`
  - `--limit=N`
