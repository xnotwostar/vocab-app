# Lexicon — Vocab SRS

个人英语词汇复习 App。词库来自 Obsidian 生词本，一键同步到 GitHub Pages。

**🌐 Live**: https://xnotwostar.github.io/vocab-app/

## 架构

```
Obsidian vault                       Local repo              GitHub                       Browser
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
English/vocabulary-book.md
English/audio/*.mp3
Learning/lexicon-app/enrichments.json
                          ↓ build-vocab.py
                      words.json + audio/*
                                          ↓ git push (auto)
                                                    GitHub Pages
                                                              ↓ fetch
                                                                    Review / Library / Stats
                                                                                ↕ localStorage
                                                                            per-device progress
```

## 页面

- `index.html` — Review（闪卡 · 顶部进度条 · 周统计 · 自动播放音频）
- `library.html` — Library（所有词 · 搜索/过滤 · Leech 标记）
- `stats.html` — Stats（记忆曲线 · 难度/来源分布）

## 日常工作流

**添加新词**：在 Claude Code 对话里说「整理生词」，自动：
1. Obsidian 整理（翻译 + 音标 + 例句 + 富集 + 音频）
2. `python3 build-vocab.py` 生成 words.json
3. `git commit + push` → GitHub Pages 1-2 分钟内生效

**复习**：打开 https://xnotwostar.github.io/vocab-app/

## 调度算法

Leitner 盒子 + 二元判断：
- 记得 → box+1，间隔 [10min, 1d, 2d, 4d, 8d, 16d, 32d, 64d, 128d]
- 不记得 → box 归 0，当前 session 内重出现

Box ≥ 6 → `mature`。连续 3 次 forget 且 forget 率 > 50% → `leech`。

## 数据存储

| 位置 | 内容 | 同步 |
|------|------|------|
| GitHub repo | words.json, audio, code | Git push |
| 浏览器 localStorage | 复习进度（box/history） | **不跨设备** |

复习进度跨设备同步需要云端 DB（v2 计划）。现在固定一个设备做复习主设备。

## Dev

```bash
python3 build-vocab.py       # md → json
./deploy.sh                  # build + commit + push
```

## 状态键

`localStorage.lexicon_state_v2` — schema:
```js
{
  [wordId]: {
    box: number,
    due: iso-string,
    reps, remembered, forgot: number,
    lastReview: iso-string,
    history: [{t, ok}],
    state: 'new' | 'learning' | 'mature' | 'leech'
  }
}
```
