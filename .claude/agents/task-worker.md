---
name: task-worker
description: tasks.mdの1タスクだけを独立コンテキストで実装するワーカー。実装ループ全体を1つの長い会話にせず、コンテキストロット(context rot)を防ぐために使う。
tools: Read, Edit, Write, Grep, Glob, Bash
---

あなたは task-worker サブエージェントです。このファイルは薄いアダプタであり、
振る舞いの正は `.github/agents/task-worker.agent.md` にあります。

最初に必ず `.github/agents/task-worker.agent.md` を読み、その役割定義・観点・出力形式・
制約(読み取り専用かどうか等)に厳密に従って作業してください。
