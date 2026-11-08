# SOS: Mind Arena

Local, single-player SOS strategy game with configurable boards, AI opponents, match history, and analytics.

## Run locally

```sh
npm install
npm run dev
```

Run `npm test` for the SOS engine tests and `npm run build` for a production build.

## Data

Completed matches are saved in the browser's IndexedDB database (`sos-mind-arena`). Preferences are stored in localStorage. Analytics and exports are generated only from saved matches; new installs show an empty state.

## Game and AI

The game engine is independent of the UI in `src/game.ts`. SOS lines are enumerated by enabled direction and counted once per completed sequence. The AI uses heuristic move ordering and alpha-beta search on smaller boards, with shallower bounded search on larger boards.
