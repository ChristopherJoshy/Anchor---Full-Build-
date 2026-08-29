# Changelog

## 2026-08-29 — scaffold: monorepo workspaces, git remote, README

## 2026-08-29 — feat: scaffold packages/anchor-sdk (expo module, android)
- create-expo-module scaffold (AsyncFunction+Event), stripped template cruft (package/, example/, internal/), no-build TS layout: main/types -> src/index.ts
- deps: expo-location, expo-sensors; devDeps: jest + ts-jest + @types/jest + typescript; `npx jest` + `tsc --noEmit` wired

## 2026-08-29 — docs: comprehensive root readme
- full rewrite: pitch, TOC, background (RAIM/FDE heritage, on-device AI rationale), 7-stage ASCII pipeline, features (six checks w/ spoofer rationale, solar compass, state machine table, AI stack, voice, semantic search, demo UI, permissions), design tokens, getting started, project tree, AnchorSDK reference, roadmap, license
