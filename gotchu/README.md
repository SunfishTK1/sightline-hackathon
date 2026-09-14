# Gotchu

**"Need something?" → "Gotchu."**

Text-first task marketplace for verified CMU students. See `../gotchu-hackathon-spec.md` for the full build plan.

## Team ownership

| Person | GitHub | Focus |
|---|---|---|
| **Will** | [@wmontagu](https://github.com/wmontagu) | Auth, onboarding, ethics UI, shared lib, shell |
| **Thomas** | [@SunfishTK1](https://github.com/SunfishTK1) | Personal AI agent + compose |
| **Divya** | [@divs997](https://github.com/divs997) | Vector matching + live negotiate |
| **Daphne** | [@daphnedavila](https://github.com/daphnedavila) | Ethics + arbitration agent, campus map |

See [`OWNERS.md`](./OWNERS.md) and file `@owner` headers. One file → one owner.

## Quick start

```bash
cp .env.example .env.local   # fill keys (Will shares via DM)
npm install
npm run dev
```

Branches: `will/*`, `thomas/*`, `divya/*`, `daphne/*` → PR into `main`.
