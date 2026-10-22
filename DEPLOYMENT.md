# 스마트폰용 배포

현재 원격 배포와 예약 실행은 아직 연결되지 않았습니다.

`node backend/build-pages.mjs`는 최신 분석을 `dist/site/`에 정적 웹앱으로 묶습니다. 이 폴더만 GitHub 저장소의 `docs/`로 발행합니다. 첫 화면은 매매 노트이며 API 서버 없이 동작합니다. 기존 `dist/pages/`는 이전 평문 시험 산출물이므로 발행하지 않습니다.

## 데이터 보호

공개 저장소에는 앱 소스와 암호화된 분석 파일 `docs/data/analysis.enc.json`만 올립니다. 원본 시세 DB, 개인 장부, API 인증키는 제외합니다. source 메타데이터도 분석 배포본에서 제외합니다.

분석 파일은 압축 후 AES-256-GCM으로 암호화합니다. 변조·잘못된 키는 복호화 실패로 처리합니다. 별도의 무작위 분석 접근 키를 `private-data/daily/publish-key.json`에 유지합니다. 이 키는 KRX 인증키가 아닙니다. 재빌드할 때마다 새로운 IV를 사용합니다.

전용 링크는 `https://SEJIN0523.github.io/stock-strategy-lab/#access=…` 형식입니다. 브라우저가 분석 키를 읽어 로컬에서 복호화하고, 성공하면 키를 해당 경로의 로컬 저장소에 보관한 뒤 주소창에서 fragment를 지웁니다. URL fragment는 HTTP 요청에 실리지 않습니다. 전용 링크를 가진 사람은 분석을 열 수 있으므로 타인에게 공유하지 않습니다. 이는 서버 로그인·계정별 권한 관리와 다릅니다. 향후 사용자가 늘어나면 인증된 서버로 전환합니다.

개인 매매 장부는 스마트폰 브라우저에만 저장합니다. 분석 파일에 장부를 합치지 않습니다. 백업 파일은 사용자가 별도로 보관하며 다른 기기로 자동 동기화하지 않습니다.

## GitHub 연결

1. 새 `SEJIN0523/stock-strategy-lab` 저장소를 연결된 GitHub 앱의 선택 허용 목록에 추가합니다.
2. 허용한 소스 파일과 `dist/site/`의 산출물을 저장소 `docs/`에 올립니다. 전체 워크스페이스를 업로드하지 않습니다.
3. 저장소 Settings → Pages → Build and deployment에서 Source를 Deploy from a branch, Branch를 main, 폴더를 /docs로 선택해 Save합니다. 별도 워크플로나 KRX 키가 필요하지 않습니다.
4. 실제 HTTPS 전용 링크에서 데이터 표시와 Android 홈 화면 실행을 확인합니다.

GitHub Pages 배포 문서: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 매일 실행

한국 시각 평일 14:30에 데스크톱에서 `node backend/daily-refresh.mjs`를 실행하고 성공한 경우에만 `node backend/build-pages.mjs`로 분석을 묶어 docs의 변경 결과를 GitHub에 발행할 예정입니다. 수집기는 전일까지 조회하며 당일 장중 시세로 표시하지 않습니다. 매매 검토 시간은 15:20~15:30입니다.

예약은 실제 발행 경로를 확인한 뒤 설정합니다. 데스크톱이 꺼져 있으면 이 방식의 갱신은 실행되지 않습니다. 새 시세 수집이나 분석에 실패하면 마지막 성공 자료를 유지하며, 최근 갱신 실패 상태도 발행해야 합니다. 이전 분석을 최신이라고 표시하지 않습니다.

암호화 파일도 서비스워커 캐시 대상에서 제외합니다. 통신 실패 시 앱 틀은 열릴 수 있지만 새 분석은 불러오지 못했다고 표시합니다. 원격 배포는 암호화된 자료를 본인 기기에서 이용하기 위한 방식이며 자료 재배포 허가를 뜻하지 않습니다.
