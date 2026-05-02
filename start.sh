#!/usr/bin/env bash
# FitClaw 启动脚本 — 从 Claude Code settings.json 读取环境变量
set -e

SETTINGS="$HOME/.claude/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo "❌ 未找到 $SETTINGS，请先配置 Claude Code"
  exit 1
fi

# 从 settings.json 的 env 字段导出环境变量
echo "📋 已加载环境变量："
while IFS='=' read -r key value; do
  if [ -n "$key" ] && [ -n "$value" ]; then
    export "$key"="$value"
    echo "  ✓ $key"
  fi
done < <(node -e "
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  for (const [k, v] of Object.entries(cfg.env || {})) {
    console.log(k + '=' + v);
  }
" "$SETTINGS")

echo ""
echo "🚀 启动 FitClaw Coding Agent..."
node packages/coding-agent/dist/cli.js "$@"
