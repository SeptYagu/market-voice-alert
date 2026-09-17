# Architecture Reconnaissance

## System Purpose
The repository `market-voice-alert` (also referred to as `stock-monitor`) is a real-time stock and futures monitoring assistant. It provides features like real-time monitoring, voice broadcasting (TTS) alerts, price alerts, limit-up (涨停) boards, and trend charts.

## Major User Workflows
- **CONFIRMED**: **Real-time Monitoring & Alerts**: Viewing live stock and futures data, receiving voice alerts based on configured price/volume thresholds.
- **CONFIRMED**: **Limit Up Board (涨停看板)**: Viewing stocks that have hit their upper limit.
- **CONFIRMED**: **Charts & Analysis**: Viewing candlestick (K-line) and intraday trend charts for specific stocks or futures contracts via lightweight-charts.
- **CONFIRMED**: **Settings & Configuration**: Configuring voice settings, polling intervals, and custom symbols.

## Architecture Map

### Frontend
- **CONFIRMED**: **Framework**: Vanilla JavaScript (ES Modules) with HTML/CSS. No heavy frontend framework (Vue/React) is used.
- **CONFIRMED**: **Entry Point**: `index.html` loads `src/main.js` which bootstraps the app via `startApp()` in `src/js/app.js`.
- **CONFIRMED**: **UI & DOM**: Native DOM manipulation. Charting is handled by `lightweight-charts` (`src/js/chart.js`, `src/js/kline.js`).
- **CONFIRMED**: **Audio/TTS**: Speech synthesis is used for voice alerts (`src/js/tts.js`).
- **CONFIRMED**: **Organization**: Uses MVC-like patterns with directories like `src/js/views/`, `src/js/controllers/`, `src/js/services/`.

### Backend
- **CONFIRMED**: **Framework**: Custom Node.js HTTP server (`http.createServer`). No Express is used. Entry point at `server/index.js`.
- **CONFIRMED**: **Static File Serving**: The custom server also serves Vite built assets from `dist/`.
- **CONFIRMED**: **API & Caching**: Custom endpoints under `/api/cache/*` handle fetching and caching external data (e.g., `server/klineService.js`, `server/spotService.js`).
- **CONFIRMED**: **Proxy Server**: `server/proxyService.js` routes requests from the frontend (`/api/*` that are not cache routes) to external financial data APIs (EastMoney, Sina, Tencent) based on `server/proxyRoutes.js`.

### Database
- **CONFIRMED**: **Persistence**: No traditional relational or NoSQL database is observed.
- **CONFIRMED**: **Caching**: The backend uses a file-system based caching mechanism implemented in `server/cacheStore.js`, saving JSON payloads directly to disk with TTL logic.
- **CONFIRMED**: **Frontend Storage**: LocalStorage is used for client-side settings and tracked stocks (`src/js/storage.js`).

### Authentication
- **CONFIRMED**: **Model**: NONE observed. The app appears to be for single-user/local usage without login requirements.

### Authorization
- **CONFIRMED**: **Model**: Basic IP/Host-based restriction observed for a specific endpoint (`/api/cache/momentum/ten-day/scan`). It restricts triggering scans to localhost, private LAN IPs, or an allowlist from `MOMENTUM_SCAN_ALLOWED_HOSTS`.

### State Management
- **CONFIRMED**: **Frontend**: Custom state objects and variables within vanilla JS modules (e.g., `src/js/app.js`, `src/js/storage.js`).
- **CONFIRMED**: **Backend**: In-memory caching (`HEALTHY_HOST_CACHE`, `inflightRefreshes`) and file-system cache logic.

### External Services
- **CONFIRMED**: **Market Data APIs**:
  - EastMoney (`push2.eastmoney.com`, `push2his.eastmoney.com`)
  - Tencent/QQ (`qt.gtimg.cn`, `ifzq.gtimg.cn`)
  - Sina (`hq.sinajs.cn`)
- **CONFIRMED**: **Local Python Service**: Integrates with an optional `aktools` local Python service (default `http://127.0.0.1:8888`), mapped via `proxyRoutes.js`.

### Background / Async Systems
- **CONFIRMED**: **Backend Jobs**: A background momentum scheduler exists (`startMomentumScheduler` in `server/momentumService.js`). The cache store relies on periodic TTL pruning.
- **CONFIRMED**: **Diagnostics**: Background diagnostic tracking and recording runs on the server (`server/diagnostics.js`).
- **HIGH-CONFIDENCE INFERENCE**: **Web Workers**: A `src/js/worker.js` exists, likely for offloading background polling or data parsing from the main UI thread.

### Deployment / Runtime
- **CONFIRMED**: **Build**: Uses Vite (`vite build`) to bundle the frontend into `dist/`.
- **CONFIRMED**: **Run**: Node runs `server/index.js` which acts as both the static file server and the API/proxy server.

### Configuration
- **CONFIRMED**: **Backend**: Uses Environment Variables (`PORT`, `HOST`, `MOMENTUM_SCAN_ALLOWED_HOSTS`, `DISABLE_BACKGROUND_JOBS`, `AKTOOLS_BASE`).
- **CONFIRMED**: **Frontend**: LocalStorage based.

## Important Data Flows
- **CONFIRMED**: **Realtime proxy flow**: Client requests `/api/tencent/*` -> `server/proxyService.js` routes to upstream -> Client receives data.
- **CONFIRMED**: **Cached proxy flow**: Client requests `/api/cache/kline` -> `server/index.js` routes to `klineService.js` -> `cacheStore.js` reads file from disk or fetches upstream, updates cache file, returns to Client.

## Architectural Patterns Observed
- **CONFIRMED**: **BFF (Backend for Frontend)**: The Node backend serves heavily as a BFF, aggregating data and proxying to external services to bypass browser CORS policies.
- **CONFIRMED**: **File-based Cache Repository**: Ad-hoc JSON file storage mimicking a DB/Cache layer for persistence across restarts.

## Architectural Inconsistencies
- **CONFIRMED**: **Parallel API Implementation**: There are two distinct ways the app gets data: through the `proxyRoutes` (transparent proxy) and through the `/api/cache/` routes (smart cache layer). This implies an ongoing architectural migration from direct proxying to backend caching.
- **CONFIRMED**: **Multiple Data Sources**: API fetches mix Sina, Tencent, and Eastmoney, which require distinct parsing logic per provider. 

## Documentation vs Implementation Mismatches
- **CONFIRMED**: The `package.json` runs standard node `server/index.js`, but there's heavy reliance on `aktools startup at 8888.bat` and python tooling in the root which seems parallel to the node implementation or complementary.

## Important Unknowns
- **UNKNOWN**: How critical the `aktools` backend is for standard operation versus extended functionality, given that the node proxy still directly calls Tencent/Sina/EastMoney for most real-time data.
