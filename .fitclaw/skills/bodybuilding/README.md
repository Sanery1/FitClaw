# bodybuilding

全流程 AI 健身私教技能（Claude Code Skill）。

## 快速开始

```bash
# 验证数据库
python scripts/setup_db.py --verify

# 查询动作
python scripts/query_exercises.py --muscle chest --equipment dumbbell

# 列出所有肌群
python scripts/query_exercises.py --list-muscles
```

数据库已内嵌在仓库中，克隆即用，无需额外下载。

## 功能

- 用户信息收集 → 个性化训练计划生成
- 800+ 动作数据库，支持按肌群、器械、难度筛选
- 训练进化与周期化调整
- 动作教学（文字说明 + 图片示范）

## 致谢

- **[free-exercise-db](https://github.com/nickelpo/Free-exercise-db)** — 开源健身动作数据库，提供了 800+ 个动作的数据和示范图片
- **[kaiji-fitness-coach](https://gitee.com/kaiji1126/free-exercise-db)** — 原始 AI 健身私教技能，本 skill 基于其设计理念重构而来

## 许可

本仓库中的技能代码基于原项目许可。free-exercise-db 数据库使用 MIT License。
