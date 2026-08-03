import {
  ArrowDown,
  ArrowUp,
  AlertCircle,
  AudioLines,
  BookOpenText,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  Copy,
  File,
  FileText,
  FileUp,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  Link2,
  Menu,
  MessageSquareText,
  Mic,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  Video,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatedList,
  FadeContent,
  ShinyStatus,
  SpotlightSurface,
} from "./components/MicroInteractions";

type ModelKind = "chat" | "image" | "video";
type AccessMode = "ask" | "approve" | "full";
type ResourceCategory =
  | "原著"
  | "故事设定"
  | "剧本"
  | "角色"
  | "场景"
  | "分镜"
  | "成片";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  actions?: MessageAction[];
  status?: "stopped";
};

type MessageAction =
  | {
      type: "configure-model";
      modelKind: ModelKind;
      label: string;
    }
  | {
      type: "open-resource";
      resourceId: string;
      label: string;
    };

type StreamingMessage = {
  id: string;
  threadId: string;
  content: string;
};

type ChatStreamEvent = {
  event: "started" | "delta" | "finished" | "cancelled";
  data: string;
};

type ActiveGeneration = {
  requestId: string;
  threadId: string;
  messageId: string;
  content: string;
  cancelled: boolean;
  artifact?: ActiveTextArtifact;
};

type TextArtifactIntent = {
  category: "原著";
  title: string;
  fileName: string;
  operation: "create" | "continue";
};

type ActiveTextArtifact = {
  context: WritableContext;
  intent: TextArtifactIntent;
  resource: ProjectResource;
  baseContent: string;
  lastQueuedLength: number;
  writeChain: Promise<ProjectResource>;
};

type NovelCreationMode = "ai" | "blank";
type NovelGenerationMode = "plan" | "chapter" | "short";

type WritableContext = {
  project: Project;
  thread: Thread;
};

type ManagedOutputApproval = {
  action: string;
  resolve: (approved: boolean) => void;
};

type Thread = {
  id: string;
  title: string;
  projectId: string | null;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type ProjectResource = {
  id: string;
  name: string;
  category: ResourceCategory;
  kind: "text" | "image" | "video" | "file";
  size?: number;
  path?: string;
  preview?: string;
  status?: "generating" | "ready" | "stopped" | "error";
  createdAt: number;
};

type Project = {
  id: string;
  name: string;
  rootPath: string;
  managed?: boolean;
  createdAt: number;
  updatedAt: number;
  resources: ProjectResource[];
};

type WorkspaceState = {
  projects: Project[];
  threads: Thread[];
};

type ModelConfig = {
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiPath: string;
  headers: string;
};

type ModelConfigs = Record<ModelKind, ModelConfig>;

type ModelProviderPreset = {
  label: string;
  baseUrl: string;
  apiPath: string;
  headers: string;
  description: string;
  modelPlaceholder: string;
  defaultModel?: string;
};

type ModelCatalogState = {
  provider: string;
  loading: boolean;
  models: string[];
  error: string;
};

type WorkspaceSearchItem = {
  id: string;
  kind: "project" | "thread" | "resource";
  title: string;
  meta: string;
  timestamp: number;
  projectId?: string;
  threadId?: string;
  resourceId?: string;
  category?: ResourceCategory;
};

type SidebarSectionKey = "pinned" | "projects" | "recent";

type SidebarPreferences = {
  collapsedSections: SidebarSectionKey[];
  collapsedProjectIds: string[];
};

const emptyWorkspace: WorkspaceState = { projects: [], threads: [] };

const accessModeOptions: Array<{
  value: AccessMode;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: "请求批准",
    description: "越过当前项目边界前先征求你的同意",
  },
  {
    value: "approve",
    label: "替我审批",
    description: "自动审查操作，但仍限制在已绑定项目内",
  },
  {
    value: "full",
    label: "完全访问",
    description: "未绑定项目时自动写入应用托管 outputs",
  },
];

function accessModeLabel(mode: AccessMode) {
  return (
    accessModeOptions.find((option) => option.value === mode)?.label ??
    "请求批准"
  );
}
const defaultLeftPanelWidth = 272;
const minLeftPanelWidth = 232;
const maxLeftPanelWidth = 380;
const minCenterPanelWidth = 520;
const defaultSidebarPreferences: SidebarPreferences = {
  collapsedSections: [],
  collapsedProjectIds: [],
};

const emptyModelCatalogs: Record<ModelKind, ModelCatalogState> = {
  chat: { provider: "", loading: false, models: [], error: "" },
  image: { provider: "", loading: false, models: [], error: "" },
  video: { provider: "", loading: false, models: [], error: "" },
};

const modelProviderPresets: Record<
  ModelKind,
  ModelProviderPreset[]
> = {
  chat: [
    {
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiPath: "chat/completions",
      headers: "{}",
      description: "OpenAI 官方 API · Chat Completions 协议",
      modelPlaceholder: "例如：gpt-5",
    },
    {
      label: "Google Gemini",
      baseUrl:
        "https://generativelanguage.googleapis.com/v1beta/openai",
      apiPath: "chat/completions",
      headers: '{"x-goog-api-client":"manju-agent/0.1.0"}',
      description: "Gemini 官方 OpenAI 兼容端点",
      modelPlaceholder: "例如：gemini-3.6-flash",
    },
    {
      label: "Anthropic Claude / Claude Code",
      baseUrl: "https://api.anthropic.com",
      apiPath: "v1/messages",
      headers: "{}",
      description: "Anthropic Messages 原生协议，可配置兼容网关",
      modelPlaceholder: "例如：claude-opus-4-6",
    },
    {
      label: "智谱 GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiPath: "chat/completions",
      headers: "{}",
      description: "智谱开放平台 · OpenAI 兼容协议",
      modelPlaceholder: "例如：glm-4.7",
    },
    {
      label: "Moonshot Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      apiPath: "chat/completions",
      headers: "{}",
      description: "Moonshot 开放平台 · OpenAI 兼容协议",
      modelPlaceholder: "填写控制台提供的 Kimi 模型 ID",
    },
    {
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiPath: "chat/completions",
      headers: "{}",
      description: "DeepSeek 官方 API · OpenAI 兼容协议",
      modelPlaceholder: "例如：deepseek-v4-pro",
    },
    {
      label: "阿里云通义千问",
      baseUrl:
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiPath: "chat/completions",
      headers: "{}",
      description: "阿里云百炼北京地域 · OpenAI 兼容协议",
      modelPlaceholder: "例如：qwen-plus",
    },
    {
      label: "字节火山方舟（豆包）",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiPath: "chat/completions",
      headers: "{}",
      description: "火山方舟官方端点 · OpenAI 兼容协议",
      modelPlaceholder: "填写方舟模型 ID 或 Endpoint ID",
    },
    {
      label: "自定义 OpenAI 兼容",
      baseUrl: "",
      apiPath: "chat/completions",
      headers: "{}",
      description: "适用于代理、网关和私有部署服务",
      modelPlaceholder: "填写服务端使用的模型 ID",
    },
  ],
  image: [
    {
      label: "Kie.ai Seedream",
      baseUrl: "https://api.kie.ai",
      apiPath: "api/v1/jobs/createTask",
      headers: "{}",
      description:
        "当前调试服务 · Kie.ai 中转的 Seedream 5.0 Pro 异步生图 API",
      modelPlaceholder: "seedream/5-pro-text-to-image",
      defaultModel: "seedream/5-pro-text-to-image",
    },
    {
      label: "字节火山方舟 Seedream",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiPath: "images/generations",
      headers: "{}",
      description: "支持 Seedream 5.0 Lite、4.5、4.0 等字节生图模型",
      modelPlaceholder:
        "例如：doubao-seedream-4-0-250828 或 Endpoint ID",
    },
  ],
  video: [
    {
      label: "字节火山方舟 Seedance",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiPath: "contents/generations/tasks",
      headers: "{}",
      description: "Seedance 系列 · 文生视频、图生视频与异步任务",
      modelPlaceholder: "填写 Seedance 模型 ID 或 Endpoint ID",
    },
  ],
};

const defaultModelConfigs: ModelConfigs = {
  chat: {
    label: "对话模型",
    provider: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKey: "",
    apiPath: "chat/completions",
    headers: "{}",
  },
  image: {
    label: "生图模型",
    provider: "Kie.ai Seedream",
    baseUrl: "https://api.kie.ai",
    model: "seedream/5-pro-text-to-image",
    apiKey: "",
    apiPath: "api/v1/jobs/createTask",
    headers: "{}",
  },
  video: {
    label: "视频模型",
    provider: "字节火山方舟 Seedance",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    apiKey: "",
    apiPath: "contents/generations/tasks",
    headers: "{}",
  },
};

const resourceCategoryOrder: ResourceCategory[] = [
  "原著",
  "故事设定",
  "剧本",
  "角色",
  "场景",
  "分镜",
  "成片",
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createMessage(
  role: Message["role"],
  content: string,
  actions?: MessageAction[],
): Message {
  return {
    id: createId(),
    role,
    content,
    createdAt: Date.now(),
    ...(actions && actions.length > 0 ? { actions } : {}),
  };
}

function normalizeNovelFileName(title: string) {
  const normalized = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "") || "未命名小说";
  return /\.(txt|md|markdown)$/i.test(normalized)
    ? normalized
    : `${normalized}.md`;
}

function createAvailableFileName(
  desiredName: string,
  resources: ProjectResource[],
) {
  const occupied = new Set(
    resources.map((resource) => resource.name.toLocaleLowerCase()),
  );
  if (!occupied.has(desiredName.toLocaleLowerCase())) return desiredName;

  const extensionMatch = desiredName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const baseName = extension
    ? desiredName.slice(0, -extension.length)
    : desiredName;
  let version = 2;
  let candidate = `${baseName} (${version})${extension}`;
  while (occupied.has(candidate.toLocaleLowerCase())) {
    version += 1;
    candidate = `${baseName} (${version})${extension}`;
  }
  return candidate;
}

function createTextArtifactIntent(
  input: string,
  thread: Thread | null,
  project: Project | null,
): TextArtifactIntent | null {
  const normalized = input.trim();
  const asksToCreate =
    /(写|创作|生成|新建|产出|起草|来一篇|来一个|完成|开始写)/i.test(
      normalized,
    );
  const asksForNovel =
    /(小说|原著|故事正文|短篇|长篇|章节|第一章|正文)/i.test(
      normalized,
    );
  const asksToContinue =
    /(继续写|接着写|续写|扩写|补写|写下一章|下一章|按上面.*写|完成正文)/i.test(
      normalized,
    );
  const hasNovelContext = Boolean(
    project?.resources.some((resource) => resource.category === "原著") ||
      thread?.messages.some((message) =>
        /(小说|原著|正文|章节)/i.test(message.content),
      ),
  );
  const asksAQuestion =
    /^(怎么|如何|为什么|能不能|是否可以|可不可以|请解释)/i.test(
      normalized,
    );

  if (
    asksAQuestion ||
    !(
      (asksToCreate && asksForNovel) ||
      (asksToContinue && hasNovelContext)
    )
  ) {
    return null;
  }

  const quotedTitle = normalized.match(
    /[《「“"]([^》」”"]{1,40})[》」”"]/u,
  )?.[1];
  const conversationTitle =
    thread?.title && thread.title !== "新任务"
      ? thread.title
          .replace(/^(创作|分析)[《「]/, "")
          .replace(/[》」]$/, "")
      : "";
  const compactRequestTitle = normalized
    .replace(
      /^(请|麻烦|帮我|给我|直接|现在|开始|来)(再)?/,
      "",
    )
    .replace(
      /(写|创作|生成|新建|产出|起草|继续写|接着写|续写|扩写)/g,
      "",
    )
    .replace(/[，。！？,.!?]/g, " ")
    .trim()
    .slice(0, 28);
  const title =
    quotedTitle ||
    conversationTitle ||
    compactRequestTitle ||
    (asksToContinue ? "续写小说" : "未命名小说");

  return {
    category: "原著",
    title,
    fileName: normalizeNovelFileName(title),
    operation: asksToContinue ? "continue" : "create",
  };
}

function textByteLength(content: string) {
  return new TextEncoder().encode(content).byteLength;
}

function isModelConfigured(config: ModelConfig) {
  const apiKeyReady =
    config.provider.includes("自定义") ||
    Boolean(config.apiKey.trim());
  return Boolean(
    config.baseUrl.trim() && config.model.trim() && apiKeyReady,
  );
}

function requiredGenerationModels(input: string): ModelKind[] {
  const executionIntent =
    /(生成|制作|创建|绘制|画一|画出|做成|做个|做一|做几|转成|变成|产出|输出|出图|开始做|帮我做)/i.test(
      input,
    );
  if (!executionIntent) return [];

  const needsVideo =
    /(视频|漫剧|动态漫画|动画|成片|动态镜头|图生视频|文生视频|seedance)/i.test(
      input,
    );
  const needsImage =
    /(生图|图片|图像|一张图|几张图|张图|插画|漫画|立绘|角色图|场景图|分镜图|静态物料|seedream)/i.test(
      input,
    ) || /(漫剧|动态漫画)/i.test(input);

  return [
    ...(needsImage ? (["image"] as ModelKind[]) : []),
    ...(needsVideo ? (["video"] as ModelKind[]) : []),
  ];
}

function modelKindName(kind: ModelKind) {
  if (kind === "image") return "生图模型";
  if (kind === "video") return "视频模型";
  return "对话模型";
}

function buildModelInput(
  input: string,
  thread: Thread | null,
  project: Project | null,
  artifactIntent: TextArtifactIntent | null,
  continuationBase = "",
) {
  const recentConversation = (thread?.messages ?? [])
    .filter((message) => message.role !== "system")
    .slice(-6)
    .map(
      (message) =>
        `${message.role === "user" ? "用户" : "Agent"}：${message.content.slice(-1800)}`,
    )
    .join("\n");
  const latestNovel = artifactIntent
    ? project?.resources.find(
        (resource) => resource.category === "原著" && resource.preview,
      )
    : null;
  const novelContext =
    artifactIntent?.operation === "continue" &&
    (continuationBase || latestNovel?.preview)
      ? `\n\n现有原著末尾片段：\n${(
          continuationBase ||
          latestNovel?.preview ||
          ""
        ).slice(-6000)}`
      : "";

  return `${
    recentConversation
      ? `最近对话：\n${recentConversation}\n\n`
      : ""
  }当前请求：\n${input}${novelContext}`;
}

