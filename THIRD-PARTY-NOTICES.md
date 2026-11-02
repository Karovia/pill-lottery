# 第三方素材与许可 / Third-party assets & licenses

本仓库自身的代码以 MIT 许可发布（见 LICENSE）。以下第三方素材属于各自作者，
遵循其原始许可，本仓库按其要求附带许可文本与来源说明。

## 1. Chrome 恐龙精灵图 — `assets/sprites/`

- **来源**：Chromium 浏览器内置的离线小恐龙游戏（`chrome://dino`）官方精灵图
  `100-offline-sprite.png`，各 PNG 均由该图逐像素切片得到（脚本见仓库历史 `.tmp_raw/slice_sprites.py` 的思路，切片参数已固化在本仓库 `js/app.js` 使用）
- **版权**：Copyright 2014 The Chromium Authors
- **许可**：BSD-3-Clause（[Chromium LICENSE](https://source.chromium.org/chromium/chromium/src/+/main:LICENSE)）
- **镜像参考**：<https://github.com/wayou/t-rex-runner>

> BSD 3-Clause 要求在 redistribution 中保留版权声明与许可声明 —— 本文件即充当该声明。

## 2. 缝合像素字体 Fusion Pixel Font — `assets/fonts/`

- **文件**：`fusion-pixel-12px-proportional-zh_hans.otf.woff2`
- **作者**：TakWolf — <https://github.com/TakWolf/fusion-pixel-font>
- **许可**：SIL Open Font License 1.1（全文见 `assets/fonts/OFL.txt`）
- 该字体为多个开源像素字体的缝合版本，上游各字体（ark-pixel、cubic-11、galmuri）
  的许可文本一并提供在 `assets/fonts/LICENSES/` 目录下

> OFL 1.1 允许捆绑分发，但要求附带许可证文本 —— `assets/fonts/OFL.txt` 即为该文件。

## 3. 影视"喊你吃药"片段 —— **不包含在本仓库中**

`assets/clips/` 下的视频片段来自各影视剧/动画的公开切片，属于版权素材，
不随本仓库分发。运行时若缺失对应文件，页面会自动降级为像素台词卡片，
不影响使用。如需自己补充片段，见 `assets/clips/README.md`。
