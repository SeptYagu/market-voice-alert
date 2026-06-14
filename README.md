# Market Voice Alert

自用的股票/期货实时监控与语音播报工具。

这个项目主要服务我们自己的看盘流程：实时监控自选标的、语音播报行情变化、价格提醒、涨停看板和 K 线查看。它不是面向公众开放的 SaaS，也不保证在没有本地数据服务的环境里开箱即用。

说人话：这是一个偏实战、偏自用、围绕 A 股盯盘习惯堆出来的小工具。它会把关注标的的行情、涨跌幅、涨停状态、炸板信息和 K 线走势集中到一个页面里，并通过浏览器语音播报把关键变化念出来，减少盯屏压力。

本项目由 Minimax M3 + GPT-5.5 一起协作完成。代码里保留了不少阶段性实现、修补和历史交接文档，所以它不是一座精修花园，更像一座能跑、能看、能继续改的“史山”。

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

## 常用命令

```bash
npm run lint
npm test
npm run build
npm run e2e
```

## 技术栈

- Vanilla JS + ES Modules
- Vite
- TradingView Lightweight Charts
- QUnit
- Playwright
- AKTools / AKShare 本地 HTTP 数据服务

## 说明

本仓库保留较多阶段文档和交接记录，方便之后继续迭代。需求源以 `SPEC.md` 为准，当前状态参考 `STATUS.md`。
