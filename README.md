# codechains — 블로그

AI 트랜스폼 여정 기록 블로그. **원본(마크다운·빌드 스크립트)만 이 저장소에서 버전 관리**하고,
GitHub Actions가 push마다 자동으로 빌드→배포합니다. 빌드 결과물(`site/`)은 파생물이라 커밋하지 않습니다.

## 구조
```
codechains.github.io/
├── content/                 # 글·소개 원본(마크다운). ko = content/, en = content/en/
│   └── site.json            # 사이트 설정(브랜드·태그라인·이메일·customDomain 등)
├── scripts/build.js         # 마크다운 → 정적 HTML 변환기 (계속 발전 가능)
├── package.json / package-lock.json
├── .github/workflows/deploy.yml   # push 시 자동 빌드+배포
├── .gitignore               # site/, node_modules/ 등 제외
└── site/                    # (git 무시) 빌드 결과물
```

## 진실의 원본은 마크다운 하나
- 에이전트가 글을 "생성"하든, 사람이 "수정"하든 → 모두 `content/`의 **같은 .md 파일**을 편집하는 것.
- **빌드된 `site/`의 HTML은 절대 직접 고치지 말 것** (빌드 때마다 덮어써짐).
- 특수 꾸밈이 필요하면 .md 안에 HTML을 직접 섞어도 됨.

## 글 쓰는 흐름
1. `content/posts/`에 `YYYY-MM-DD-슬러그.md` 생성(아래 frontmatter 참고). 영어판은 `content/en/posts/`에 같은 파일명.
2. Cursor 등에서 내용을 직접 수정.
3. 로컬 미리보기: `npm install`(최초 1회) → `node scripts/build.js` → `site/index.html` 확인.
4. 만족하면 `git add -A && git commit -m "..." && git push` → Actions가 자동 배포.

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

## 배포 설정 (최초 1회)
- 저장소: `codechains.github.io` (public)
- **Settings → Pages → Source = "GitHub Actions"**
- 커스텀 도메인 연결 시: `content/site.json`의 `customDomain`을 `codechains.dev`로 채우면 빌드가 CNAME을 생성.
  (DNS 연결 전에는 비워둘 것 — 비어 있으면 CNAME을 만들지 않음)
