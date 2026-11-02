# 吃药大转盘 · Pill Lottery

一个像素风的抽奖网页：小恐龙站在转盘正中央，点它一下（或按空格）跳过仙人掌，
转盘随即开转抽出"一周药"里的一粒，并播放一段"喊你吃药"的名场面作为结算动画。
白天抽上午的药、夜晚抽下午的药，14 副抽完后由工作人员长按重置 —— 适合公会/社团/实验室
发小礼品用的整活抽奖。

> 影视片段（版权素材）**不在仓库中**，放入自己的片段即可启用结算视频；
> 没有片段时页面自动降级为像素台词卡片，功能完整。

## 玩法

1. **点恐龙 / 按空格** → 恐龙跳过仙人掌 → 转盘旋转 → 停在某个星期
2. **昼夜主题决定上午/下午，严格不跨抽**
   - ☀ 白天（浅色）→ 只抽还有「上午」余位的星期
   - 🌙 夜晚（黑白反转，恐龙变白）→ 只抽还有「下午」余位的星期
   - 页面每 15~25 秒自动切换昼夜，整页（含画布）同步 0.5 秒渐变；抽奖过程中主题锁定
   - 某主题的药抽完时（如上午发完），转盘启动会自动切到另一侧并在状态栏提示
3. **抽中的扇形被填满标记**：抽 1 副填一半浅色，2 副全抽完填满反色
4. **抽中「周日 · 下午」触发特别奖励**：胜利音效 + 全屏像素彩带 + 礼品弹窗
5. **14 副全部抽完 → 锁定等待补货**；工作人员**长按红色 RESET 按钮 2 秒**
   （像素方块进度环）→ 仙人掌撞倒恐龙 → GAME OVER → 自动清空重开

进度保存在浏览器 localStorage，刷新不丢。

## 运行

方式一（推荐）：本目录起个静态服务器（自带 no-store 缓存头）

```bash
python3 server.py 8642
# 打开 http://127.0.0.1:8642
```

方式二：直接双击 `index.html`。

### 打包成 macOS App（可选）

需要 Xcode Command Line Tools（`swiftc`）与 `ffmpeg`、`iconutil`：

```bash
bash macos-app/build.sh
# 生成 吃药大转盘.app —— WKWebView 壳，资源全部打进包内，双击即开
```

## 自定义结算片段

把 4~8 秒的"喊吃药"名场面放进 `assets/clips/`，命名见 `assets/clips/README.md`；
台词字幕配置在 `js/clips.js`。**请勿把版权片段上传到公开仓库。**

## 结构

```
├── index.html          页面
├── css/style.css       像素风样式（昼/夜两套调色板，JS 统一驱动）
├── js/app.js           全部逻辑：跑酷/转盘/状态机/音效/存档
├── js/clips.js         14 个药位 → 片段与台词配置
├── server.py           本地静态服务器（no-store 缓存头）
├── macos-app/          macOS 原生壳（WKWebView + 自定义 URL Scheme）
└── assets/
    ├── clips/          结算视频（自行补充，不入库）
    ├── sprites/        Chrome 恐龙官方精灵图及切片
    └── fonts/          缝合像素字体 Fusion Pixel（OFL 1.1）
```

## 技术备忘

- 恐龙动画四帧循环（左脚前 → 收拢 → 右脚前 → 收拢）取自官方精灵图逐像素分析切片
- 全部渲染在一张 560×560 逻辑画布：外圈转盘环 + 中央小舞台（恐龙/传送带地面/仙人掌）
- 昼夜反转：一份调色板由 JS 每帧同时驱动画布与页面 CSS 变量，整页同步渐变
- 音效为 WebAudio 实时合成的 8-bit 音，无音频文件
- 调试钩子：控制台 `__pill.toggleTheme()` / `__pill.reset()` / `__pill.testSpecial()`

## 许可

- 本仓库代码：[MIT](LICENSE)
- Chrome 恐龙精灵图：Chromium，BSD-3-Clause
- 缝合像素字体：[SIL Open Font License 1.1](assets/fonts/OFL.txt)（[TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)）

详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