function buildAgentSystemPrompt(
  configs: ModelConfigs,
  project: Project | null,
  accessMode: AccessMode,
  artifactIntent: TextArtifactIntent | null = null,
) {
  const capability = (kind: ModelKind) => {
    const config = configs[kind];
    return isModelConfigured(config)
      ? `已配置（${config.provider} / ${config.model}）`
      : "未配置";
  };
  const resourceSummary = project
    ? resourceCategoryOrder
        .map((category) => {
          const count = project.resources.filter(
            (resource) => resource.category === category,
          ).length;
          return count > 0 ? `${category} ${count}` : "";
        })
        .filter(Boolean)
        .join("、") || "暂无制作资源"
    : accessMode === "full"
      ? "当前任务未绑定外部文件夹；需要写入时客户端会自动创建应用托管 outputs"
      : "当前任务未绑定项目文件夹";

  return `你是漫剧制作 Agent，负责把小说逐步转化为可生产的漫剧。请用简洁、专业的中文回复，并给出下一步可执行动作。

客户端实时能力状态：
- 对话模型：${capability("chat")}
- 生图模型：${capability("image")}
- 视频模型：${capability("video")}
- 权限模式：${accessModeLabel(accessMode)}
- 当前项目：${project?.name ?? "未绑定"}
- 已有资源：${resourceSummary}

必须遵循的制作顺序：
1. 导入或创作原著后先建立章节索引、故事设定和角色表，不要一次把整本小说塞进上下文。
2. 按章节或场次拆解剧情，形成剧本、镜头目标和连续性约束。
3. 角色设定、场景设定和分镜确认后，才进入生图环节，生成角色、场景、分镜等静态物料。
4. 静态物料和镜头运动方案准备完成后，才进入视频环节；视频模型用于文生视频、图生视频、动态镜头和成片素材。
5. 缺少对应模型配置时，不得声称已经生成图片或视频；应明确指出缺少的能力并等待客户端引导用户配置。
6. 不要跳过用户确认直接批量消耗生成额度。
7. 权限模式为“完全访问”时，不要要求用户先绑定项目文件夹；客户端会把需要落盘的内容保存到应用托管的 outputs 工作区。
${artifactIntent ? `8. 本轮是原著文件产物任务，目标文件为“${artifactIntent.fileName}”。客户端已经创建文件并会持续保存你的输出；你只输出可直接写入文件的 Markdown 小说正文，不要输出权限提醒、保存说明、操作教程或“以下是”等开场白。` : ""}`;
}

