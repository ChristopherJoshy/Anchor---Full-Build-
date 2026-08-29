# Anchor

Anchor is on-device GPS integrity monitoring: it continuously runs six physics consistency checks against raw GNSS measurements and feeds them into a deterministic RAIM/FDE state machine that classifies every fix as trusted, cautioned, or denied — with a fully on-device AI stack (ExecuTorch LLM, ASR, and embedder) that explains and assists without ever sending a byte to the cloud.

**Architecture**

- `packages/anchor-sdk` — Expo module wrapping the physics engine (six consistency checks + RAIM/FDE) and the on-device AI layer (ExecuTorch LLM/ASR/embedder)
- `apps/anchor-demo` — instrument-panel demo app exercising the SDK

**Quickstart**

```bash
npm install
cd apps/anchor-demo
npx expo start --dev-client
```

For a native build: `eas build`.

**Design system** — avionics glass-cockpit: `#0C1116` background, `#00D9A3` TRUSTED, `#FFB300` caution, `#FF3B30` denied, IBM Plex Mono for readings, Inter for labels.
