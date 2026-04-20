#!/bin/bash
# deploy.sh — build words.json and push to GitHub Pages
set -e

cd "$(dirname "$0")"

echo "📖 Building words.json from Obsidian vault..."
python3 build-vocab.py

echo ""
echo "🎨 Ready to deploy. Files:"
ls -la index.html library.html stats.html typing.html words.json

echo ""
read -p "📤 Commit and push to GitHub? (y/N) " ans
if [[ "$ans" != "y" ]]; then
  echo "Skipped push."
  exit 0
fi

git add -A
git commit -m "vocab update: $(date +%Y-%m-%d)" || echo "Nothing to commit"

if git remote | grep -q origin; then
  git push origin main
  echo "✅ Pushed. GitHub Pages will deploy in ~1 min."
else
  echo "⚠️ No 'origin' remote. Add with:"
  echo "  gh repo create vocab-app --public --source=. --push"
fi
