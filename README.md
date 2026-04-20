# Lexicon — Vocab SRS

从 Obsidian 生词本生成的个人英语词汇复习 App，部署在 GitHub Pages。

## 架构

```
Obsidian vocabulary-book.md
      ↓ build-vocab.py (parse markdown → JSON)
  words.json + audio/*.mp3
      ↓ (optional) enrich.py (Anthropic API)
      ↓ git push
GitHub Pages → 任意设备浏览器
      ↓ fetch words.json
FSRS 算法调度 + localStorage 存复习进度
```

## 页面

- `index.html` — Review（闪卡复习，带音频）
- `library.html` — Library（所有词 + 搜索/过滤）
- `stats.html` — Stats（总数/到期/掌握/准确率/难度分布）
- `typing.html` — Typing（听音打字 / 看义拼词）

## 开发

```bash
# 更新词库
python3 build-vocab.py

# 富集（可选，需要 ANTHROPIC_API_KEY）
python3 enrich.py

# 本地预览
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000

# 一键部署
./deploy.sh
```

## FSRS 参数

采用 FSRS v4 默认权重，复习逻辑见 `app.js` 中的 `schedule()` 函数。
每张卡状态存储在 `localStorage.lexicon_state_v1`。