function createThread(
  projectId: string | null = null,
  title = "新任务",
): Thread {
  const now = Date.now();
  return {
    id: createId(),
    title,
    projectId,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function folderName(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "未命名文件夹";
}

function isManagedProject(
  project: Pick<Project, "managed" | "rootPath">,
) {
  return project.managed === true || /[\\/]outputs[\\/]/i.test(project.rootPath);
}

function createProject(rootPath: string): Project {
  const now = Date.now();
  return {
    id: createId(),
    name: folderName(rootPath),
    rootPath,
    managed: false,
    createdAt: now,
    updatedAt: now,
    resources: [],
  };
}

function normalizeWorkspace(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return emptyWorkspace;
  const raw = value as {
    projects?: Array<
      Partial<Project> & {
        threads?: Thread[];
      }
    >;
    threads?: Thread[];
  };
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const projects: Project[] = rawProjects
    .filter((project) => typeof project.id === "string")
    .map((project) => {
      const rootPath =
        typeof project.rootPath === "string" ? project.rootPath : "";
      return {
        id: project.id as string,
        name:
          typeof project.name === "string"
            ? project.name
            : "未命名文件夹",
        rootPath,
        managed: isManagedProject({
          managed: project.managed,
          rootPath,
        }),
        createdAt:
          typeof project.createdAt === "number"
            ? project.createdAt
            : Date.now(),
        updatedAt:
          typeof project.updatedAt === "number"
            ? project.updatedAt
            : Date.now(),
        resources: Array.isArray(project.resources)
          ? project.resources
          : [],
      };
    });

  const projectIds = new Set(projects.map((project) => project.id));
  const normalizeThread = (
    thread: Partial<Thread>,
    fallbackProjectId: string | null,
  ): Thread | null => {
    if (typeof thread.id !== "string") return null;
    const candidateProjectId =
      typeof thread.projectId === "string"
        ? thread.projectId
        : fallbackProjectId;
    const projectId =
      candidateProjectId && projectIds.has(candidateProjectId)
        ? candidateProjectId
        : null;
    const createdAt =
      typeof thread.createdAt === "number"
        ? thread.createdAt
        : Date.now();
    return {
      id: thread.id,
      title:
        typeof thread.title === "string" && thread.title.trim()
          ? thread.title
          : "未命名任务",
      projectId,
      pinnedAt:
        typeof thread.pinnedAt === "number"
          ? thread.pinnedAt
          : null,
      createdAt,
      updatedAt:
        typeof thread.updatedAt === "number"
          ? thread.updatedAt
          : createdAt,
      messages: Array.isArray(thread.messages)
        ? thread.messages
        : [],
    };
  };

  const migratedThreads = rawProjects.flatMap((project) =>
    Array.isArray(project.threads)
      ? project.threads
          .map((thread) =>
            normalizeThread(
              thread,
              typeof project.id === "string" ? project.id : null,
            ),
          )
          .filter((thread): thread is Thread => thread !== null)
      : [],
  );
  const directThreads = Array.isArray(raw.threads)
    ? raw.threads
        .map((thread) => normalizeThread(thread, null))
        .filter((thread): thread is Thread => thread !== null)
    : [];
  const mergedThreads = new Map<string, Thread>();
  [...migratedThreads, ...directThreads].forEach((thread) => {
    mergedThreads.set(thread.id, thread);
  });
  const threads = [...mergedThreads.values()].filter(
    (thread) =>
      thread.projectId !== null ||
      thread.messages.length > 0 ||
      thread.title !== "新任务",
  );

  const synchronizedProjects = projects.map((project) => {
    if (!isManagedProject(project)) return project;
    const conversationTitle = threads
      .filter((thread) => thread.projectId === project.id)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .find((thread) => thread.title !== "新任务")?.title;
    return conversationTitle
      ? { ...project, name: conversationTitle }
      : project;
  });

  return {
    projects: synchronizedProjects,
    threads,
  };
}

function useWorkspaceState() {
  const [value, setValue] = useState<WorkspaceState>(() => {
    try {
      const raw =
        window.localStorage.getItem("manju-agent-workspace-v4") ??
        window.localStorage.getItem("manju-agent-workspace-v3") ??
        window.localStorage.getItem("manju-agent-workspace-v2");
      return raw ? normalizeWorkspace(JSON.parse(raw)) : emptyWorkspace;
    } catch {
      return emptyWorkspace;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(
      "manju-agent-workspace-v4",
      JSON.stringify(value),
    );
  }, [value]);

  return [value, setValue] as const;
}

function useStoredState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function App() {
  const [workspace, setWorkspace] = useWorkspaceState();
  const [accessMode, setAccessMode] = useStoredState<AccessMode>(
    "manju-agent-access-mode-v1",
    "ask",
  );
  const [modelConfigs, setModelConfigs] = useStoredState<ModelConfigs>(
    "manju-agent-model-configs-v2",
    defaultModelConfigs,
  );
  useEffect(() => {
    setModelConfigs((current) => {
      const withoutLegacyEnabled = (
        config: ModelConfig & { enabled?: boolean },
      ): ModelConfig => {
        const { enabled: _legacyEnabled, ...rest } = config;
        return rest;
      };
      const normalizedChatProvider =
        current.chat.provider === "OpenAI 兼容"
          ? "自定义 OpenAI 兼容"
          : current.chat.provider;
      const chat = withoutLegacyEnabled(current.chat);
      const image = withoutLegacyEnabled(current.image);
      const video = withoutLegacyEnabled(current.video);
      const kieImagePreset = modelProviderPresets.image[0];
      const shouldUseKieDebugDefault =
        image.provider === "字节火山方舟 Seedream" &&
        !image.apiKey.trim() &&
        !image.model.trim();

      return {
        chat: {
          ...chat,
          provider: normalizedChatProvider,
        },
        image: shouldUseKieDebugDefault
          ? {
              ...image,
              provider: kieImagePreset.label,
              baseUrl: kieImagePreset.baseUrl,
              model: kieImagePreset.defaultModel ?? "",
              apiPath: kieImagePreset.apiPath,
              headers: kieImagePreset.headers,
            }
          : image,
        video,
      };
    });
  }, [setModelConfigs]);
  const [rightOpen, setRightOpen] = useStoredState(
    "manju-agent-right-panel-v2",
    true,
  );
  const [leftWidth, setLeftWidth] = useStoredState(
    "manju-agent-left-width-v1",
    defaultLeftPanelWidth,
  );
  const [rightWidth, setRightWidth] = useStoredState(
    "manju-agent-right-width-v2",
    380,
  );
  const [lastSelectedThreadId, setLastSelectedThreadId] =
    useStoredState("manju-agent-last-thread-v1", "");
  const [leftResizing, setLeftResizing] = useState(false);
  const [rightResizing, setRightResizing] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState(() => {
    if (
      lastSelectedThreadId &&
      workspace.threads.some(
        (thread) => thread.id === lastSelectedThreadId,
      )
    ) {
      return lastSelectedThreadId;
    }
    return (
      [...workspace.threads].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      )[0]?.id ?? ""
    );
  });
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [rightTab, setRightTab] = useState<"files" | "tasks">("files");
  const [activeModelKind, setActiveModelKind] =
    useState<ModelKind>("chat");
  const [composer, setComposer] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [streamingMessage, setStreamingMessage] =
    useState<StreamingMessage | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [resourcePreviewOpen, setResourcePreviewOpen] = useState(false);
  const [novelCreationMode, setNovelCreationMode] =
    useState<NovelCreationMode | null>(null);
  const [managedOutputApproval, setManagedOutputApproval] =
    useState<ManagedOutputApproval | null>(null);
  const [toast, setToast] = useState("");
  const [testState, setTestState] = useState<{
    loading: boolean;
    kind?: "success" | "error";
    text?: string;
  }>({ loading: false });
  const [modelCatalogs, setModelCatalogs] = useStoredState<
    Record<ModelKind, ModelCatalogState>
  >("manju-agent-model-catalogs-v1", emptyModelCatalogs);
  useEffect(() => {
    setModelCatalogs((current) => {
      const kinds: ModelKind[] = ["chat", "image", "video"];
      if (
        !kinds.some(
          (kind) =>
            current[kind].loading || Boolean(current[kind].error),
        )
      ) {
        return current;
      }
      return Object.fromEntries(
        kinds.map((kind) => [
          kind,
          {
            ...current[kind],
            loading: false,
            error: "",
          },
        ]),
      ) as Record<ModelKind, ModelCatalogState>;
    });
  }, [setModelCatalogs]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeGenerationRef = useRef<ActiveGeneration | null>(
    null,
  );
  const novelGenerationRequestRef = useRef("");
  const pendingGuidanceRef = useRef(false);

  const clampLeftWidth = (
    width: number,
    currentRightWidth = rightOpen ? rightWidth : 0,
  ) => {
    const viewportLimit = Math.max(
      minLeftPanelWidth,
      Math.min(
        maxLeftPanelWidth,
        window.innerWidth -
          currentRightWidth -
          minCenterPanelWidth,
      ),
    );
    return Math.round(
      Math.max(
        minLeftPanelWidth,
        Math.min(viewportLimit, width),
      ),
    );
  };

  const clampRightWidth = (
    width: number,
    currentLeftWidth = leftWidth,
  ) => {
    const viewportLimit = Math.max(
      300,
      Math.min(
        640,
        window.innerWidth -
          currentLeftWidth -
          minCenterPanelWidth,
      ),
    );
    return Math.round(Math.max(300, Math.min(viewportLimit, width)));
  };

  useEffect(() => {
    const handleResize = () => {
      setLeftWidth((width) =>
        clampLeftWidth(width, rightOpen ? rightWidth : 0),
      );
      setRightWidth((width) => clampRightWidth(width, leftWidth));
    };
    const frame = window.requestAnimationFrame(handleResize);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [leftWidth, rightOpen, rightWidth, setLeftWidth, setRightWidth]);

  const startLeftResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = leftWidth;
    setLeftResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setLeftWidth(
        clampLeftWidth(
          startWidth + moveEvent.clientX - startX,
          rightOpen ? rightWidth : 0,
        ),
      );
    };

    const finishResize = () => {
      setLeftResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const startRightResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!rightOpen) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = rightWidth;
    setRightResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setRightWidth(
        clampRightWidth(
          startWidth + startX - moveEvent.clientX,
        ),
      );
    };

    const finishResize = () => {
      setRightResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const selectedThread = useMemo(
    () =>
      workspace.threads.find(
        (thread) => thread.id === selectedThreadId,
      ) ?? null,
    [selectedThreadId, workspace.threads],
  );

  const selectedProject = useMemo(
    () =>
      workspace.projects.find(
        (project) => project.id === selectedThread?.projectId,
      ) ?? null,
    [selectedThread?.projectId, workspace.projects],
  );

  const selectedResource = useMemo(
    () =>
      selectedProject?.resources.find(
        (resource) => resource.id === selectedResourceId,
      ) ?? null,
    [selectedProject, selectedResourceId],
  );

  useEffect(() => {
    setLastSelectedThreadId(selectedThreadId);
  }, [selectedThreadId, setLastSelectedThreadId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setSearchDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const updateProject = (
    projectId: string,
    update: (project: Project) => Project,
  ) => {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? update(project) : project,
      ),
    }));
  };

  const updateThread = (
    threadId: string,
    update: (thread: Thread) => Thread,
  ) => {
    setWorkspace((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === threadId ? update(thread) : thread,
      ),
    }));
  };

  const toggleThreadPinned = (threadId: string) => {
    const thread = workspace.threads.find(
      (item) => item.id === threadId,
    );
    if (!thread) return;
    const willPin = thread.pinnedAt === null;
    updateThread(threadId, (current) => ({
      ...current,
      pinnedAt: willPin ? Date.now() : null,
    }));
    setToast(willPin ? "任务已置顶" : "已取消置顶");
  };

  const createNewThread = () => {
    setSelectedThreadId("");
    setSelectedResourceId("");
    setComposer("");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const bindThreadToFolder = (rootPath: string) => {
    const normalizedPath = rootPath.replace(/[\\/]+$/, "");
    const existingProject = workspace.projects.find(
      (project) =>
        project.rootPath.replace(/[\\/]+$/, "").toLocaleLowerCase() ===
        normalizedPath.toLocaleLowerCase(),
    );
    const project = existingProject ?? createProject(normalizedPath);
    const thread = selectedThread ?? createThread(project.id);

    setWorkspace((current) => ({
      projects: existingProject
        ? current.projects
        : [project, ...current.projects],
      threads: current.threads.some((item) => item.id === thread.id)
        ? current.threads.map((item) =>
            item.id === thread.id
              ? {
                  ...item,
                  projectId: project.id,
                  updatedAt: Date.now(),
                }
              : item,
          )
        : [{ ...thread, projectId: project.id }, ...current.threads],
    }));
    setSelectedThreadId(thread.id);
    setSelectedResourceId("");
    setRightOpen(true);
    setToast(`已绑定项目文件夹：${project.name}`);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const chooseProjectFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
      });
      if (typeof selected === "string") {
        bindThreadToFolder(selected);
      }
    } catch (error) {
      setToast(`无法打开文件夹选择器：${String(error)}`);
    }
  };

  const openCurrentProjectFolder = async () => {
    if (!selectedProject) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<void>("open_project_folder", {
        path: selectedProject.rootPath,
      });
    } catch (error) {
      setToast(`无法打开项目目录：${String(error)}`);
    }
  };

  const copyCurrentProjectPath = async () => {
    if (!selectedProject) return;
    try {
      await navigator.clipboard.writeText(selectedProject.rootPath);
      setToast("项目目录已复制");
    } catch (error) {
      setToast(`无法复制项目目录：${String(error)}`);
    }
  };

  const requestManagedOutputAccess = (action: string) =>
    new Promise<boolean>((resolve) => {
      setManagedOutputApproval({ action, resolve });
    });

  const finishManagedOutputApproval = (approved: boolean) => {
    const pending = managedOutputApproval;
    if (!pending) return;
    setManagedOutputApproval(null);
    pending.resolve(approved);
  };

  const ensureWritableContext = async (
    action: string,
  ): Promise<WritableContext | null> => {
    if (selectedProject) {
      return {
        project: selectedProject,
        thread: selectedThread ?? createThread(selectedProject.id),
      };
    }

    if (accessMode === "approve") {
      setToast("“替我审批”仅在已绑定项目内自动执行，请先选择项目文件夹");
      return null;
    }

    if (accessMode === "ask") {
      const approved = await requestManagedOutputAccess(action);
      if (!approved) {
        setToast("已取消创建应用输出目录");
        return null;
      }
    }

    try {
      const projectId = createId();
      const { invoke } = await import("@tauri-apps/api/core");
      const rootPath = await invoke<string>("create_managed_output", {
        projectId,
      });
      const outputName =
        selectedThread && selectedThread.title !== "新任务"
          ? selectedThread.title
          : "新任务";
      const project: Project = {
        id: projectId,
        name: outputName,
        rootPath,
        managed: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        resources: [],
      };
      const thread = selectedThread ?? createThread(project.id);

      setWorkspace((current) => ({
        projects: [project, ...current.projects],
        threads: current.threads.some((item) => item.id === thread.id)
          ? current.threads.map((item) =>
              item.id === thread.id
                ? {
                    ...item,
                    projectId: project.id,
                    updatedAt: Date.now(),
                  }
                : item,
            )
          : [{ ...thread, projectId: project.id }, ...current.threads],
      }));
      setSelectedThreadId(thread.id);
      setRightOpen(true);
      setToast("已为当前对话创建应用托管输出目录");
      return { project, thread: { ...thread, projectId: project.id } };
    } catch (error) {
      setToast(`无法创建应用输出目录：${String(error)}`);
      return null;
    }
  };

  const persistProjectSource = async (
    project: Project,
    fileName: string,
    content: string,
  ) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("save_project_source", {
      projectId: project.id,
      projectRoot: project.rootPath,
      managed: isManagedProject(project),
      fileName,
      content,
    });
  };

  const handleNovelImport = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["txt", "md", "markdown"].includes(extension ?? "")) {
      setToast("当前支持 TXT、MD 和 Markdown 文件");
      return;
    }

    const content = await file.text();
    const baseName = file.name.replace(/\.[^.]+$/, "") || "未命名原著";
    const context = await ensureWritableContext("导入并保存这部小说");
    if (!context) return;

    let savedPath = "";
    try {
      savedPath = await persistProjectSource(
        context.project,
        file.name,
        content,
      );
    } catch (error) {
      setToast(`小说导入失败，未创建资源：${String(error)}`);
      return;
    }

    const resource: ProjectResource = {
      id: createId(),
      name: file.name,
      category: "原著",
      kind: "text",
      size: file.size,
      path: savedPath,
      preview: content.slice(0, 12000),
      status: "ready",
      createdAt: Date.now(),
    };

    const projectId = context.project.id;
    const thread = context.thread;
    const threadId = thread.id;
    updateProject(projectId, (current) => ({
      ...current,
      name: isManagedProject(current)
        ? `分析《${baseName}》`
        : current.name,
      updatedAt: Date.now(),
      resources: [
        resource,
        ...current.resources.filter(
          (item) =>
            !(item.category === "原著" && item.name === resource.name),
        ),
      ],
    }));
    setWorkspace((current) => ({
      ...current,
      threads: current.threads.some((item) => item.id === threadId)
        ? current.threads.map((item) =>
            item.id === threadId
              ? {
                  ...item,
                  title:
                    item.messages.length === 0
                      ? `分析《${baseName}》`
                      : item.title,
                  updatedAt: Date.now(),
                  messages: [
                    ...item.messages,
                    createMessage(
                      "system",
                      `已导入原著文件「${file.name}」，共 ${content.length.toLocaleString()} 个字符。`,
                    ),
                  ],
                }
              : item,
          )
        : [
            {
              ...thread,
              title: `分析《${baseName}》`,
              messages: [
                createMessage(
                  "system",
                  `已导入原著文件「${file.name}」，共 ${content.length.toLocaleString()} 个字符。`,
                ),
              ],
            },
            ...current.threads,
          ],
    }));
    setSelectedThreadId(threadId);
    setSelectedResourceId(resource.id);
    setRightTab("files");
    setRightOpen(true);
    setToast("原著已导入当前项目");
  };

  const openNovelCreator = async (mode: NovelCreationMode) => {
    if (mode === "ai" && !isModelConfigured(modelConfigs.chat)) {
      setActiveModelKind("chat");
      setSettingsDialogOpen(true);
      setToast("AI 创作小说前需要先配置对话模型");
      return;
    }
    const context = await ensureWritableContext(
      mode === "ai" ? "创作并保存 AI 小说" : "新建并保存空白小说",
    );
    if (!context) return;
    setNovelCreationMode(mode);
  };

  const generateNovelDraft = async (
    title: string,
    brief: string,
    mode: NovelGenerationMode,
    onDelta: (content: string) => void,
  ) => {
    const config = modelConfigs.chat;
    if (!isModelConfigured(config)) {
      throw new Error("请先配置可用的对话模型");
    }
    if (!brief.trim()) {
      throw new Error("请先填写题材、人物或故事构想");
    }

    const modeInstruction: Record<NovelGenerationMode, string> = {
      plan: "生成可继续扩写的小说方案，包括故事梗概、世界观、主要角色、核心矛盾和分章目录，不写无关说明。",
      chapter:
        "生成小说第一章草稿，约 3000 字。需要有明确场景、人物行动、冲突和章末钩子，只输出可编辑正文。",
      short:
        "生成结构完整的中文短篇小说，约 6000 字。保证开端、发展、转折和结局完整，只输出可编辑正文。",
    };
    const requestId = createId();
    novelGenerationRequestRef.current = requestId;
    let content = "";

    try {
      const { Channel, invoke } = await import(
        "@tauri-apps/api/core"
      );
      const onEvent = new Channel<ChatStreamEvent>();
      let settleStream: () => void = () => undefined;
      const streamSettled = new Promise<void>((resolve) => {
        settleStream = resolve;
      });
      onEvent.onmessage = (event) => {
        if (
          event.event === "finished" ||
          event.event === "cancelled"
        ) {
          settleStream();
        }
        if (
          event.event !== "delta" ||
          !event.data ||
          novelGenerationRequestRef.current !== requestId
        ) {
          return;
        }
        content += event.data;
        onDelta(content);
      };

      await invoke<void>("stream_chat_message", {
        requestId,
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        apiPath: config.apiPath,
        headersJson: config.headers,
        input: `小说标题：${title.trim() || "未命名"}\n\n创作要求：\n${brief.trim()}\n\n${modeInstruction[mode]}`,
        systemPrompt:
          "你是专业中文小说作者和剧本开发编辑。内容必须原创、人物动机清楚、叙事连贯。不要输出对话式解释、免责声明或 Markdown 代码围栏。",
        onEvent,
      });
      await streamSettled;

      if (novelGenerationRequestRef.current !== requestId) {
        throw new Error("AI 创作已取消");
      }
      novelGenerationRequestRef.current = "";
      if (!content.trim()) throw new Error("模型没有返回小说内容");
      return content;
    } catch (error) {
      if (novelGenerationRequestRef.current === requestId) {
        novelGenerationRequestRef.current = "";
      }
      throw error;
    }
  };

  const cancelNovelGeneration = () => {
    const requestId = novelGenerationRequestRef.current;
    if (!requestId) return;
    novelGenerationRequestRef.current = "";
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<boolean>("cancel_chat_generation", { requestId }),
      )
      .catch(() => undefined);
  };

  const saveCreatedNovel = async (
    title: string,
    content: string,
    source: NovelCreationMode,
  ) => {
    if (!selectedProject) {
      throw new Error("当前任务尚未绑定项目文件夹");
    }
    if (!content.trim()) throw new Error("小说内容不能为空");

    const fileName = normalizeNovelFileName(title);
    const novelTitle = fileName.replace(/\.(txt|md|markdown)$/i, "");
    const conversationTitle = `创作《${novelTitle}》`;
    const savedPath = await persistProjectSource(
      selectedProject,
      fileName,
      content,
    );
    const existing = selectedProject.resources.find(
      (resource) =>
        resource.category === "原著" && resource.name === fileName,
    );
    const resource: ProjectResource = {
      id: existing?.id ?? createId(),
      name: fileName,
      category: "原著",
      kind: "text",
      size: textByteLength(content),
      path: savedPath,
      preview: content.slice(0, 12000),
      status: "ready",
      createdAt: existing?.createdAt ?? Date.now(),
    };

    updateProject(selectedProject.id, (project) => ({
      ...project,
      name: isManagedProject(project)
        ? conversationTitle
        : project.name,
      updatedAt: Date.now(),
      resources: [
        resource,
        ...project.resources.filter(
          (item) => item.id !== resource.id,
        ),
      ],
    }));
    if (selectedThread) {
      updateThread(selectedThread.id, (thread) => ({
        ...thread,
        title:
          thread.title === "新任务"
            ? conversationTitle
            : thread.title,
        updatedAt: Date.now(),
        messages: [
          ...thread.messages,
          createMessage(
            "system",
            `${source === "ai" ? "AI 小说草稿" : "空白小说"}「${fileName}」已保存为原著资源，共 ${content.length.toLocaleString()} 个字符。`,
          ),
        ],
      }));
    }
    setSelectedResourceId(resource.id);
    setRightTab("files");
    setRightOpen(true);
    setNovelCreationMode(null);
    setToast("小说已保存，可随时继续编辑");
  };

  const prepareTextArtifact = async (
    context: WritableContext,
    intent: TextArtifactIntent,
  ): Promise<ActiveTextArtifact> => {
    const existing =
      intent.operation === "continue"
        ? [...context.project.resources]
            .filter(
              (resource) => resource.category === intent.category,
            )
            .sort((left, right) => right.createdAt - left.createdAt)[0]
        : undefined;
    const fileName = existing
      ? existing.name
      : createAvailableFileName(
          intent.fileName,
          context.project.resources,
        );
    const resolvedIntent = {
      ...intent,
      fileName,
    };
    let baseContent = "";
    if (existing?.path) {
      const { invoke } = await import("@tauri-apps/api/core");
      baseContent = await invoke<string>("read_project_source", {
        path: existing.path,
        projectRoot: context.project.rootPath,
      });
    } else if (existing?.preview) {
      baseContent = existing.preview;
    }
    const savedPath = existing?.path
      ? existing.path
      : await persistProjectSource(
          context.project,
          resolvedIntent.fileName,
          baseContent,
        );
    const resource: ProjectResource = {
      id: existing?.id ?? createId(),
      name: resolvedIntent.fileName,
      category: resolvedIntent.category,
      kind: "text",
      size: textByteLength(baseContent),
      path: savedPath,
      preview: baseContent.slice(0, 12000),
      status: "generating",
      createdAt: existing?.createdAt ?? Date.now(),
    };
    updateProject(context.project.id, (project) => ({
      ...project,
      updatedAt: Date.now(),
      resources: [
        resource,
        ...project.resources.filter((item) => item.id !== resource.id),
      ],
    }));
    setSelectedResourceId(resource.id);
    setRightTab("files");
    setRightOpen(true);
    setToast(`已创建文件「${resource.name}」，正在写入`);
    return {
      context,
      intent: resolvedIntent,
      resource,
      baseContent,
      lastQueuedLength: 0,
      writeChain: Promise.resolve(resource),
    };
  };

  const queueTextArtifactWrite = (
    artifact: ActiveTextArtifact,
    content: string,
    status: ProjectResource["status"],
  ) => {
    artifact.lastQueuedLength = content.length;
    artifact.writeChain = artifact.writeChain
      .catch(() => artifact.resource)
      .then(async () => {
        const fileContent = artifact.baseContent
          ? `${artifact.baseContent.trimEnd()}\n\n${content.trimStart()}`
          : content;
        const savedPath = await persistProjectSource(
          artifact.context.project,
          artifact.intent.fileName,
          fileContent,
        );
        const resource: ProjectResource = {
          ...artifact.resource,
          size: textByteLength(fileContent),
          path: savedPath,
          preview: fileContent.slice(0, 12000),
          status,
        };
        artifact.resource = resource;
        updateProject(artifact.context.project.id, (project) => ({
          ...project,
          updatedAt: Date.now(),
          resources: [
            resource,
            ...project.resources.filter(
              (item) => item.id !== resource.id,
            ),
          ],
        }));
        return resource;
      });
    return artifact.writeChain;
  };

  const loadResourceContent = async (resource: ProjectResource) => {
    if (!resource.path) return resource.preview ?? "";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("read_project_source", {
      path: resource.path,
      projectRoot: selectedProject?.rootPath ?? null,
    });
  };

  const saveResourceContent = async (
    resource: ProjectResource,
    content: string,
  ) => {
    if (!selectedProject) {
      throw new Error("当前任务尚未绑定项目文件夹");
    }
    if (!content.trim()) throw new Error("原著内容不能为空");
    const savedPath = await persistProjectSource(
      selectedProject,
      resource.name,
      content,
    );
    updateProject(selectedProject.id, (project) => ({
      ...project,
      updatedAt: Date.now(),
      resources: project.resources.map((item) =>
        item.id === resource.id
          ? {
              ...item,
              path: savedPath,
              size: textByteLength(content),
              preview: content.slice(0, 12000),
              status: "ready",
            }
          : item,
      ),
    }));
    if (selectedThread) {
      updateThread(selectedThread.id, (thread) => ({
        ...thread,
        updatedAt: Date.now(),
        messages: [
          ...thread.messages,
          createMessage(
            "system",
            `已保存对原著「${resource.name}」的修改。后续章节与角色索引应以最新版本为准。`,
          ),
        ],
      }));
    }
    setToast("原著修改已保存");
  };

  const sendMessage = async () => {
    const input = composer.trim();
    if (!input || isResponding) return;

    const config = modelConfigs.chat;
    const artifactIntent = createTextArtifactIntent(
      input,
      selectedThread,
      selectedProject,
    );
    const requiredKinds = [
      ...(!isModelConfigured(config)
        ? (["chat"] as ModelKind[])
        : []),
      ...(artifactIntent
        ? []
        : requiredGenerationModels(input).filter(
            (kind) => !isModelConfigured(modelConfigs[kind]),
          )),
    ].filter(
      (kind, index, kinds) => kinds.indexOf(kind) === index,
    );
    const writableContext =
      artifactIntent && requiredKinds.length === 0
        ? await ensureWritableContext("创作小说并保存为原著文件")
        : null;
    if (artifactIntent && requiredKinds.length === 0 && !writableContext) {
      return;
    }
    const promptProject = writableContext?.project ?? selectedProject;
    const thread =
      writableContext?.thread ?? selectedThread ?? createThread();
    let activeArtifact: ActiveTextArtifact | undefined;
    if (artifactIntent && writableContext) {
      try {
        activeArtifact = await prepareTextArtifact(
          writableContext,
          artifactIntent,
        );
      } catch (error) {
        setToast(`无法创建小说文件，已停止生成：${String(error)}`);
        return;
      }
    }
    const userMessage = createMessage("user", input);
    const guideMessage =
      requiredKinds.length > 0
        ? createMessage(
            "assistant",
            `继续这个任务前，需要先配置${requiredKinds
              .map(modelKindName)
              .join("和")}。完成后回到当前对话重新发送即可，任务内容不会丢失。`,
            requiredKinds.map((kind) => ({
              type: "configure-model" as const,
              modelKind: kind,
              label: `配置${modelKindName(kind)}`,
            })),
          )
        : null;
    const threadId = thread.id;
    const messagesToAppend = [
      userMessage,
      ...(guideMessage ? [guideMessage] : []),
    ];
    const conversationTitle =
      thread.title === "新任务" ? input.slice(0, 24) : thread.title;
    setComposer("");
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === thread.projectId && isManagedProject(project)
          ? {
              ...project,
              name: conversationTitle,
              updatedAt: Date.now(),
            }
          : project,
      ),
      threads: current.threads.some((item) => item.id === threadId)
        ? current.threads.map((item) =>
            item.id === threadId
              ? {
                  ...item,
                  title:
                    item.title === "新任务"
                      ? conversationTitle
                      : item.title,
                  updatedAt: Date.now(),
                  messages: [
                    ...item.messages,
                    ...messagesToAppend,
                  ],
                }
              : item,
          )
        : [
            {
              ...thread,
              title: conversationTitle,
              updatedAt: Date.now(),
              messages: messagesToAppend,
            },
            ...current.threads,
          ],
    }));
    setSelectedThreadId(threadId);

    if (guideMessage) return;

    const requestId = createId();
    const messageId = createId();
    activeGenerationRef.current = {
      requestId,
      threadId,
      messageId,
      content: "",
      cancelled: false,
      artifact: activeArtifact,
    };
    setStreamingMessage({
      id: messageId,
      threadId,
      content: "",
    });
    setIsResponding(true);

    try {
      const { Channel, invoke } = await import(
        "@tauri-apps/api/core"
      );
      const onEvent = new Channel<ChatStreamEvent>();
      let settleStream: () => void = () => undefined;
      const streamSettled = new Promise<void>((resolve) => {
        settleStream = resolve;
      });
      onEvent.onmessage = (event) => {
        if (
          event.event === "finished" ||
          event.event === "cancelled"
        ) {
          settleStream();
        }
        const active = activeGenerationRef.current;
        if (
          !active ||
          active.requestId !== requestId ||
          active.cancelled
        ) {
          return;
        }
        if (event.event === "delta" && event.data) {
          active.content += event.data;
          setStreamingMessage({
            id: active.messageId,
            threadId: active.threadId,
            content: active.content,
          });
          if (
            active.artifact &&
            active.content.length - active.artifact.lastQueuedLength >=
              6000
          ) {
            void queueTextArtifactWrite(
              active.artifact,
              active.content,
              "generating",
            ).catch(() => undefined);
          }
        }
      };

      await invoke<void>("stream_chat_message", {
        requestId,
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        apiPath: config.apiPath,
        headersJson: config.headers,
        input: buildModelInput(
          input,
          selectedThread,
          promptProject,
          artifactIntent,
          activeArtifact?.baseContent,
        ),
        systemPrompt: buildAgentSystemPrompt(
          modelConfigs,
          promptProject,
          accessMode,
          activeArtifact?.intent ?? artifactIntent,
        ),
        onEvent,
      });

      await streamSettled;
      const completed = activeGenerationRef.current;
      if (!completed || completed.requestId !== requestId) return;
      if (completed.content.trim()) {
        let completionMessage: Message;
        let saveFailureMessage: Message | null = null;
        if (completed.artifact) {
          try {
            const resource = await queueTextArtifactWrite(
              completed.artifact,
              completed.content,
              "ready",
            );
            completionMessage = createMessage(
              "assistant",
              `小说已经生成并写入文件 **${resource.name}**。完整正文已保存到当前工程，右侧“原著”资源已同步。`,
              [
                {
                  type: "open-resource",
                  resourceId: resource.id,
                  label: "查看小说文件",
                },
              ],
            );
            setSelectedResourceId(resource.id);
            setRightTab("files");
            setRightOpen(true);
            setToast(`已保存「${resource.name}」并同步到资源栏`);
          } catch (saveError) {
            completionMessage = createMessage(
              "assistant",
              completed.content,
            );
            saveFailureMessage = createMessage(
              "system",
              `小说内容已生成，但文件写入失败：${String(saveError)}`,
            );
            updateProject(
              completed.artifact.context.project.id,
              (project) => ({
                ...project,
                resources: project.resources.map((resource) =>
                  resource.id === completed.artifact?.resource.id
                    ? { ...resource, status: "error" }
                    : resource,
                ),
              }),
            );
          }
        } else {
          completionMessage = createMessage(
            "assistant",
            completed.content,
          );
        }
        updateThread(threadId, (item) => ({
          ...item,
          updatedAt: Date.now(),
          messages: [
            ...item.messages,
            completionMessage,
            ...(saveFailureMessage ? [saveFailureMessage] : []),
          ],
        }));
      }
      activeGenerationRef.current = null;
      setStreamingMessage(null);
      setIsResponding(false);
    } catch (error) {
      const failed = activeGenerationRef.current;
      if (!failed || failed.requestId !== requestId) return;
      activeGenerationRef.current = null;
      setStreamingMessage(null);
      setIsResponding(false);
      const failureMessages: Message[] = [];
      if (failed.artifact && failed.content.trim()) {
        try {
          const resource = await queueTextArtifactWrite(
            failed.artifact,
            failed.content,
            "error",
          );
          failureMessages.push(
            createMessage(
              "assistant",
              `生成意外中断，已将现有内容保存为 **${resource.name}**，可以从右侧资源继续编辑。`,
              [
                {
                  type: "open-resource",
                  resourceId: resource.id,
                  label: "查看已保存草稿",
                },
              ],
            ),
          );
        } catch {
          failureMessages.push(
            {
              ...createMessage("assistant", failed.content),
              status: "stopped",
            },
          );
        }
      } else if (failed.artifact) {
        updateProject(failed.artifact.context.project.id, (project) => ({
          ...project,
          resources: project.resources.map((resource) =>
            resource.id === failed.artifact?.resource.id
              ? { ...resource, status: "error" }
              : resource,
          ),
        }));
      }
      failureMessages.push(
        createMessage("system", `模型请求失败：${String(error)}`),
      );
      updateThread(threadId, (item) => ({
        ...item,
        messages: [
          ...item.messages,
          ...failureMessages,
        ],
      }));
    }
  };

  const stopGeneration = () => {
    const active = activeGenerationRef.current;
    if (!active) {
      setIsResponding(false);
      setStreamingMessage(null);
      return;
    }

    active.cancelled = true;
    activeGenerationRef.current = null;
    setStreamingMessage(null);
    setIsResponding(false);

    void (async () => {
      let stoppedMessage: Message;
      if (active.artifact) {
        try {
          const resource = await queueTextArtifactWrite(
            active.artifact,
            active.content,
            "stopped",
          );
          stoppedMessage = {
            ...createMessage(
              "assistant",
              active.content.trim()
                ? `已停止继续生成，当前内容已保存为草稿 **${resource.name}**，可以从右侧资源继续编辑。`
                : `已停止生成，已保留空白草稿 **${resource.name}**。`,
              [
                {
                  type: "open-resource",
                  resourceId: resource.id,
                  label: "查看草稿文件",
                },
              ],
            ),
            status: "stopped",
          };
          setSelectedResourceId(resource.id);
          setRightTab("files");
          setRightOpen(true);
          setToast("已停止生成，现有小说内容已保存为草稿");
        } catch {
          stoppedMessage = {
            ...createMessage("assistant", active.content),
            status: "stopped",
          };
        }
      } else if (active.content.trim()) {
        stoppedMessage = {
          ...createMessage("assistant", active.content),
          status: "stopped",
        };
      } else {
        stoppedMessage = createMessage("system", "已停止生成");
      }

      updateThread(active.threadId, (thread) => ({
        ...thread,
        updatedAt: Date.now(),
        messages: [...thread.messages, stoppedMessage],
      }));
    })();

    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<boolean>("cancel_chat_generation", {
          requestId: active.requestId,
        }),
      )
      .catch(() => undefined);
  };

  useEffect(() => {
    if (isResponding || !pendingGuidanceRef.current) return;
    pendingGuidanceRef.current = false;
    void sendMessage();
  }, [isResponding]);

  const interruptAndSendGuidance = () => {
    if (!composer.trim()) {
      stopGeneration();
      return;
    }
    pendingGuidanceRef.current = true;
    stopGeneration();
  };

  const updateModelConfig = <K extends keyof ModelConfig>(
    kind: ModelKind,
    key: K,
    value: ModelConfig[K],
  ) => {
    setModelConfigs((current) => ({
      ...current,
      [kind]: { ...current[kind], [key]: value },
    }));
    if (
      ["provider", "baseUrl", "apiKey", "headers"].includes(
        String(key),
      )
    ) {
      setModelCatalogs((current) => ({
        ...current,
        [kind]: {
          provider:
            key === "provider"
              ? String(value)
              : modelConfigs[kind].provider,
          loading: false,
          models: [],
          error: "",
        },
      }));
    }
    setTestState({ loading: false });
  };

  const testModelConnection = async () => {
    const config = modelConfigs[activeModelKind];
    if (!config.baseUrl.trim()) {
      setTestState({
        loading: false,
        kind: "error",
        text: "请填写服务地址",
      });
      return;
    }

    setTestState({ loading: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("test_model_endpoint", {
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        headersJson: config.headers,
      });
      setTestState({
        loading: false,
        kind: "success",
        text: result,
      });
    } catch (error) {
      setTestState({
        loading: false,
        kind: "error",
        text: String(error),
      });
    }
  };

  const fetchProviderModels = async (kind: ModelKind) => {
    const config = modelConfigs[kind];
    if (!config.baseUrl.trim()) {
      setModelCatalogs((current) => ({
        ...current,
        [kind]: {
          provider: config.provider,
          loading: false,
          models: [],
          error: "请先选择供应商或填写 Base URL",
        },
      }));
      return;
    }
    if (
      !config.apiKey.trim() &&
      !config.provider.includes("自定义")
    ) {
      setModelCatalogs((current) => ({
        ...current,
        [kind]: {
          provider: config.provider,
          loading: false,
          models: [],
          error: "请先填写 API Key",
        },
      }));
      return;
    }

    setModelCatalogs((current) => ({
      ...current,
      [kind]: {
        provider: config.provider,
        loading: true,
        models: [],
        error: "",
      },
    }));

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const models = await invoke<string[]>("list_provider_models", {
        provider: config.provider,
        modelKind: kind,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        headersJson: config.headers,
      });
      setModelCatalogs((current) => ({
        ...current,
        [kind]: {
          provider: config.provider,
          loading: false,
          models,
          error: "",
        },
      }));
    } catch (error) {
      setModelCatalogs((current) => ({
        ...current,
        [kind]: {
          provider: config.provider,
          loading: false,
          models: [],
          error: String(error),
        },
      }));
    }
  };

  const handleWindowAction = async (
    action: "minimize" | "maximize" | "close",
  ) => {
    try {
      const { getCurrentWindow } = await import(
        "@tauri-apps/api/window"
      );
      const appWindow = getCurrentWindow();
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") await appWindow.toggleMaximize();
      if (action === "close") await appWindow.close();
    } catch (error) {
      setToast(`窗口操作失败：${String(error)}`);
    }
  };

  const handleWindowDrag = async (
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    try {
      const { getCurrentWindow } = await import(
        "@tauri-apps/api/window"
      );
      await getCurrentWindow().startDragging();
    } catch (error) {
      setToast(`窗口拖动失败：${String(error)}`);
    }
  };

  return (
    <div className="app-shell">
      <header
        className="window-bar"
        onMouseDown={(event) => void handleWindowDrag(event)}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) {
            void handleWindowAction("maximize");
          }
        }}
      >
        <div className="window-menu">
          <button className="icon-button window-menu-button" aria-label="应用菜单">
            <Menu size={15} />
          </button>
          <span>文件</span>
          <span>编辑</span>
          <span>视图</span>
          <span>帮助</span>
        </div>
        <div className="window-actions">
          <button
            onClick={() => void handleWindowAction("minimize")}
            aria-label="最小化"
          >
            <Minus size={15} />
          </button>
          <button
            onClick={() => void handleWindowAction("maximize")}
            aria-label="最大化"
          >
            <Square size={11} />
          </button>
          <button
            className="close-window"
            onClick={() => void handleWindowAction("close")}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div
        className={`workspace ${
          rightOpen ? "right-open" : "right-closed"
        } ${rightResizing ? "right-resizing" : ""} ${
          leftResizing ? "left-resizing" : ""
        }`}
        style={
          {
            "--left-panel-width": `${leftWidth}px`,
            "--right-panel-width": `${rightWidth}px`,
          } as CSSProperties
        }
      >
        <LeftSidebar
          projects={workspace.projects}
          threads={workspace.threads}
          selectedThreadId={selectedThreadId}
          settingsActive={settingsDialogOpen}
          onNewThread={createNewThread}
          onSearch={() => setSearchDialogOpen(true)}
          onOpenSettings={() => setSettingsDialogOpen(true)}
          width={leftWidth}
          onResizeStart={startLeftResize}
          onResetWidth={() =>
            setLeftWidth(
              clampLeftWidth(
                defaultLeftPanelWidth,
                rightOpen ? rightWidth : 0,
              ),
            )
          }
          onAdjustWidth={(delta) =>
            setLeftWidth((current) =>
              clampLeftWidth(
                current + delta,
                rightOpen ? rightWidth : 0,
              ),
            )
          }
          onToggleThreadPinned={toggleThreadPinned}
          onSelectThread={(threadId) => {
            setSelectedThreadId(threadId);
            setSelectedResourceId("");
          }}
        />

        <main className="center-pane">
          <ChatView
            project={selectedProject}
            thread={selectedThread}
            modelProvider={modelConfigs.chat.provider}
            modelName={modelConfigs.chat.model || "选择模型"}
            modelOptions={
              modelCatalogs.chat.provider ===
              modelConfigs.chat.provider
                ? modelCatalogs.chat.models
                : []
            }
            composer={composer}
            accessMode={accessMode}
            isResponding={isResponding}
            streamingMessage={streamingMessage}
            rightOpen={rightOpen}
            composerRef={composerRef}
            onComposerChange={setComposer}
            onSend={() => void sendMessage()}
            onStop={stopGeneration}
            onInterruptAndSend={interruptAndSendGuidance}
            onChooseFolder={() => void chooseProjectFolder()}
            onOpenProjectFolder={() =>
              void openCurrentProjectFolder()
            }
            onCopyProjectPath={() => void copyCurrentProjectPath()}
            onAccessModeChange={(mode) => {
              setAccessMode(mode);
              setToast(`权限已切换为“${accessModeLabel(mode)}”`);
            }}
            onImport={() => fileInputRef.current?.click()}
            onCreateAiNovel={() => void openNovelCreator("ai")}
            onCreateBlankNovel={() => void openNovelCreator("blank")}
            onOpenSettings={() => {
              setActiveModelKind("chat");
              setSettingsDialogOpen(true);
            }}
            onSelectModel={(model) => {
              updateModelConfig("chat", "model", model);
              setToast(`已切换至 ${model}`);
            }}
            onConfigureModel={(kind) => {
              setActiveModelKind(kind);
              setSettingsDialogOpen(true);
            }}
            onOpenResource={(resourceId) => {
              setSelectedResourceId(resourceId);
              setRightTab("files");
              setRightOpen(true);
              setResourcePreviewOpen(true);
            }}
            onToggleRight={() => setRightOpen((open) => !open)}
          />
        </main>

        <RightSidebar
          project={selectedProject}
          thread={selectedThread}
          activeTab={rightTab}
          selectedResourceId={selectedResourceId}
          isOpen={rightOpen}
          width={rightWidth}
          onTabChange={setRightTab}
          onSelectResource={(resourceId) => {
            setSelectedResourceId(resourceId);
            setResourcePreviewOpen(true);
          }}
          onResizeStart={startRightResize}
          onResetWidth={() => setRightWidth(380)}
        />
      </div>

      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        onChange={(event) => {
          void handleNovelImport(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {searchDialogOpen && (
        <WorkspaceSearchDialog
          projects={workspace.projects}
          threads={workspace.threads}
          onClose={() => setSearchDialogOpen(false)}
          onSelectProject={(projectId) => {
            const thread = workspace.threads.find(
              (item) => item.projectId === projectId,
            );
            if (thread) setSelectedThreadId(thread.id);
          }}
          onSelectThread={(threadId) => {
            setSelectedThreadId(threadId);
            setSelectedResourceId("");
          }}
          onSelectResource={(projectId, resourceId) => {
            const thread = workspace.threads.find(
              (item) => item.projectId === projectId,
            );
            if (thread) setSelectedThreadId(thread.id);
            setSelectedResourceId(resourceId);
            setRightTab("files");
            setRightOpen(true);
            setResourcePreviewOpen(true);
          }}
        />
      )}

      {settingsDialogOpen && (
        <SettingsDialog
          configs={modelConfigs}
          modelCatalogs={modelCatalogs}
          activeKind={activeModelKind}
          testState={testState}
          projectCount={workspace.projects.length}
          threadCount={workspace.threads.length}
          onClose={() => setSettingsDialogOpen(false)}
          onChangeKind={setActiveModelKind}
          onChange={updateModelConfig}
          onTest={() => void testModelConnection()}
          onFetchModels={(kind) => void fetchProviderModels(kind)}
          onSaved={() => setToast("模型设置已保存在本机")}
        />
      )}

      {novelCreationMode && selectedProject && (
        <NovelCreatorDialog
          mode={novelCreationMode}
          projectName={selectedProject.name}
          onClose={() => {
            cancelNovelGeneration();
            setNovelCreationMode(null);
          }}
          onGenerate={generateNovelDraft}
          onCancelGeneration={cancelNovelGeneration}
          onSave={saveCreatedNovel}
        />
      )}

      {resourcePreviewOpen && selectedResource && (
        <ResourcePreview
          resource={selectedResource}
          onClose={() => setResourcePreviewOpen(false)}
          onLoad={loadResourceContent}
          onSave={saveResourceContent}
        />
      )}

      {managedOutputApproval && (
        <ManagedOutputApprovalDialog
          action={managedOutputApproval.action}
          onCancel={() => finishManagedOutputApproval(false)}
          onApprove={() => finishManagedOutputApproval(true)}
        />
      )}

      {toast && <StatusToast key={toast} message={toast} />}
    </div>
  );
}

function LeftSidebar({
  projects,
  threads,
  selectedThreadId,
  settingsActive,
  width,
  onNewThread,
  onSearch,
  onOpenSettings,
  onResizeStart,
  onResetWidth,
  onAdjustWidth,
  onToggleThreadPinned,
  onSelectThread,
}: {
  projects: Project[];
  threads: Thread[];
  selectedThreadId: string;
  settingsActive: boolean;
  width: number;
  onNewThread: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
  onAdjustWidth: (delta: number) => void;
  onToggleThreadPinned: (threadId: string) => void;
  onSelectThread: (threadId: string) => void;
}) {
  const [preferences, setPreferences] =
    useStoredState<SidebarPreferences>(
      "manju-agent-sidebar-preferences-v1",
      defaultSidebarPreferences,
    );
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [threadMenu, setThreadMenu] = useState<{
    threadId: string;
    left: number;
    top: number;
  } | null>(null);
  const brandButtonRef = useRef<HTMLButtonElement>(null);
  const brandMenuRef = useRef<HTMLDivElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const selectedThread = threads.find(
    (thread) => thread.id === selectedThreadId,
  );
  const pinnedThreads = threads
    .filter((thread) => thread.pinnedAt !== null)
    .sort(
      (left, right) =>
        (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0),
    );
  const recentThreads = threads
    .filter(
      (thread) =>
        !thread.projectId && thread.pinnedAt === null,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const sortedProjects = [...projects].sort((left, right) => {
    const activity = (projectId: string) =>
      threads
        .filter((thread) => thread.projectId === projectId)
        .reduce(
          (latest, thread) => Math.max(latest, thread.updatedAt),
          0,
        );
    return activity(right.id) - activity(left.id);
  });

  const isSectionCollapsed = (section: SidebarSectionKey) =>
    preferences.collapsedSections.includes(section);

  const toggleSection = (section: SidebarSectionKey) => {
    setPreferences((current) => ({
      ...current,
      collapsedSections: current.collapsedSections.includes(section)
        ? current.collapsedSections.filter((item) => item !== section)
        : [...current.collapsedSections, section],
    }));
  };

  const toggleProject = (projectId: string) => {
    setPreferences((current) => ({
      ...current,
      collapsedProjectIds: current.collapsedProjectIds.includes(
        projectId,
      )
        ? current.collapsedProjectIds.filter(
            (item) => item !== projectId,
          )
        : [...current.collapsedProjectIds, projectId],
    }));
  };

  useEffect(() => {
    const projectId = selectedThread?.projectId;
    if (
      projectId &&
      preferences.collapsedProjectIds.includes(projectId)
    ) {
      setPreferences((current) => ({
        ...current,
        collapsedProjectIds: current.collapsedProjectIds.filter(
          (item) => item !== projectId,
        ),
      }));
    }
  }, [
    preferences.collapsedProjectIds,
    selectedThread?.projectId,
    setPreferences,
  ]);

  useEffect(() => {
    if (!brandMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          "[data-sidebar-brand-menu]",
        )
      ) {
        setBrandMenuOpen(false);
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBrandMenuOpen(false);
        brandButtonRef.current?.focus();
      }
    };
    const frame = window.requestAnimationFrame(() => {
      brandMenuRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [brandMenuOpen]);

  useEffect(() => {
    if (!threadMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          "[data-sidebar-thread-menu]",
        )
      ) {
        setThreadMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [threadMenu]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          "[data-workspace-menu]",
        )
      ) {
        setWorkspaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceMenuOpen(false);
        workspaceButtonRef.current?.focus();
      }
    };
    const frame = window.requestAnimationFrame(() => {
      workspaceMenuRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  const openThreadMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    threadId: string,
  ) => {
    event.stopPropagation();
    setWorkspaceMenuOpen(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 178;
    const menuHeight = 52;
    setThreadMenu({
      threadId,
      left: Math.max(
        8,
        Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth),
      ),
      top:
        rect.bottom + menuHeight + 8 > window.innerHeight
          ? rect.top - menuHeight - 4
          : rect.bottom + 4,
    });
  };

  const renderThreadRow = (
    thread: Thread,
    className = "",
    showPinIndicator = true,
  ) => (
    <div className={`thread-entry ${className}`} key={thread.id}>
      <button
        className={`thread-row ${
          thread.id === selectedThreadId ? "selected" : ""
        }`}
        onClick={() => onSelectThread(thread.id)}
        title={thread.title}
      >
        <span>{thread.title}</span>
        {showPinIndicator && thread.pinnedAt !== null && (
          <Pin className="thread-pin-indicator" size={12} />
        )}
      </button>
      <button
        className="thread-row-action"
        data-sidebar-thread-menu
        onClick={(event) => openThreadMenu(event, thread.id)}
        aria-label={`${thread.title} 的更多操作`}
        title="更多操作"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );

  return (
    <aside className="left-sidebar">
      <div className="brand-row">
        <button
          ref={brandButtonRef}
          className={`brand-button ${
            brandMenuOpen ? "active" : ""
          }`}
          data-sidebar-brand-menu
          aria-label="选择 Agent"
          aria-haspopup="menu"
          aria-expanded={brandMenuOpen}
          aria-controls="brand-agent-menu"
          onClick={() => setBrandMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setBrandMenuOpen(true);
            }
          }}
        >
          <span>漫剧 Agent</span>
          <ChevronDown
            size={14}
            className={brandMenuOpen ? "open" : ""}
          />
        </button>
        <button
          className="sidebar-search-button"
          onClick={onSearch}
          aria-label="搜索"
          title="搜索（Ctrl K）"
        >
          <Search size={16} />
        </button>

        <div
          id="brand-agent-menu"
          ref={brandMenuRef}
          className={`brand-agent-menu ${
            brandMenuOpen ? "open" : ""
          }`}
          data-sidebar-brand-menu
          role="menu"
          aria-label="Agent 列表"
          aria-hidden={!brandMenuOpen}
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button",
              ),
            );
            const currentIndex = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "ArrowDown") {
              event.preventDefault();
              items[(currentIndex + 1 + items.length) % items.length]
                ?.focus();
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              items[
                (currentIndex - 1 + items.length) % items.length
              ]?.focus();
            }
            if (event.key === "Home") {
              event.preventDefault();
              items[0]?.focus();
            }
            if (event.key === "End") {
              event.preventDefault();
              items.at(-1)?.focus();
            }
            if (event.key === "Tab") {
              setBrandMenuOpen(false);
            }
          }}
        >
          <div className="agent-menu-heading">选择 Agent</div>
          <button
            className="agent-menu-item current"
            role="menuitemradio"
            aria-checked="true"
            tabIndex={brandMenuOpen ? 0 : -1}
            onClick={() => setBrandMenuOpen(false)}
          >
            <span className="agent-menu-icon">
              <Clapperboard size={16} />
            </span>
            <span className="agent-menu-copy">
              <strong>漫剧 Agent</strong>
              <small>小说拆解、分镜、漫画与漫剧生成</small>
            </span>
            <Check size={16} />
          </button>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主要功能">
        <button className="nav-row nav-primary" onClick={onNewThread}>
          <SquarePen size={16} />
          <span>新建任务</span>
        </button>
        <button className="nav-row" onClick={onSearch}>
          <Search size={16} />
          <span>搜索任务</span>
          <kbd className="nav-shortcut">Ctrl K</kbd>
        </button>
      </nav>

      <div className="project-list">
        {pinnedThreads.length > 0 && (
          <section className="sidebar-section">
            <button
              className="sidebar-section-header"
              onClick={() => toggleSection("pinned")}
            >
              <span>置顶</span>
              <ChevronRight
                size={13}
                className={
                  isSectionCollapsed("pinned") ? "" : "open"
                }
              />
            </button>
            <div
              className={`sidebar-section-content ${
                isSectionCollapsed("pinned") ? "collapsed" : ""
              }`}
              aria-hidden={isSectionCollapsed("pinned")}
              inert={isSectionCollapsed("pinned")}
            >
              <AnimatedList className="pinned-thread-list">
                {pinnedThreads.map((thread) =>
                  renderThreadRow(thread, "pinned-thread", false),
                )}
              </AnimatedList>
            </div>
          </section>
        )}

        {sortedProjects.length > 0 && (
          <section className="sidebar-section">
            <button
              className="sidebar-section-header"
              onClick={() => toggleSection("projects")}
            >
              <span>项目</span>
              <ChevronRight
                size={13}
                className={
                  isSectionCollapsed("projects") ? "" : "open"
                }
              />
            </button>
            <div
              className={`sidebar-section-content ${
                isSectionCollapsed("projects") ? "collapsed" : ""
              }`}
              aria-hidden={isSectionCollapsed("projects")}
              inert={isSectionCollapsed("projects")}
            >
              <AnimatedList className="project-list-entries">
                {sortedProjects.map((project) => {
                  const projectThreads = threads
                    .filter(
                      (thread) => thread.projectId === project.id,
                    )
                    .sort(
                      (left, right) =>
                        right.updatedAt - left.updatedAt,
                    );
                  const projectTitle =
                    isManagedProject(project) && projectThreads[0]
                      ? projectThreads[0].title
                      : project.name;
                  const selected =
                    selectedThread?.projectId === project.id;
                  const collapsed =
                    preferences.collapsedProjectIds.includes(
                      project.id,
                    );
                  return (
                    <div className="project-block" key={project.id}>
                      <button
                        className={`project-row ${
                          selected ? "current" : ""
                        }`}
                        onClick={() => toggleProject(project.id)}
                      >
                        <Folder size={15} />
                        <span title={project.rootPath}>{projectTitle}</span>
                        <ChevronRight
                          size={13}
                          className={collapsed ? "" : "open"}
                        />
                      </button>
                      <div
                        className={`project-thread-content ${
                          collapsed ? "collapsed" : ""
                        }`}
                        aria-hidden={collapsed}
                        inert={collapsed}
                      >
                        {projectThreads.length > 0 && (
                          <AnimatedList className="thread-list">
                            {projectThreads.map((thread) =>
                              renderThreadRow(thread),
                            )}
                          </AnimatedList>
                        )}
                      </div>
                    </div>
                  );
                })}
              </AnimatedList>
            </div>
          </section>
        )}

        {recentThreads.length > 0 && (
          <section className="sidebar-section">
            <button
              className="sidebar-section-header"
              onClick={() => toggleSection("recent")}
            >
              <span>最近</span>
              <ChevronRight
                size={13}
                className={
                  isSectionCollapsed("recent") ? "" : "open"
                }
              />
            </button>
            <div
              className={`sidebar-section-content ${
                isSectionCollapsed("recent") ? "collapsed" : ""
              }`}
              aria-hidden={isSectionCollapsed("recent")}
              inert={isSectionCollapsed("recent")}
            >
              <AnimatedList className="recent-thread-list">
                {recentThreads.map((thread) =>
                  renderThreadRow(thread, "recent-thread"),
                )}
              </AnimatedList>
            </div>
          </section>
        )}
      </div>

      <button
        ref={workspaceButtonRef}
        className={`workspace-profile ${
          settingsActive || workspaceMenuOpen ? "active" : ""
        }`}
        data-workspace-menu
        aria-label="本地工作区菜单"
        aria-haspopup="menu"
        aria-expanded={workspaceMenuOpen}
        aria-controls="workspace-profile-menu"
        onClick={() => {
          setBrandMenuOpen(false);
          setThreadMenu(null);
          setWorkspaceMenuOpen((open) => !open);
        }}
      >
        <span className="profile-avatar">M</span>
        <strong>本地工作区</strong>
        <MoreHorizontal size={17} />
      </button>

      <div
        id="workspace-profile-menu"
        ref={workspaceMenuRef}
        className={`workspace-profile-menu ui-popover ${
          workspaceMenuOpen ? "open" : ""
        }`}
        data-workspace-menu
        role="menu"
        aria-label="本地工作区"
        aria-hidden={!workspaceMenuOpen}
        inert={!workspaceMenuOpen}
      >
        <header>
          <span className="profile-avatar">M</span>
          <span>
            <strong>本地工作区</strong>
            <small>数据与配置保存在当前设备</small>
          </span>
        </header>
        <div className="workspace-profile-menu-divider" />
        <button
          type="button"
          role="menuitem"
          tabIndex={workspaceMenuOpen ? 0 : -1}
          onClick={() => {
            setWorkspaceMenuOpen(false);
            onOpenSettings();
          }}
        >
          <Settings size={17} />
          <span>
            <strong>设置</strong>
            <small>模型服务与客户端偏好</small>
          </span>
          <ChevronRight size={14} />
        </button>
      </div>

      <div
        className="left-resize-handle"
        role="separator"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={minLeftPanelWidth}
        aria-valuemax={maxLeftPanelWidth}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onAdjustWidth(event.shiftKey ? -24 : -8);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onAdjustWidth(event.shiftKey ? 24 : 8);
          }
          if (event.key === "Home") {
            event.preventDefault();
            onAdjustWidth(minLeftPanelWidth - width);
          }
          if (event.key === "End") {
            event.preventDefault();
            onAdjustWidth(maxLeftPanelWidth - width);
          }
        }}
      >
        <span className="resize-tooltip left-tooltip">
          拖动调整宽度 · 双击恢复默认
        </span>
      </div>

      {threadMenu && (
        <div
          className="sidebar-context-menu ui-popover"
          data-sidebar-thread-menu
          style={{
            left: threadMenu.left,
            top: threadMenu.top,
          }}
          role="menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              onToggleThreadPinned(threadMenu.threadId);
              setThreadMenu(null);
            }}
          >
            {threads.find(
              (thread) => thread.id === threadMenu.threadId,
            )?.pinnedAt !== null ? (
              <PinOff size={15} />
            ) : (
              <Pin size={15} />
            )}
            <span>
              {threads.find(
                (thread) => thread.id === threadMenu.threadId,
              )?.pinnedAt !== null
                ? "取消置顶"
                : "置顶任务"}
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ChatView({
  project,
  thread,
  modelProvider,
  modelName,
  modelOptions,
  composer,
  accessMode,
  isResponding,
  streamingMessage,
  rightOpen,
  composerRef,
  onComposerChange,
  onSend,
  onStop,
  onInterruptAndSend,
  onChooseFolder,
  onOpenProjectFolder,
  onCopyProjectPath,
  onAccessModeChange,
  onImport,
  onCreateAiNovel,
  onCreateBlankNovel,
  onOpenSettings,
  onSelectModel,
  onConfigureModel,
  onOpenResource,
  onToggleRight,
}: {
  project: Project | null;
  thread: Thread | null;
  modelProvider: string;
  modelName: string;
  modelOptions: string[];
  composer: string;
  accessMode: AccessMode;
  isResponding: boolean;
  streamingMessage: StreamingMessage | null;
  rightOpen: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onInterruptAndSend: () => void;
  onChooseFolder: () => void;
  onOpenProjectFolder: () => void;
  onCopyProjectPath: () => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onImport: () => void;
  onCreateAiNovel: () => void;
  onCreateBlankNovel: () => void;
  onOpenSettings: () => void;
  onSelectModel: (model: string) => void;
  onConfigureModel: (kind: ModelKind) => void;
  onOpenResource: (resourceId: string) => void;
  onToggleRight: () => void;
}) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const previousThreadIdRef = useRef(thread?.id ?? "");
  const previousRespondingRef = useRef(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [followingOutput, setFollowingOutput] = useState(true);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const activeStreamingMessage =
    streamingMessage?.threadId === thread?.id
      ? streamingMessage
      : null;

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!sourceMenuRef.current?.contains(event.target as Node)) {
        setSourceMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSourceMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sourceMenuOpen]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectMenuOpen]);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const container = chatScrollRef.current;
    if (!container) return;
    followOutputRef.current = true;
    setFollowingOutput(true);
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    const threadChanged =
      previousThreadIdRef.current !== (thread?.id ?? "");
    const generationStarted =
      isResponding && !previousRespondingRef.current;
    previousThreadIdRef.current = thread?.id ?? "";
    previousRespondingRef.current = isResponding;

    if (threadChanged || generationStarted) {
      followOutputRef.current = true;
      setFollowingOutput(true);
    }
    if (!followOutputRef.current) return;

    const frame = window.requestAnimationFrame(() =>
      scrollToBottom("auto"),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeStreamingMessage?.content,
    isResponding,
    thread?.id,
    thread?.messages.length,
  ]);

  return (
    <section className="chat-view">
      <header className="center-header">
        <div className="center-title">
          <strong>{thread?.title ?? "新任务"}</strong>
          <span>{project?.name ?? "未绑定项目文件夹"}</span>
        </div>
        <button
          className="icon-button"
          onClick={onToggleRight}
          aria-label={rightOpen ? "收起资源栏" : "展开资源栏"}
        >
          {rightOpen ? (
            <PanelRightClose size={18} />
          ) : (
            <PanelRightOpen size={18} />
          )}
        </button>
      </header>

      <div
        ref={chatScrollRef}
        className="chat-scroll"
        onScroll={(event) => {
          const container = event.currentTarget;
          const distance =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;
          const nearBottom = distance < 72;
          followOutputRef.current = nearBottom;
          setFollowingOutput(nearBottom);
        }}
      >
        {(!thread || thread.messages.length === 0) &&
        !activeStreamingMessage ? (
          <EmptyTask
            project={project}
            accessMode={accessMode}
          />
        ) : (
          <div className="message-column">
            {thread?.messages.map((message) => (
              <div
                key={message.id}
                className={`message message-${message.role}`}
              >
                {message.role !== "user" && (
                  <span className="message-avatar">
                    {message.role === "assistant" ? (
                      <Clapperboard size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                  </span>
                )}
                {message.role === "user" ? (
                  <div className="message-content">
                    {message.content}
                  </div>
                ) : (
                  <div
                    className={`message-body ${
                      message.actions &&
                      message.actions.length > 0
                        ? "message-action-card"
                        : ""
                    }`}
                  >
                    <div className="message-content">
                      <MarkdownMessage content={message.content} />
                    </div>
                    {message.actions &&
                      message.actions.length > 0 && (
                        <div className="message-quick-actions">
                          {message.actions.map((action) => (
                            <button
                              key={`${message.id}-${
                                action.type === "configure-model"
                                  ? action.modelKind
                                  : action.resourceId
                              }`}
                              type="button"
                              onClick={() => {
                                if (action.type === "configure-model") {
                                  onConfigureModel(action.modelKind);
                                } else {
                                  onOpenResource(action.resourceId);
                                }
                              }}
                            >
                              {action.type === "open-resource" ? (
                                <FileText size={15} />
                              ) : action.modelKind === "image" ? (
                                <ImageIcon size={15} />
                              ) : action.modelKind === "video" ? (
                                <Video size={15} />
                              ) : (
                                <MessageSquareText size={15} />
                              )}
                              <span>{action.label}</span>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                    {message.status === "stopped" && (
                      <div className="message-generation-status">
                        已停止生成
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {activeStreamingMessage && (
              <div className="message message-assistant message-streaming">
                <span className="message-avatar">
                  <Clapperboard size={14} />
                </span>
                {activeStreamingMessage.content ? (
                  <div className="message-body">
                    <div className="message-content">
                      <MarkdownMessage
                        content={activeStreamingMessage.content}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="typing">
                    <ShinyStatus>Agent 正在生成</ShinyStatus>
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!followingOutput &&
        Boolean(
          thread?.messages.length || activeStreamingMessage,
        ) && (
          <button
            type="button"
            className="chat-scroll-to-bottom"
            aria-label="回到最新消息"
            onClick={() => scrollToBottom("smooth")}
          >
            <ArrowDown size={16} />
          </button>
        )}

      <footer className="composer-area">
        <div className="composer-stack">
          <div
            ref={projectMenuRef}
            className={`project-context-picker ${
              projectMenuOpen ? "open" : ""
            }`}
          >
            <div className="project-context-line">
              <div className="project-context-title">
                {project ? (
                  <FolderOpen size={14} />
                ) : (
                  <Folder size={14} />
                )}
                <span>
                  {project
                    ? thread?.title ?? project.name
                    : "未绑定项目文件夹"}
                </span>
              </div>
              <button
                type="button"
                className="project-context-more"
                onClick={() =>
                  setProjectMenuOpen((current) => !current)
                }
                aria-label="项目目录选项"
                aria-haspopup="menu"
                aria-expanded={projectMenuOpen}
                aria-controls="project-context-menu"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>

            {project ? (
              <div
                id="project-context-menu"
                className="project-context-menu ui-popover"
                role="menu"
                aria-label="项目目录"
                aria-hidden={!projectMenuOpen}
              >
                <header>
                  <span className="project-context-menu-icon">
                    {isManagedProject(project) ? (
                      <Save size={17} />
                    ) : (
                      <FolderOpen size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{thread?.title ?? project.name}</strong>
                    <span>
                      {isManagedProject(project)
                        ? "应用托管输出目录"
                        : "本地项目目录"}
                    </span>
                  </div>
                </header>
                <div className="project-context-path">
                  <span>存储位置</span>
                  <code title={project.rootPath}>{project.rootPath}</code>
                  <button
                    type="button"
                    tabIndex={projectMenuOpen ? 0 : -1}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onCopyProjectPath();
                    }}
                    aria-label="复制项目路径"
                    title="复制路径"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <div className="project-context-actions">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={projectMenuOpen ? 0 : -1}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onOpenProjectFolder();
                    }}
                  >
                    <FolderOpen size={16} />
                    <span>
                      <strong>在文件资源管理器中打开</strong>
                      <small>查看该任务生成的全部工程文件</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={projectMenuOpen ? 0 : -1}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onChooseFolder();
                    }}
                  >
                    <Folder size={16} />
                    <span>
                      <strong>更换项目文件夹</strong>
                      <small>把当前对话切换到另一个本地工程</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                id="project-context-menu"
                className="project-context-menu ui-popover"
                role="menu"
                aria-label="项目目录"
                aria-hidden={!projectMenuOpen}
              >
                <header>
                  <span className="project-context-menu-icon">
                    <Folder size={17} />
                  </span>
                  <div>
                    <strong>尚未绑定项目目录</strong>
                    <span>绑定后，文件会直接写入所选工程</span>
                  </div>
                </header>
                <div className="project-context-actions">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={projectMenuOpen ? 0 : -1}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onChooseFolder();
                    }}
                  >
                    <FolderOpen size={16} />
                    <span>
                      <strong>选择项目文件夹</strong>
                      <small>将当前对话绑定为一个本地工程</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <SpotlightSurface className="composer">
            <textarea
              ref={composerRef}
              value={composer}
              rows={2}
              onChange={(event) => onComposerChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (isResponding) {
                    onInterruptAndSend();
                  } else {
                    onSend();
                  }
                }
              }}
              placeholder={
                isResponding
                  ? "输入新要求，按 Enter 中断并继续"
                  : "随心输入"
              }
            />
            <div className="composer-toolbar">
              <div>
                <div
                  ref={sourceMenuRef}
                  className={`composer-source-picker ${
                    sourceMenuOpen ? "open" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="round-button composer-add-button"
                    onClick={() =>
                      setSourceMenuOpen((current) => !current)
                    }
                    aria-label="添加原著资源"
                    aria-haspopup="menu"
                    aria-expanded={sourceMenuOpen}
                  >
                    <Plus size={18} />
                  </button>
                  <div
                    className="composer-source-menu ui-popover"
                    role="menu"
                    aria-label="添加原著资源"
                    aria-hidden={!sourceMenuOpen}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={sourceMenuOpen ? 0 : -1}
                      onClick={() => {
                        setSourceMenuOpen(false);
                        onCreateAiNovel();
                      }}
                    >
                      <Sparkles size={16} />
                      <span>
                        <strong>AI 创作小说</strong>
                        <small>根据构想生成可编辑草稿</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={sourceMenuOpen ? 0 : -1}
                      onClick={() => {
                        setSourceMenuOpen(false);
                        onImport();
                      }}
                    >
                      <FileUp size={16} />
                      <span>
                        <strong>导入本地小说</strong>
                        <small>支持 TXT、MD、Markdown</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={sourceMenuOpen ? 0 : -1}
                      onClick={() => {
                        setSourceMenuOpen(false);
                        onCreateBlankNovel();
                      }}
                    >
                      <SquarePen size={16} />
                      <span>
                        <strong>新建空白小说</strong>
                        <small>从空白正文开始编辑</small>
                      </span>
                    </button>
                  </div>
                </div>
                <AccessModePicker
                  value={accessMode}
                  onChange={onAccessModeChange}
                />
              </div>
              <div>
                <ComposerModelPicker
                  provider={modelProvider}
                  value={modelName === "选择模型" ? "" : modelName}
                  options={modelOptions}
                  onChange={onSelectModel}
                  onOpenSettings={onOpenSettings}
                />
                <button className="round-button" aria-label="语音输入">
                  <Mic size={17} />
                </button>
                <button
                  className={`send-button ${
                    isResponding
                      ? "stop"
                      : composer.trim()
                        ? "ready"
                        : ""
                  }`}
                  onClick={isResponding ? onStop : onSend}
                  aria-label={isResponding ? "停止生成" : "发送"}
                >
                  {isResponding ? (
                    <Square size={11} fill="currentColor" />
                  ) : composer.trim() ? (
                    <ArrowUp size={18} />
                  ) : (
                    <AudioLines size={18} />
                  )}
                </button>
              </div>
            </div>
          </SpotlightSurface>
        </div>
      </footer>
    </section>
  );
}

function EmptyTask({
  project,
  accessMode,
}: {
  project: Project | null;
  accessMode: AccessMode;
}) {
  return (
    <FadeContent className="empty-main-state">
      <span className="empty-mark">
        <Clapperboard size={22} />
      </span>
      <h1>{project ? "这轮任务要完成什么？" : "我们开始做什么？"}</h1>
      <p>
        {project
          ? `描述本轮任务，Agent 将在「${project.name}」中读取和生成文件。`
          : accessMode === "full"
            ? "输入小说、故事构想或制作目标，首次保存时会自动创建应用输出目录。"
            : "输入小说、故事构想或制作目标，Agent 会从当前对话开始执行。"}
      </p>
    </FadeContent>
  );
}

function AccessModePicker({
  value,
  onChange,
}: {
  value: AccessMode;
  onChange: (value: AccessMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useRef(`access-mode-${createId()}`).current;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const icon = (mode: AccessMode, size = 15) => {
    if (mode === "full") return <KeyRound size={size} />;
    if (mode === "approve") return <ShieldCheck size={size} />;
    return <CircleHelp size={size} />;
  };

  return (
    <div
      ref={rootRef}
      className={`access-mode-picker ${open ? "open" : ""}`}
      data-mode={value}
    >
      <button
        type="button"
        className="access-status"
        aria-label="切换权限"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        {icon(value)}
        <span>{accessModeLabel(value)}</span>
        <ChevronDown size={13} />
      </button>
      <div
        id={menuId}
        className="access-mode-menu ui-popover"
        role="menu"
        aria-label="任务权限"
        aria-hidden={!open}
      >
        <header>
          <strong>权限</strong>
          <span>控制 Agent 的文件写入边界</span>
        </header>
        <div>
          {accessModeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className={value === option.value ? "selected" : ""}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="access-mode-option-icon">
                {icon(option.value, 16)}
              </span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {value === option.value && <Check size={15} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComposerModelPicker({
  provider,
  value,
  options,
  onChange,
  onOpenSettings,
}: {
  provider: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useRef(`composer-model-${createId()}`).current;
  const availableModels = useMemo(
    () =>
      [...new Set([value, ...options])]
        .map((model) => model.trim())
        .filter(Boolean),
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`composer-model-picker ${open ? "open" : ""}`}
    >
      <button
        type="button"
        className="model-picker"
        aria-label="切换对话模型"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="切换对话模型"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value || "选择模型"}</span>
        <ChevronDown size={14} />
      </button>

      <div
        id={menuId}
        className="composer-model-menu ui-popover"
        role="menu"
        aria-label="对话模型"
        aria-hidden={!open}
      >
        <header>
          <strong>切换模型</strong>
          <span>{provider}</span>
        </header>

        {availableModels.length > 0 ? (
          <div className="composer-model-options">
            {availableModels.map((model) => (
              <button
                key={model}
                type="button"
                role="menuitemradio"
                aria-checked={model === value}
                className={model === value ? "active" : ""}
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  onChange(model);
                  setOpen(false);
                }}
              >
                <span>{model}</span>
                {model === value && <Check size={16} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="composer-model-empty">
            尚未配置可用的对话模型
          </div>
        )}

        <button
          type="button"
          className="composer-model-settings"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          onClick={() => {
            setOpen(false);
            onOpenSettings();
          }}
        >
          <Settings size={15} />
          <span>模型设置</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function CustomSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.indexOf(value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useRef(`select-${createId()}`).current;

  useEffect(() => {
    setActiveIndex(Math.max(0, options.indexOf(value)));
  }, [options, value]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectOption = (option: string) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`custom-select ${open ? "open" : ""}`}>
      <button
        type="button"
        className="custom-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const nextIndex =
              (activeIndex + direction + options.length) %
              options.length;
            setActiveIndex(nextIndex);
            setOpen(true);
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            selectOption(options[activeIndex]);
          }
        }}
      >
        <span>{value}</span>
        <ChevronDown size={18} />
      </button>
      <div
        id={menuId}
        className="custom-select-menu"
        role="listbox"
        aria-label={`${label}选项`}
        aria-hidden={!open}
      >
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={option === value}
            className={
              index === activeIndex || option === value ? "active" : ""
            }
            tabIndex={open ? 0 : -1}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectOption(option)}
          >
            <span>{option}</span>
            {option === value && <Check size={17} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelPicker({
  value,
  options,
  placeholder,
  loading,
  error,
  onChange,
  onFetch,
}: {
  value: string;
  options: string[];
  placeholder: string;
  loading: boolean;
  error: string;
  onChange: (value: string) => void;
  onFetch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useRef(`model-picker-${createId()}`).current;

  useEffect(() => {
    if (options.length > 0) setOpen(true);
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`model-id-picker ${open ? "open" : ""}`}
    >
      <div className="field-title-row">
        <span>模型 ID</span>
        <button
          type="button"
          className="model-fetch-button"
          onClick={onFetch}
          disabled={loading}
        >
          <RotateCcw
            size={13}
            className={loading ? "spin" : ""}
          />
          {loading ? "正在拉取" : "拉取模型"}
        </button>
      </div>
      <div className="model-id-picker-control">
        <input
          value={value}
          aria-label="模型 ID"
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && options.length > 0) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        {options.length > 0 && (
          <button
            type="button"
            className="model-id-picker-toggle"
            aria-label="选择已拉取模型"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown size={16} />
          </button>
        )}
      </div>
      <div
        id={menuId}
        className="model-id-picker-menu"
        role="listbox"
        aria-label="可用模型"
        aria-hidden={!open}
      >
        {options.map((model) => (
          <button
            key={model}
            type="button"
            role="option"
            aria-selected={model === value}
            className={model === value ? "active" : ""}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onChange(model);
              setOpen(false);
            }}
          >
            <span>{model}</span>
            {model === value && <Check size={16} />}
          </button>
        ))}
      </div>
      <small
        className={`field-hint ${
          error ? "model-fetch-error" : ""
        }`}
      >
        {error ||
          (options.length > 0
            ? `已拉取 ${options.length} 个可用模型，也可以手动填写`
            : "填写 API Key 后可拉取当前账号的可用模型")}
      </small>
    </div>
  );
}

function SettingsDialog({
  configs,
  modelCatalogs,
  activeKind,
  testState,
  projectCount,
  threadCount,
  onClose,
  onChangeKind,
  onChange,
  onTest,
  onFetchModels,
  onSaved,
}: {
  configs: ModelConfigs;
  modelCatalogs: Record<ModelKind, ModelCatalogState>;
  activeKind: ModelKind;
  testState: {
    loading: boolean;
    kind?: "success" | "error";
    text?: string;
  };
  projectCount: number;
  threadCount: number;
  onClose: () => void;
  onChangeKind: (kind: ModelKind) => void;
  onChange: <K extends keyof ModelConfig>(
    kind: ModelKind,
    key: K,
    value: ModelConfig[K],
  ) => void;
  onTest: () => void;
  onFetchModels: (kind: ModelKind) => void;
  onSaved: () => void;
}) {
  const [section, setSection] = useState<"models" | "data">("models");
  const [closing, setClosing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const config = configs[activeKind];
  const currentCatalog =
    modelCatalogs[activeKind].provider === config.provider
      ? modelCatalogs[activeKind]
      : {
          provider: config.provider,
          loading: false,
          models: [],
          error: "",
        };
  const providerPresets = modelProviderPresets[activeKind];
  const selectedProviderPreset =
    providerPresets.find(
      (preset) => preset.label === config.provider,
    ) ?? {
      label: config.provider,
      baseUrl: config.baseUrl,
      apiPath: config.apiPath,
      headers: config.headers,
      description: "保留已有的自定义服务配置",
      modelPlaceholder: "填写服务端使用的模型 ID",
    };
  const providerOptions = [
    ...providerPresets.map((preset) => preset.label),
    ...(!providerPresets.some(
      (preset) => preset.label === config.provider,
    )
      ? [config.provider]
      : []),
  ];
  const changeProvider = (provider: string) => {
    const preset = providerPresets.find(
      (item) => item.label === provider,
    );
    onChange(activeKind, "provider", provider);
    if (!preset) return;
    onChange(activeKind, "baseUrl", preset.baseUrl);
    onChange(activeKind, "apiPath", preset.apiPath);
    onChange(activeKind, "headers", preset.headers);
    if (provider !== config.provider) {
      onChange(activeKind, "model", preset.defaultModel ?? "");
    }
    if (provider.includes("自定义")) setAdvancedOpen(true);
  };
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };

  return (
    <div
      className={`modal-backdrop settings-backdrop ${
        closing ? "closing" : ""
      }`}
      onMouseDown={requestClose}
    >
      <section
        className="settings-dialog ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <strong>设置</strong>
          <button
            className="icon-button"
            onClick={requestClose}
            aria-label="关闭设置"
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-dialog-body">
          <nav className="settings-dialog-nav" aria-label="设置分类">
            <button
              className={section === "models" ? "active" : ""}
              onClick={() => setSection("models")}
            >
              <Settings size={17} />
              <span>模型服务</span>
            </button>
            <button
              className={section === "data" ? "active" : ""}
              onClick={() => setSection("data")}
            >
              <KeyRound size={17} />
              <span>数据与安全</span>
            </button>
          </nav>

          <div className="settings-dialog-content">
            {section === "models" ? (
              <div className="settings-section view-transition">
                <div className="settings-section-heading">
                  <h2>模型服务</h2>
                  <p>
                    分别配置对话、生图和视频模型。所有字段均由你自行提供。
                  </p>
                </div>

                <div className="settings-service-tabs" role="tablist">
                  <ModelTab
                    active={activeKind === "chat"}
                    configured={isModelConfigured(configs.chat)}
                    icon={<MessageSquareText size={17} />}
                    label="对话模型"
                    description="分析与对话"
                    onClick={() => onChangeKind("chat")}
                  />
                  <ModelTab
                    active={activeKind === "image"}
                    configured={isModelConfigured(configs.image)}
                    icon={<ImageIcon size={17} />}
                    label="生图模型"
                    description="静态物料"
                    onClick={() => onChangeKind("image")}
                  />
                  <ModelTab
                    active={activeKind === "video"}
                    configured={isModelConfigured(configs.video)}
                    icon={<Video size={17} />}
                    label="视频模型"
                    description="漫剧镜头"
                    onClick={() => onChangeKind("video")}
                  />
                </div>

                <div key={activeKind} className="settings-model-form view-transition">
                  <div className="model-form-heading">
                    <div>
                      <h3>{config.label}</h3>
                      <p>保存后立即作为当前服务使用。</p>
                    </div>
                    <span
                      className={`model-config-badge ${
                        isModelConfigured(config)
                          ? "configured"
                          : ""
                      }`}
                    >
                      {isModelConfigured(config) ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <AlertCircle size={14} />
                      )}
                      {isModelConfigured(config)
                        ? "已配置"
                        : "待配置"}
                    </span>
                  </div>

                  <div className="form-grid">
                    <div className="field span-2">
                      <span>服务厂商</span>
                      <CustomSelect
                        label="服务厂商"
                        value={config.provider}
                        options={providerOptions}
                        onChange={changeProvider}
                      />
                      <small className="field-hint">
                        {selectedProviderPreset.description}
                      </small>
                    </div>

                    <label className="field span-2">
                      <span>API Key</span>
                      <div className="secret-field">
                        <KeyRound size={16} />
                        <input
                          type="password"
                          value={config.apiKey}
                          onChange={(event) =>
                            onChange(activeKind, "apiKey", event.target.value)
                          }
                          placeholder="输入你自己的 API Key"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    </label>

                    <div className="field span-2">
                      <ModelPicker
                        value={config.model}
                        options={currentCatalog.models}
                        placeholder={
                          selectedProviderPreset.modelPlaceholder
                        }
                        loading={currentCatalog.loading}
                        error={currentCatalog.error}
                        onChange={(value) =>
                          onChange(activeKind, "model", value)
                        }
                        onFetch={() => onFetchModels(activeKind)}
                      />
                    </div>

                    <button
                      type="button"
                      className={`advanced-config-toggle span-2 ${
                        advancedOpen ? "open" : ""
                      }`}
                      aria-expanded={advancedOpen}
                      onClick={() =>
                        setAdvancedOpen((current) => !current)
                      }
                    >
                      <span>
                        <Settings size={14} />
                        高级配置
                      </span>
                      <small>Base URL、请求路径与自定义请求头</small>
                      <ChevronDown size={16} />
                    </button>

                    <div
                      className={`advanced-config-panel span-2 ${
                        advancedOpen ? "open" : ""
                      }`}
                      aria-hidden={!advancedOpen}
                      inert={!advancedOpen}
                    >
                      <div className="advanced-config-inner form-grid">
                        <label className="field">
                          <span>Base URL</span>
                          <input
                            value={config.baseUrl}
                            onChange={(event) =>
                              onChange(
                                activeKind,
                                "baseUrl",
                                event.target.value,
                              )
                            }
                            placeholder="https://api.example.com/v1"
                            spellCheck={false}
                          />
                        </label>

                        <label className="field">
                          <span>请求路径</span>
                          <input
                            value={config.apiPath}
                            onChange={(event) =>
                              onChange(
                                activeKind,
                                "apiPath",
                                event.target.value,
                              )
                            }
                            placeholder="例如：chat/completions"
                            spellCheck={false}
                          />
                        </label>

                        <label className="field span-2">
                          <span>自定义请求头（JSON）</span>
                          <textarea
                            value={config.headers}
                            onChange={(event) =>
                              onChange(
                                activeKind,
                                "headers",
                                event.target.value,
                              )
                            }
                            rows={3}
                            spellCheck={false}
                            placeholder='{"X-Custom-Header":"value"}'
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="model-form-actions">
                    <button
                      className="secondary-button"
                      onClick={onTest}
                      disabled={testState.loading}
                    >
                      {testState.loading ? (
                        <RotateCcw size={15} className="spin" />
                      ) : (
                        <Link2 size={15} />
                      )}
                      {testState.loading ? "正在测试" : "测试连接"}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => {
                        onSaved();
                        requestClose();
                      }}
                    >
                      <Save size={15} />
                      保存配置
                    </button>
                    {testState.text && (
                      <span className={`test-result ${testState.kind ?? ""}`}>
                        {testState.kind === "success" ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <AlertCircle size={15} />
                        )}
                        {testState.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="settings-section view-transition">
                <div className="settings-section-heading">
                  <h2>数据与安全</h2>
                  <p>管理本机数据的保存方式与凭据安全。</p>
                </div>
                <div className="settings-data-card">
                  <div>
                    <strong>本地工作区</strong>
                    <span>任务和项目索引保存在当前设备。</span>
                  </div>
                  <div className="settings-data-stats">
                    <span>
                      <strong>{threadCount}</strong>
                      个任务
                    </span>
                    <span>
                      <strong>{projectCount}</strong>
                      个项目文件夹
                    </span>
                  </div>
                </div>
                <div className="settings-data-card">
                  <div>
                    <strong>API 凭据</strong>
                    <span>
                      当前开发版保存在本机应用数据中，正式发布前将迁移到系统凭据存储。
                    </span>
                  </div>
                  <span className="local-only-badge">仅本机</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ModelTab({
  active,
  configured,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  configured: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <i className={configured ? "configured" : ""} />
    </button>
  );
}

function RightSidebar({
  project,
  thread,
  activeTab,
  selectedResourceId,
  isOpen,
  width,
  onTabChange,
  onSelectResource,
  onResizeStart,
  onResetWidth,
}: {
  project: Project | null;
  thread: Thread | null;
  activeTab: "files" | "tasks";
  selectedResourceId: string;
  isOpen: boolean;
  width: number;
  onTabChange: (tab: "files" | "tasks") => void;
  onSelectResource: (id: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
}) {
  const groups = useMemo(
    () =>
      resourceCategoryOrder
        .map((category) => ({
          category,
          items:
            project?.resources.filter(
              (resource) => resource.category === category,
            ) ?? [],
        }))
        .filter((group) => group.items.length > 0),
    [project],
  );

  return (
    <aside
      className={`right-sidebar ${isOpen ? "open" : "closed"}`}
      aria-hidden={!isOpen}
    >
      <div
        className="right-resize-handle"
        role="separator"
        aria-label="调整资源栏宽度"
        aria-orientation="vertical"
        aria-valuemin={300}
        aria-valuemax={640}
        aria-valuenow={width}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
      >
        <span className="resize-tooltip">
          拖动调整宽度 · 双击恢复默认
        </span>
      </div>
      <header className="right-header">
        <div>
          <strong>文件与资源</strong>
          <span title={project?.rootPath}>
            {project
              ? isManagedProject(project)
                ? thread?.title ?? project.name
                : project.name
              : "当前任务未绑定文件夹"}
          </span>
        </div>
      </header>

      <div className="right-tabs">
        <button
          className={activeTab === "files" ? "active" : ""}
          onClick={() => onTabChange("files")}
        >
          文件
        </button>
        <button
          className={activeTab === "tasks" ? "active" : ""}
          onClick={() => onTabChange("tasks")}
        >
          任务
        </button>
      </div>

      <div className="right-search">
        <Search size={14} />
        <input placeholder="搜索项目资源" />
        <LayoutGrid size={14} />
      </div>

      <div className="right-scroll">
        <div key={activeTab} className="right-tab-content">
          {activeTab === "tasks" ? (
            <RightEmpty
              icon={<Clock3 size={20} />}
              title="暂无任务"
              description="生成任务会按项目显示"
            />
          ) : !project ? (
            <RightEmpty
              icon={<Folder size={20} />}
              title="当前任务未绑定文件夹"
              description="在输入框上方选择文件夹后，这里会显示项目资源"
            />
          ) : groups.length === 0 ? (
            <RightEmpty
              icon={<FileText size={20} />}
              title="项目中还没有文件"
              description="导入小说后，原始文件会显示在这里"
            />
          ) : (
            <AnimatedList className="resource-tree">
              {groups.map((group) => (
                <ResourceGroup
                  key={group.category}
                  category={group.category}
                  items={group.items}
                  selectedResourceId={selectedResourceId}
                  onSelect={onSelectResource}
                />
              ))}
            </AnimatedList>
          )}
        </div>
      </div>
    </aside>
  );
}

function ResourceGroup({
  category,
  items,
  selectedResourceId,
  onSelect,
}: {
  category: ResourceCategory;
  items: ProjectResource[];
  selectedResourceId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="resource-group">
      <button
        className="resource-group-title"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={13} className={open ? "open" : ""} />
        <ResourceIcon category={category} />
        <span>{category}</span>
        <small>{items.length}</small>
      </button>
      <div className={`resource-items-collapse ${open ? "open" : ""}`}>
        <div className="resource-items">
          {items.map((resource) => (
            <button
              key={resource.id}
              className={
                selectedResourceId === resource.id ? "selected" : ""
              }
              onClick={() => onSelect(resource.id)}
            >
              {resource.kind === "video" ? (
                <Film size={14} />
              ) : resource.kind === "image" ? (
                <ImageIcon size={14} />
              ) : (
                <File size={14} />
              )}
              <span>{resource.name}</span>
              {resource.status === "generating" ? (
                <small className="resource-status generating">
                  <RotateCcw size={10} className="spin" />
                  写入中
                </small>
              ) : resource.status === "stopped" ? (
                <small className="resource-status stopped">草稿</small>
              ) : resource.status === "error" ? (
                <small className="resource-status error">写入异常</small>
              ) : resource.size ? (
                <small>{formatBytes(resource.size)}</small>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResourceIcon({
  category,
}: {
  category: ResourceCategory;
}) {
  if (category === "原著") return <BookOpenText size={14} />;
  if (category === "角色" || category === "场景")
    return <ImageIcon size={14} />;
  if (category === "成片") return <Film size={14} />;
  return <FileText size={14} />;
}

function RightEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <FadeContent className="right-empty">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </FadeContent>
  );
}

function ManagedOutputApprovalDialog({
  action,
  onCancel,
  onApprove,
}: {
  action: string;
  onCancel: () => void;
  onApprove: () => void;
}) {
  return createPortal(
    <div
      className="modal-backdrop permission-approval-backdrop"
      onMouseDown={onCancel}
    >
      <section
        className="permission-approval-dialog ui-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="permission-approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="permission-approval-icon">
          <ShieldCheck size={22} />
        </span>
        <div>
          <strong id="permission-approval-title">
            允许创建应用输出目录？
          </strong>
          <p>
            Agent 需要{action}。当前任务没有绑定文件夹，批准后会在应用托管的
            <code> outputs </code>工作区中创建并保存文件。
          </p>
        </div>
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onApprove}
          >
            允许本次操作
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function StatusToast({ message }: { message: string }) {
  const tone = /失败|错误|请先|不支持|未配置|无法/.test(message)
    ? "error"
    : /已|成功|完成|导入/.test(message)
      ? "success"
      : "info";

  return (
    <div className={`toast ${tone}`} role="status" aria-live="polite">
      <span className="toast-icon">
        {tone === "success" ? (
          <CheckCircle2 size={19} />
        ) : tone === "error" ? (
          <AlertCircle size={19} />
        ) : (
          <CircleHelp size={19} />
        )}
      </span>
      <span>{message}</span>
    </div>
  );
}

function WorkspaceSearchDialog({
  projects,
  threads,
  onClose,
  onSelectProject,
  onSelectThread,
  onSelectResource,
}: {
  projects: Project[];
  threads: Thread[];
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onSelectResource: (projectId: string, resourceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [closing, setClosing] = useState(false);

  const allItems = useMemo<WorkspaceSearchItem[]>(
    () => {
      const projectItems = projects.flatMap((project) => [
          {
            id: `project-${project.id}`,
            kind: "project" as const,
            title: project.name,
            meta: `${threads.filter((thread) => thread.projectId === project.id).length} 个任务 · ${project.resources.length} 个文件`,
            timestamp: project.updatedAt,
            projectId: project.id,
          },
          ...project.resources.map((resource) => ({
            id: `resource-${resource.id}`,
            kind: "resource" as const,
            title: resource.name,
            meta: `${project.name} · ${resource.category}`,
            timestamp: resource.createdAt,
            projectId: project.id,
            resourceId: resource.id,
            category: resource.category,
          })),
        ]);
      const threadItems = threads.map((thread) => {
        const project = projects.find(
          (item) => item.id === thread.projectId,
        );
        return {
          id: `thread-${thread.id}`,
          kind: "thread" as const,
          title: thread.title,
          meta: project?.name ?? "未绑定项目文件夹",
          timestamp: thread.updatedAt,
          projectId: project?.id,
          threadId: thread.id,
        };
      });
      return [...projectItems, ...threadItems].sort(
        (left, right) => right.timestamp - left.timestamp,
      );
    },
    [projects, threads],
  );

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return allItems
      .filter(
        (item) =>
          !normalized ||
          item.title.toLocaleLowerCase().includes(normalized) ||
          item.meta.toLocaleLowerCase().includes(normalized),
      )
      .slice(0, 16);
  }, [allItems, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };

  const selectItem = (item: WorkspaceSearchItem) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      if (item.kind === "project") {
        if (item.projectId) onSelectProject(item.projectId);
      } else if (item.kind === "thread" && item.threadId) {
        onSelectThread(item.threadId);
      } else if (
        item.kind === "resource" &&
        item.projectId &&
        item.resourceId
      ) {
        onSelectResource(item.projectId, item.resourceId);
      }
      onClose();
    }, 180);
  };

  return (
    <div
      className={`modal-backdrop search-backdrop ${
        closing ? "closing" : ""
      }`}
      onMouseDown={requestClose}
    >
      <section
        className="search-dialog ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="搜索工作区"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-dialog-input">
          <Search size={19} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") requestClose();
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.min(results.length - 1, index + 1),
                );
              }
              if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                selectItem(results[activeIndex]);
              }
            }}
            placeholder="搜索任务、项目文件夹和文件"
            aria-label="搜索任务、项目文件夹和文件"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="search-results" role="listbox">
          {results.length === 0 ? (
            <FadeContent className="search-empty">
              <Search size={22} />
              <strong>
                {projects.length === 0 && threads.length === 0
                  ? "工作区还没有可搜索内容"
                  : "没有找到相关内容"}
              </strong>
              <span>
                {projects.length === 0 && threads.length === 0
                  ? "创建一轮任务后，可在这里快速查找"
                  : "尝试输入其他任务、文件夹或文件名称"}
              </span>
            </FadeContent>
          ) : (
            <>
              <div className="search-results-label">
                {query.trim() ? "搜索结果" : "最近内容"}
                <span>{results.length}</span>
              </div>
              <AnimatedList className="search-results-list">
                {results.map((item, index) => (
                  <button
                    key={item.id}
                    className={
                      index === activeIndex ? "active" : ""
                    }
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectItem(item)}
                  >
                    <span className="search-result-icon">
                      {item.kind === "project" ? (
                        <Folder size={17} />
                      ) : item.kind === "thread" ? (
                        <MessageSquareText size={17} />
                      ) : (
                        <ResourceIcon category={item.category ?? "原著"} />
                      )}
                    </span>
                    <span className="search-result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </span>
                    <span className="search-result-kind">
                      {item.kind === "project"
                        ? "文件夹"
                        : item.kind === "thread"
                          ? "任务"
                          : "文件"}
                    </span>
                  </button>
                ))}
              </AnimatedList>
            </>
          )}
        </div>

        <footer className="search-dialog-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            选择
          </span>
          <span>
            <kbd>Enter</kbd>
            打开
          </span>
        </footer>
      </section>
    </div>
  );
}

function NovelCreatorDialog({
  mode,
  projectName,
  onClose,
  onGenerate,
  onCancelGeneration,
  onSave,
}: {
  mode: NovelCreationMode;
  projectName: string;
  onClose: () => void;
  onGenerate: (
    title: string,
    brief: string,
    mode: NovelGenerationMode,
    onDelta: (content: string) => void,
  ) => Promise<string>;
  onCancelGeneration: () => void;
  onSave: (
    title: string,
    content: string,
    source: NovelCreationMode,
  ) => Promise<void>;
}) {
  const generationOptions = [
    "小说方案与目录",
    "第一章草稿",
    "完整短篇小说",
  ];
  const generationModeByLabel: Record<
    string,
    NovelGenerationMode
  > = {
    小说方案与目录: "plan",
    第一章草稿: "chapter",
    完整短篇小说: "short",
  };
  const [title, setTitle] = useState(
    mode === "blank" ? "未命名小说" : "",
  );
  const [brief, setBrief] = useState("");
  const [generationLabel, setGenerationLabel] = useState(
    "小说方案与目录",
  );
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] =
    useState(false);

  const closeImmediately = () => {
    if (closing) return;
    onCancelGeneration();
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const requestClose = () => {
    if (touched || content.trim() || brief.trim()) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeImmediately();
  };
  const startGeneration = async () => {
    if (!brief.trim()) {
      setError("请先填写题材、人物或故事构想");
      return;
    }
    setGenerating(true);
    setTouched(true);
    setError("");
    setContent("");
    try {
      await onGenerate(
        title,
        brief,
        generationModeByLabel[generationLabel],
        setContent,
      );
    } catch (generationError) {
      const message = String(generationError);
      if (!message.includes("已取消")) setError(message);
    } finally {
      setGenerating(false);
    }
  };
  const saveNovel = async () => {
    if (!content.trim()) {
      setError("小说正文不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(title, content, mode);
    } catch (saveError) {
      setError(String(saveError));
      setSaving(false);
    }
  };

  return (
    <div
      className={`modal-backdrop ${closing ? "closing" : ""}`}
      onMouseDown={requestClose}
    >
      <section
        className="novel-creator-dialog ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "ai" ? "AI 创作小说" : "新建空白小说"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>
              {mode === "ai" ? "AI 创作小说" : "新建空白小说"}
            </strong>
            <span>保存到「{projectName}」的原著资源</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label="关闭小说编辑器"
          >
            <X size={17} />
          </button>
        </header>

        <div className="novel-creator-body">
          <div className={`novel-creator-fields ${mode}`}>
            <label className="field">
              <span>小说标题</span>
              <input
                value={title}
                placeholder="例如：雾港来信"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTouched(true);
                }}
              />
            </label>
            {mode === "ai" && (
              <div className="field">
                <span>生成内容</span>
                <CustomSelect
                  label="生成内容"
                  value={generationLabel}
                  options={generationOptions}
                  onChange={setGenerationLabel}
                />
              </div>
            )}
          </div>

          {mode === "ai" && (
            <label className="field novel-brief-field">
              <span>创作要求</span>
              <textarea
                rows={4}
                value={brief}
                placeholder="描述题材、时代背景、主要人物、核心冲突、叙事风格和你不希望出现的内容……"
                onChange={(event) => {
                  setBrief(event.target.value);
                  setTouched(true);
                }}
                disabled={generating}
              />
            </label>
          )}

          <div className="novel-editor-heading">
            <div>
              <strong>{mode === "ai" ? "生成草稿" : "小说正文"}</strong>
              <span>{content.length.toLocaleString()} 个字符</span>
            </div>
            {generating && (
              <span className="novel-generating-status">
                <RotateCcw size={13} className="spin" />
                AI 正在创作
              </span>
            )}
          </div>
          <textarea
            className="novel-editor-textarea"
            value={content}
            placeholder={
              mode === "ai"
                ? "填写创作要求后生成，生成结果可在这里继续修改。"
                : "从这里开始写小说……"
            }
            onChange={(event) => {
              setContent(event.target.value);
              setTouched(true);
            }}
            disabled={generating}
            spellCheck={false}
          />
          {error && (
            <div className="editor-error" role="alert">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer>
          <span>保存后可在右侧“原著”分类继续编辑</span>
          <div>
            {mode === "ai" && (
              <button
                type="button"
                className="secondary-button"
                onClick={
                  generating
                    ? () => {
                        onCancelGeneration();
                        setGenerating(false);
                      }
                    : () => void startGeneration()
                }
                disabled={saving}
              >
                {generating ? (
                  <Square size={11} fill="currentColor" />
                ) : (
                  <Sparkles size={15} />
                )}
                {generating
                  ? "停止生成"
                  : content
                    ? "重新生成"
                    : "生成草稿"}
              </button>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={() => void saveNovel()}
              disabled={saving || generating || !content.trim()}
            >
              {saving ? (
                <RotateCcw size={14} className="spin" />
              ) : (
                <Save size={15} />
              )}
              {saving ? "正在保存" : "保存小说"}
            </button>
          </div>
        </footer>

        {discardConfirmOpen && (
          <div className="editor-confirm-layer">
            <div className="editor-confirm-card" role="alertdialog">
              <strong>放弃未保存的内容？</strong>
              <span>关闭后，本次创作和修改不会保留。</span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDiscardConfirmOpen(false)}
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={closeImmediately}
                >
                  放弃内容
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ResourcePreview({
  resource,
  onClose,
  onLoad,
  onSave,
}: {
  resource: ProjectResource;
  onClose: () => void;
  onLoad: (resource: ProjectResource) => Promise<string>;
  onSave: (
    resource: ProjectResource,
    content: string,
  ) => Promise<void>;
}) {
  const editable =
    resource.kind === "text" && resource.category === "原著";
  const [content, setContent] = useState(resource.preview ?? "");
  const [savedContent, setSavedContent] = useState(
    resource.preview ?? "",
  );
  const [loading, setLoading] = useState(editable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] =
    useState(false);
  const dirty = editable && content !== savedContent;

  useEffect(() => {
    if (!editable) return;
    let active = true;
    setLoading(true);
    setError("");
    void onLoad(resource)
      .then((loadedContent) => {
        if (!active) return;
        setContent(loadedContent);
        setSavedContent(loadedContent);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editable, resource.id, resource.path]);

  const closeImmediately = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const requestClose = () => {
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeImmediately();
  };
  const saveChanges = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(resource, content);
      setSavedContent(content);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`modal-backdrop ${closing ? "closing" : ""}`}
      onMouseDown={requestClose}
    >
      <section
        className="resource-preview ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${editable ? "编辑" : "预览"} ${resource.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{resource.name}</strong>
            <span>
              {resource.category}
              {resource.size ? ` · ${formatBytes(resource.size)}` : ""}
              {editable ? " · 可编辑" : ""}
            </span>
          </div>
          <div className="resource-editor-actions">
            {editable && (
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => void saveChanges()}
                disabled={loading || saving || !dirty}
              >
                {saving ? (
                  <RotateCcw size={13} className="spin" />
                ) : (
                  <Save size={14} />
                )}
                {saving ? "保存中" : "保存修改"}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={requestClose}
              aria-label="关闭资源编辑器"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="preview-body">
          {editable ? (
            loading ? (
              <div className="resource-editor-loading">
                <RotateCcw size={18} className="spin" />
                <span>正在读取原著全文</span>
              </div>
            ) : (
              <div className="resource-editor-shell">
                <div className="resource-editor-meta">
                  <span>{content.length.toLocaleString()} 个字符</span>
                  <span>{dirty ? "有未保存修改" : "已保存"}</span>
                </div>
                <textarea
                  className="resource-editor-textarea"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  aria-label={`编辑 ${resource.name}`}
                />
                {error && (
                  <div className="editor-error" role="alert">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )
          ) : resource.kind === "text" ? (
            <pre>{resource.preview || "文件内容为空"}</pre>
          ) : (
            <div className="unavailable-preview">
              {resource.kind === "video" ? (
                <Video size={26} />
              ) : (
                <ImageIcon size={26} />
              )}
              <span>资源暂时没有可用预览</span>
            </div>
          )}
        </div>

        {discardConfirmOpen && (
          <div className="editor-confirm-layer">
            <div className="editor-confirm-card" role="alertdialog">
              <strong>放弃未保存的修改？</strong>
              <span>关闭后，本次对原著的调整不会保留。</span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDiscardConfirmOpen(false)}
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={closeImmediately}
                >
                  放弃修改
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default App;
