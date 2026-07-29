# 漫剧 Agent 客户端

参考 ChatGPT/Codex 桌面客户端信息架构实现的 Tauri 2 MVP。界面围绕“对话驱动制作”设计，而不是传统剪辑器。

## 已实现

- 默认空工作区，不预置项目、小说、对话、角色、素材或任务
- 左侧项目、对话与一级功能入口
- 中间 Agent 对话、模型配置和任务队列页面
- 右侧当前项目的真实文件与任务面板
- 右侧栏折叠动画、中央区域同步扩展和拖拽调宽
- 右栏宽度本地记忆，双击分隔条恢复默认宽度
- 左、中、右三栏独立滚动，页面本身不溢出窗口
- Tauri 自定义窗口栏及 Windows 窗口控制
- 可拖动窗口、最小化、最大化与关闭
- 空项目创建与多对话管理
- TXT/Markdown 小说导入、本地保存和文本预览
- 项目、对话、资源与配置的本地持久化
- 对话、生图、视频三类模型配置
- Base URL、API Key、模型 ID、请求路径和自定义请求头配置
- OpenAI 兼容模型连接测试与真实 Chat Completions 调用
- 未配置模型时明确阻止发送，不生成模拟回复
- 输入框、自定义下拉框、弹窗、通知和错误提示使用统一 UI 规范
- 页面、标签、资源分组、下拉菜单、弹窗和通知具备过渡动画
- React/Vite 热更新
- 1080p 桌面布局与窄窗口适配

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Vite
- Lucide Icons

## 本地开发

```bash
npm install
npm run tauri dev
```

仅查看 Web 界面：

```bash
npm run dev
```

## 构建

```bash
npm run build
npm run tauri build -- --debug
```

调试版程序会生成在：

```text
src-tauri/target/debug/manju-agent-client.exe
```

## 当前边界

这是可以运行和交互的 MVP 客户端，不包含演示业务数据。对话模型已支持 OpenAI 兼容接口；生图和视频模型已具备独立配置入口，实际生成请求和任务调度需要在确定供应商协议后接入。当前 API Key 保存在本机 WebView 存储中，正式发布前应迁移到系统凭据存储。
