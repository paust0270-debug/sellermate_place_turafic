# sellermate_place_turafic

네이버 플레이스 순위 체크용 Electron GUI입니다.

## 실행

1. `npm install`
2. `npm start`
3. 포터블 빌드: `npm run pack` (출력은 `package.json`의 `directories.output` 기준, 예: `dist-exe`)

## 참고

- `main.cjs`의 `SOURCE_ROOT`를 본인 PC의 `sellermate_naver_place_all` 경로로 맞춥니다.
- 브라우저 작업은 해당 폴더의 `place-check` 코어·의존성(`puppeteer-real-browser` 등)을 사용합니다.
