# assets/clips/ — 结算视频片段（自行补充）

版权原因，仓库**不包含**任何影视/动画片段。放入片段后页面会自动播放；
缺失时自动降级为像素台词卡片（见 `js/clips.js`），页面功能不受影响。

## 命名

每个药位对应一个文件，槽位名见 `js/clips.js`：

```
mon_am  mon_pm  tue_am  tue_pm  wed_am  wed_pm
thu_am  thu_pm  fri_am  fri_pm  sat_am  sat_pm
sun_am  sun_pm
```

## 规格建议

- 时长 4~8 秒，含"喊吃药"台词或吞药动作的完整时刻（不要剪在台词之前结束）
- 640 宽、H.264 + AAC、faststart：

```bash
ffmpeg -y -ss <起点秒> -i 源视频.mp4 -t 7 \
  -vf "scale=640:-2,fps=30" -c:v libx264 -preset veryfast -crf 23 \
  -pix_fmt yuv420p -profile:v baseline -c:a aac -b:a 128k -movflags +faststart out.mp4
```

## 合规提醒

影视剧切片属版权素材，请自行确认你的使用场景（例如非公开的内部活动）符合当地法规与平台条款，不要将片段上传到公开仓库。
