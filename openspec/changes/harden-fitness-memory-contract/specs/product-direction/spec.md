## MODIFIED Requirements

### Requirement: Memory backend portability
FitClaw SHALL 将 Skill data namespace 视为稳定记忆接口，并 SHALL 将当前 JSON 文件存储视为第一阶段 backend，而不是不可替换的最终存储方案。第一阶段长期记忆改进 SHALL 优先加固 namespace contract、写入模式、样例和 eval，而不是直接替换存储后端。

#### Scenario: Persisting durable fitness facts
- **WHEN** 用户提供目标、伤病、器械、训练日志、计划、身体数据或个人记录等持久事实
- **THEN** FitClaw SHALL 优先写入结构化 Skill data namespace，而不是只写入自由文本记忆或向量索引

#### Scenario: Evolving storage backend
- **WHEN** 后续 change 需要引入 schema version、append-only log、SQLite、PostgreSQL 或语义检索
- **THEN** 该 change SHALL 尽量保持 `data_<skill>_read/write` namespace 接口稳定，并将底层存储演进作为 backend 替换处理

#### Scenario: Hardening memory before changing storage
- **WHEN** 后续 change 改善长期记忆可靠性
- **THEN** 它 SHALL 优先说明 namespace contract、write mode、schema version 或 eval 覆盖是否需要更新
