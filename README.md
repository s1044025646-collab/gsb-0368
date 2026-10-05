# UART 数字波形采样与串口帧错误解释后端

离线教学后端：从**数字电平变化记录**（不是真实串口）解码 UART 字节，并逐位解释采样位置、校验与帧错误。仅提供 HTTP API 与 CLI，无前端。TypeScript + Node.js + 内置 SQLite（`node:sqlite`），Windows 本地直接运行，不需要 Docker、WSL、付费服务或在线 API。

## 支持的协议子集

- 初始空闲**高电平**，每帧 1 个起始位（下降沿触发）+ **8 个数据位，最低位（LSB）先传** + 1 个停止位（高电平）。
- 校验模式：`none`（无校验）、`even`（偶校验）、`odd`（奇校验）。
- 位周期 `bitTicks`（B）由调用方**显式给定且必须为正偶数 tick**，不自动估算波特率。
- 全部计算使用模拟 tick，不使用真实等待、定时器或任何串口/硬件库。

## 时间与采样约定

- 记录采用**半开区间** `[0, endTick)`：采样时刻 `t` 必须满足 `t < endTick`，否则视为记录已结束（截断）。
- 候选起始下降沿位于 tick `t` 时，在 `t + B/2` 验证起始位为低。
- 数据位采样时刻：`t + 3B/2 + i·B`（`i = 0..7`）；校验位（如有）在其后一个 B，停止位再一个 B。
- **采样时刻恰好等于变化时刻时，采用变化后的电平。**
- 帧区间：`[startTick, endTick)`，无校验时长度 `10B`，有校验时 `11B`。

## 重同步约定

- 若下降沿 `t` 的起始位中心（`t+B/2`）已经是高电平，说明是短脉冲噪声：记录为**噪声候选**，公开字段 `fallingTick / centerTick / centerLevel / resumeSearchTick`，然后从 `t+1` 起继续寻找后续下降沿。
- 确认起始后，数据内部的任何跳变都**不会打断当前帧**；不会把每个下降沿都当新帧，也不按脉冲宽度拼字符。
- 完整帧结束前的下降沿全部忽略；**下一帧最早从当前帧整段结束 tick 开始**。
- 记录在必要采样前结束：输出 `TRUNCATED` 帧，列出已收到的位与（数据位齐全时）实际采到的字节；绝不用末尾电平无限延长补帧。起始位中心都未到时输出 `TRUNCATED_START_UNVERIFIED`。

## 错误模型

输入格式问题在解码前拒绝（HTTP 400，错误码）：

| 错误码 | 含义 |
| --- | --- |
| `INITIAL_LEVEL_NOT_IDLE_HIGH` | 初始电平不是空闲高电平 1 |
| `TICK_ORDER_INVALID` / `TICK_DUPLICATE` | 变化时刻未严格递增 / 重复 |
| `TRANSITION_REDUNDANT` | 变化记录未翻转电平（冗余） |
| `LEVEL_NON_BINARY` | 电平不是 0 或 1 |
| `TICK_OUT_OF_RANGE` | 变化时刻 `>= endTick` |
| `BIT_TICKS_INVALID` / `BIT_TICKS_NOT_EVEN` | B 非正整数 / 不是偶数 |
| `PARITY_INVALID` | 校验模式非法 |
| `TRANSITIONS_TOO_MANY` / `TIME_RANGE_TOO_LARGE` | 超过限制（100,000 条 / 10⁹ tick） |

合法波形中的接收错误保留在帧状态里（不删帧，可多个并存）：

- `PARITY_ERROR`：校验预期值与实际采样值不一致（两者都在报告中给出）。
- `FRAME_ERROR_STOP_LOW`：停止位采样不是高电平。
- `TRUNCATED` / `TRUNCATED_START_UNVERIFIED`：记录提前结束。
- `NOISE_SHORT_PULSE`：噪声候选（错误记录表中，独立于帧）。

## 生成器与接收器分离

`src/core/generator.ts` 只按位时间线产出电平变化记录；`src/core/decoder.ts` 只消费 `initialLevel/transitions/endTick`，**不读取生成器预先保存的字节答案**。测试中另有完全手写的电平表核对采样时刻与值，不只是往返测试。

## 数据与持久化

- 数据目录默认 `./data`（可用环境变量 `UART_DATA_DIR` 覆盖），SQLite 文件 `data/uart.sqlite`。
- 表：`waveforms`（波形）、`params_versions`（每个波形的参数版本，同参数复用）、`analyses`（解码结果快照）、`error_records`（帧/噪声错误记录）。
- 更改参数会创建/复用新的参数版本与分析记录；重启后仍可通过 `/analyses/{id}` 或 CLI 查询历史报告。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/waveforms` | 保存波形（`{name, waveform}`） |
| GET | `/waveforms` / `/waveforms/{id}` | 列表 / 详情 |
| POST | `/waveforms/generate` | 生成理想演示波形并保存 |
| POST | `/waveforms/{id}/decode` | 设置参数并解码（持久化） |
| GET | `/waveforms/{id}/report?bitTicks=&parity=&format=text\|json\|csv` | 导出报告 |
| GET | `/analyses/{id}` | 查询历史采样解释与错误 |
| GET | `/decode-preview?waveform=<json>&bitTicks=&parity=` | 不落库预览解码 |

## CLI

```powershell
npm run build            # 编译 TypeScript 到 dist/
npm test                 # 构建并运行 node:test（20 个用例）
npm start                # 启动 API（默认自动选择空闲端口）
npm run demo             # 运行五个教学演示场景并核对持久化

node dist/cli/index.js serve --port 3000
node dist/cli/index.js generate --bytes 00,41,FF --bit-ticks 10 --parity even `
  --bad-stop 1 --glitch-after 0 --truncate-bit 9 --out wave.json
node dist/cli/index.js decode --file wave.json --bit-ticks 10 --parity even
node dist/cli/index.js report --waveform-id 1 --bit-ticks 10 --format csv
node dist/cli/index.js save-waveform --file wave.json
node scripts/smoke.mjs   # HTTP API 冒烟测试
```

`generate` 选项：`--bytes`（十六进制逗号分隔）、`--bit-ticks`、`--parity`、`--gap`（帧间空闲 tick）、`--bad-stop 索引...`、`--glitch-after 帧索引...`、`--truncate-bit 1..N`（末帧截断到第 N 位之后）。

## 环境要求

- Node.js >= 22.5（开发验证版本：v25.5.0，使用内置实验性 `node:sqlite`，启动时有一条 ExperimentalWarning，属正常现象）。
- 仅开发依赖 `typescript` 与 `@types/node`，无运行时第三方依赖。

## 理想时钟模型的限制

本后端是**理想数字模型**：发送与接收使用完全相同的位周期、相位由起始沿精确确定、电平只有 0/1、跳变瞬时完成。它**不包含**真实串口中的抖动、波特率偏差、过采样多数表决、毛刺滤波、亚稳态、上升/下降时间、驱动能力、噪声容限、RS-232 电平转换等模拟电气特性；停止位为低后的后续字节重同步也采用本教学子集定义的整帧边界规则，而非真实 UART 的立即重新对齐行为。
