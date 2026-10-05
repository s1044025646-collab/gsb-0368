# UART 数字波形采样与串口帧错误解释后端

离线 UART 接收采样**教学**后端：从给定数字电平变化记录解码字节，并逐位解释采样位置与错误。
纯 API + CLI，无界面；TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生依赖），
Windows 本地运行，不依赖 Docker / WSL / 串口库 / 外部服务。

## 支持的 UART 子集

- 初始空闲高电平，8 个数据位，**最低位先传（LSB first）**，1 个停止位
- 校验模式：无校验（none）/ 偶校验（even）/ 奇校验（odd）
- 位周期 B 由用户明确给定（**正偶数 tick**），不自动估算波特率
- 不连接真实串口或硬件；全部运算按模拟 tick 完成，不做真实等待

## 解码模型

- 候选起点为空闲阶段的**下降沿** t，先在 `t + B/2` 验证起始位为低
- 数据位依次在 `t + 3B/2 + i*B`（i = 0..7）采样，随后按配置采样校验位与停止位
- 采样时间恰好等于变化时刻时，采用**变化后的电平**
- 完整帧占用 `[t, t + 总位数*B)`（半开区间），下一帧最早从该段结束开始；
  数据内部的跳变不会打断当前帧，也不会把每个下降沿都当作新帧
- 记录结束时刻为半开区间约定：采样点必须落在 `[0, endTick)` 内

### 重同步约定

- 短起始脉冲（中心采样时已变高）记为**噪声候选**，从 `t + 1` 起重新寻找下降沿；
  该时间边界在结果的 `noise[].resumeSearchFrom` 中公开
- 校验错误（`PARITY_ERROR`）与停止位非高（`STOP_BIT_ERROR`）只标记不丢帧，
  保留实际采到的字节与各位证据；多个问题可同时存在
- 记录在必要采样前结束则标记 `TRUNCATED`，列出已收到位（未收到的位为 `null`），
  **不用末尾电平无限延长来补成完整帧**

### 模型限制

这是理想时钟模型：不包含抖动、时钟漂移、毛刺滤波与模拟电气特性（上升时间、电平门限等）。

## 输入校验（格式无效 vs 接收错误）

以下情况在解码前直接拒绝（HTTP 400 / CLI 退出码 2），与合法波形中的接收错误区分：

| 错误码 | 含义 |
|---|---|
| `INVALID_FORMAT` / `INVALID_JSON` | 结构不合法 |
| `INVALID_LEVEL` | 非二值电平 |
| `INITIAL_LEVEL_NOT_IDLE` | 初始电平不是空闲高电平 |
| `NON_INTEGER_TICK` | tick 不是整数 |
| `NON_INCREASING_TICKS` / `DUPLICATE_TICK` | 时刻未严格递增 / 重复时刻 |
| `REDUNDANT_TRANSITION` | 不翻转的冗余变化 |
| `TICK_OUT_OF_RANGE` / `INVALID_END_TICK` | 时间超出范围 |
| `INVALID_BIT_PERIOD` / `INVALID_PARITY` | 位周期非正偶数 / 校验模式非法 |
| `LIMIT_EXCEEDED` | 超过限制（变化 ≤ 100000 条，总范围 ≤ 1e9 tick） |
| `NOT_FOUND` | 引用的对象不存在 |

## 构建、测试、启动、演示

```powershell
npm install
npm run build    # 编译 TypeScript 到 dist/
npm test         # 构建并运行全部测试（node:test）
npm start        # 启动 HTTP API（默认选择空闲端口；PORT=8080 可指定）
npm run demo     # 演示：B=10 连续 0x00/0x41/0xFF + 校验/坏停止位/短脉冲/截断
```

要求 Node.js ≥ 22.5（内置 `node:sqlite`），开发环境为 Node 25。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/waveforms` | 保存波形 `{initialLevel, transitions:[{tick,level}], endTick}` |
| GET | `/waveforms` | 列出波形 |
| POST | `/waveforms/demo` | 由 `{bytes, params}` 生成理想演示波形并保存 |
| POST | `/params` | 设置接收参数（相同参数复用版本，参数更改产生新分析） |
| POST | `/decode` | `{waveformId, paramsId}` 或 `{waveformId, params}` 解码并保存 |
| GET | `/decodes` / `/decodes/:id` | 查询采样解释（JSON） |
| GET | `/decodes/:id/report` | 导出 Markdown 报告 |

## CLI

```
node dist/src/cli.js save-waveform <file.json> [--name 名称]
node dist/src/cli.js demo --bytes 00,41,FF [--params 10,none] [--idle-gap N]
node dist/src/cli.js set-params --bit-period 10 --parity none
node dist/src/cli.js decode --waveform 1 [--params-id 1 | --bit-period 10 --parity even]
node dist/src/cli.js explain --decode 1
node dist/src/cli.js report --decode 1 [--out report.md]
node dist/src/cli.js list
node dist/src/cli.js serve [--port 8080]
```

## 数据与存储

- 数据目录为项目内 `data/`，SQLite 文件 `data/uart.db`
- 保存波形、参数版本、解码结果与错误记录，重启后可查询旧报告
- 参数（位周期 + 校验模式）按版本管理：参数更改会创建新版本，从而触发新分析
- 生成器（`src/generator.ts`）与接收器（`src/decoder.ts`）分离实现；
  解码只读取电平变化记录，绝不读取生成器保存的字节答案

## 输出字段

每帧包含：帧编号、`[startTick, endTick)` 半开区间、8 位数据（LSB 在前）、
十六进制字节、各采样点（类型/序号/tick/电平）、校验期望与实际值、停止位电平、
状态（`ok` / `parity_error` / `framing_error` / `truncated`）与错误码列表；
帧顺序保持原始时间顺序稳定。

## 测试覆盖

手写电平表逐一核对采样时刻与值（非生成-解码往返）、采样点与跳变重合、
背靠背帧、额外空闲、数据内部多次下降沿、偶/奇校验、坏停止位、短脉冲噪声、
末帧截断、半开区间边界、整体时间平移不变性、输入拒绝错误码、SQLite 重启后查询。
