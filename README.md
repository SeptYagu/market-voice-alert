# Market Voice Alert

自用的股票/期货实时监控与语音播报工具。

这个项目主要服务yagu自己的看盘流程：实时监控自选标的、语音播报行情变化、价格提醒、涨停看板和 K 线查看。因为不打算面向公众开放，所以不保证开箱即用。

这是一个根据yagu需求堆出来的小工具。它会把关注标的的行情、涨跌幅、涨停状态、炸板信息和 K 线走势集中到一个页面里，并通过浏览器语音播报把关键变化念出来，减少盯屏压力。

本项目代码里保留了不少阶段性实现、修补和历史交接文档，由 Minimax M3 + GPT-5.5 一起协作完成，是全程由 AI 维护的能跑、能看、能继续改的“史山”。

## 本地数据依赖

涨停看板依赖本机 AKTools / AKShare HTTP 服务作为数据源。

- 服务地址：`http://127.0.0.1:8888`
- Vite 代理路径：`/api/aktools`
- 主要用途：涨停池、炸板池、连板数、炸板次数、封板时间等数据

启动前需要先安装并运行 AKTools：

```bash
pip install aktools
aktools
```

也可以使用项目根目录里的 Windows 批处理脚本：

```bash
.\aktools startup at 8888.bat
```

如果 `8888` 端口上的 AKTools 服务没有运行，涨停看板相关数据会为空或请求失败。

## 项目启动

```bash
npm install
npm run dev
```

开发服务器默认运行在：

```text
http://127.0.0.1:5173
```

`npm run dev` 会同时提供前端页面、外部 API 代理和内置 `/api/cache/*` 共享缓存接口，不需要再单独启动缓存后端。
开发服务启动后也会启动服务端后台任务：10 日涨幅池会在服务启动时补齐当天缓存，并按北京时间 08:00、15:01 自动扫描。E2E 测试会关闭该后台任务，避免测试时误扫真实数据源。

服务器部署时先构建，再用同一个 Node 后端提供静态页面和缓存 API：

```bash
npm run build
npm run server
```

生产服务默认端口为 `3001`，可用 `PORT` 和 `HOST` 环境变量调整。服务器仍需要能访问 AKTools 服务。

## 常用命令

```bash
npm run lint
npm test
npm run build
npm run e2e
npm run server
```

## 技术栈

- Vanilla JS + ES Modules
- Vite
- TradingView Lightweight Charts
- QUnit
- Playwright
- AKTools / AKShare 本地 HTTP 数据服务

## 说明

本仓库保留较多阶段文档和交接记录，方便之后继续迭代。`SPEC.md` 是早期需求源，其中已标注若干过时内容；当前实现状态优先参考 `AGENTS.md`、`STATUS.md`、最新 `docs/handoff/*` 和源码。
