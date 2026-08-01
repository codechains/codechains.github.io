# codechains — 블로그

AI 트랜스폼 여정 기록 블로그. **원본(마크다운·빌드 스크립트)만 이 저장소에서 버전 관리**하고,
GitHub Actions가 push마다 자동으로 빌드→배포합니다. 빌드 결과물(`site/`)은 파생물이라 커밋하지 않습니다.

## 구조
```
codechains.github.io/
├── content/                 # 글·소개 원본(마크다운). ko = content/, en = content/en/
│   └── site.json            # 사이트 설정(브랜드·태그라인·이메일·customDomain 등)
├── assets/                  # 정적 원본(스타일 등). 빌드가 site/assets/ 로 그대로 복사
│   └── style.css            # 사이트 디자인 원본 — 여기를 고치면 배포에 반영됨
├── scripts/build.js         # 마크다운 → 정적 HTML 변환기 (계속 발전 가능)
├── package.json / package-lock.json
├── .github/workflows/deploy.yml   # push 시 자동 빌드+배포
├── .gitignore               # site/, node_modules/ 등 제외
└── site/                    # (git 무시) 빌드 결과물
```

## 진실의 원본은 마크다운 하나
- 에이전트가 글을 "생성"하든, 사람이 "수정"하든 → 모두 `content/`의 **같은 .md 파일**을 편집하는 것.
- 디자인을 고칠 땐 `assets/style.css`를 수정 (`site/assets/style.css`는 복사본이라 덮어써짐).
- **빌드된 `site/`의 HTML은 절대 직접 고치지 말 것** (빌드 때마다 덮어써짐).
- 특수 꾸밈이 필요하면 .md 안에 HTML을 직접 섞어도 됨.

## 글 쓰는 흐름
1. `content/posts/`에 `YYYY-MM-DD-슬러그.md` 생성(아래 frontmatter 참고). 영어판은 `content/en/posts/`에 같은 파일명.
2. Cursor 등에서 내용을 직접 수정.
3. 로컬 미리보기: `npm install`(최초 1회) → `npm run dev` → http://localhost:4000 접속.
4. 만족하면 `git add -A && git commit -m "..." && git push` → Actions가 자동 배포.

## 로컬 개발 서버
```
npm run dev     # http://localhost:4000, 저장하면 자동 재빌드 + 브라우저 자동 새로고침
npm run build   # 1회 빌드만 (site/ 생성)
```
- `content/`, `assets/`, `scripts/build.js` 를 저장하면 즉시 다시 빌드되고 열려 있는 탭이 스스로 새로고침됩니다.
- 응답에 `no-store` 를 붙이므로 **로컬에서는 Ctrl+F5가 필요 없습니다.**
- `site/index.html` 을 파일로 직접 열지 말 것 — HTML이 `/assets/style.css` 처럼 루트 절대경로를 쓰기 때문에
  `file://` 로 열면 CSS가 안 잡힙니다. 반드시 위 서버로 확인하세요.
- 포트를 바꾸려면 `PORT=5000 npm run dev` (PowerShell: `$env:PORT=5000; npm run dev`).

## 초안(draft)
frontmatter에 `draft: true`를 넣으면 **커밋·백업은 되지만 사이트에는 공개되지 않음**.
다 다듬은 뒤 `draft: false`(또는 줄 삭제)로 바꿔 push하면 공개됩니다.

## frontmatter 예시
```
---
title: 글 제목
date: 2026-08-01
description: 목록·검색에 보일 한 줄 요약.
tags: [태그1, 태그2]
draft: true   # 준비되면 지우거나 false
---
본문...
```
새 글은 `content/_post-template.md` 를 `content/posts/YYYY-MM-DD-슬러그.md` 로 복사해서 시작하세요.

## 검색 최적화(SEO)는 빌드가 자동 처리
frontmatter만 제대로 채우면 아래가 **모든 글에 자동으로** 들어갑니다. HTML을 직접 손댈 일은 없습니다.

- `<title>` / `meta description` / `canonical`
- Open Graph (`og:type=article`, `og:title/description/url`, `article:published_time`, `og:locale`)
- 구조화 데이터 JSON-LD (`BlogPosting` — 제목·요약·발행일·저자·발행처·태그)
- `hreflang` 한/영 상호 연결, `<time datetime>`, `sitemap.xml` 의 `lastmod`

**빌드가 직접 검사합니다.** 아래가 비어 있으면 빌드가 실패해 배포되지 않습니다.

| 항목 | 없으면 |
|---|---|
| `title`, `date`(YYYY-MM-DD), `description` | **오류 → 빌드 중단** |
| 슬러그 중복 | **오류 → 빌드 중단** (뒤 글이 앞 글을 덮어쓰는 사고 방지) |
| `description` 40~160자 벗어남, `title` 60자 초과, `tags` 없음 | 경고 (배포는 됨) |

아직 다듬는 중이라 채우지 못했다면 `draft: true` 를 넣으세요. 검사 대상에서 제외됩니다.

### 대표 이미지(선택)
`assets/og.png` (1200×630 권장) 를 넣고 `content/site.json` 의 `ogImage` 를 `"/assets/og.png"` 로 채우면
링크 공유 시 썸네일이 붙습니다. 비워두면 이미지 없는 카드로 안전하게 처리됩니다.

## 배포 설정 (최초 1회)
- 저장소: `codechains.github.io` (public)
- **Settings → Pages → Source = "GitHub Actions"**
- 커스텀 도메인 연결 시: `content/site.json`의 `customDomain`을 `codechains.dev`로 채우면 빌드가 CNAME을 생성.
  (DNS 연결 전에는 비워둘 것 — 비어 있으면 CNAME을 만들지 않음)
