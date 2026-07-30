import {
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
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Square,
  SquarePen,
  Video,
  X,
} from "lucide-react";
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

type ViewMode = "chat" | "settings";
type ModelKind = "chat" | "image" | "video";
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
};

type Thread = {
  id: string;
  title: string;
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
  createdAt: number;
};

type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  threads: Thread[];
  resources: ProjectResource[];
};

type WorkspaceState = {
  projects: Project[];
};

type ModelConfig = {
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiPath: string;
  headers: string;
  enabled: boolean;
};

type ModelConfigs = Record<ModelKind, ModelConfig>;

type WorkspaceSearchItem = {
  id: string;
  kind: "project" | "thread" | "resource";
  title: string;
  meta: string;
  timestamp: number;
  projectId: string;
  threadId?: string;
  resourceId?: string;
  category?: ResourceCategory;
};

const emptyWorkspace: WorkspaceState = { projects: [] };

const defaultModelConfigs: ModelConfigs = {
  chat: {
    label: "对话模型",
    provider: "OpenAI 兼容",
    baseUrl: "",
    model: "",
    apiKey: "",
    apiPath: "chat/completions",
    headers: "{}",
    enabled: false,
  },
  image: {
    label: "生图模型",
    provider: "OpenAI 兼容",
    baseUrl: "",
    model: "",
    apiKey: "",
    apiPath: "images/generations",
    headers: "{}",
    enabled: false,
  },
  video: {
    label: "视频模型",
    provider: "自定义 REST",
    baseUrl: "",
    model: "",
    apiKey: "",
    apiPath: "",
    headers: "{}",
    enabled: false,
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
): Message {
  return { id: createId(), role, content, createdAt: Date.now() };
}

function createThread(title = "新对话"): Thread {
  const now = Date.now();
  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: createId(),
    name,
    createdAt: now,
    updatedAt: now,
    threads: [createThread()],
    resources: [],
  };
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
  const [workspace, setWorkspace] = useStoredState<WorkspaceState>(
    "manju-agent-workspace-v2",
    emptyWorkspace,
  );
  const [modelConfigs, setModelConfigs] = useStoredState<ModelConfigs>(
    "manju-agent-model-configs-v2",
    defaultModelConfigs,
  );
  const [rightOpen, setRightOpen] = useStoredState(
    "manju-agent-right-panel-v2",
    true,
  );
  const [rightWidth, setRightWidth] = useStoredState(
    "manju-agent-right-width-v2",
    380,
  );
  const [rightResizing, setRightResizing] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [rightTab, setRightTab] = useState<"files" | "tasks">("files");
  const [activeModelKind, setActiveModelKind] =
    useState<ModelKind>("chat");
  const [composer, setComposer] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [resourcePreviewOpen, setResourcePreviewOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [testState, setTestState] = useState<{
    loading: boolean;
    kind?: "success" | "error";
    text?: string;
  }>({ loading: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const clampRightWidth = (width: number) => {
    const viewportLimit = Math.max(
      300,
      Math.min(640, window.innerWidth - 740),
    );
    return Math.round(Math.max(300, Math.min(viewportLimit, width)));
  };

  useEffect(() => {
    const handleResize = () => {
      setRightWidth((width) => clampRightWidth(width));
    };
    const frame = window.requestAnimationFrame(handleResize);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

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

  const selectedProject = useMemo(
    () =>
      workspace.projects.find(
        (project) => project.id === selectedProjectId,
      ) ?? null,
    [selectedProjectId, workspace.projects],
  );

  const selectedThread = useMemo(
    () =>
      selectedProject?.threads.find(
        (thread) => thread.id === selectedThreadId,
      ) ?? null,
    [selectedProject, selectedThreadId],
  );

  const selectedResource = useMemo(
    () =>
      selectedProject?.resources.find(
        (resource) => resource.id === selectedResourceId,
      ) ?? null,
    [selectedProject, selectedResourceId],
  );

  useEffect(() => {
    if (!selectedProjectId && workspace.projects[0]) {
      setSelectedProjectId(workspace.projects[0].id);
      setSelectedThreadId(workspace.projects[0].threads[0]?.id ?? "");
    }
  }, [selectedProjectId, workspace.projects]);

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
      projects: current.projects.map((project) =>
        project.id === projectId ? update(project) : project,
      ),
    }));
  };

  const selectProject = (project: Project) => {
    setSelectedProjectId(project.id);
    setSelectedThreadId(project.threads[0]?.id ?? "");
    setSelectedResourceId("");
    setViewMode("chat");
  };

  const addProject = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const project = createProject(trimmedName);
    setWorkspace((current) => ({
      projects: [project, ...current.projects],
    }));
    setSelectedProjectId(project.id);
    setSelectedThreadId(project.threads[0].id);
    setViewMode("chat");
    setProjectDialogOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const createNewThread = () => {
    if (!selectedProject) {
      setProjectDialogOpen(true);
      return;
    }
    const thread = createThread();
    updateProject(selectedProject.id, (project) => ({
      ...project,
      updatedAt: Date.now(),
      threads: [thread, ...project.threads],
    }));
    setSelectedThreadId(thread.id);
    setViewMode("chat");
    setComposer("");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const handleNovelImport = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["txt", "md", "markdown"].includes(extension ?? "")) {
      setToast("当前支持 TXT、MD 和 Markdown 文件");
      return;
    }

    const content = await file.text();
    const baseName = file.name.replace(/\.[^.]+$/, "") || "未命名项目";
    let project = selectedProject;

    if (!project) {
      project = createProject(baseName);
      setWorkspace((current) => ({
        projects: [project as Project, ...current.projects],
      }));
      setSelectedProjectId(project.id);
      setSelectedThreadId(project.threads[0].id);
    }

    let savedPath = "";
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      savedPath = await invoke<string>("save_project_source", {
        projectId: project.id,
        fileName: file.name,
        content,
      });
    } catch (error) {
      setToast(`文件已载入，但本地保存失败：${String(error)}`);
    }

    const resource: ProjectResource = {
      id: createId(),
      name: file.name,
      category: "原著",
      kind: "text",
      size: file.size,
      path: savedPath,
      preview: content.slice(0, 12000),
      createdAt: Date.now(),
    };

    const projectId = project.id;
    const threadId = project.threads[0]?.id ?? createThread().id;
    updateProject(projectId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      resources: [
        resource,
        ...current.resources.filter(
          (item) =>
            !(item.category === "原著" && item.name === resource.name),
        ),
      ],
      threads: current.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title:
                thread.messages.length === 0
                  ? `分析《${baseName}》`
                  : thread.title,
              updatedAt: Date.now(),
              messages: [
                ...thread.messages,
                createMessage(
                  "system",
                  `已导入原著文件「${file.name}」，共 ${content.length.toLocaleString()} 个字符。`,
                ),
              ],
            }
          : thread,
      ),
    }));

    setSelectedProjectId(projectId);
    setSelectedThreadId(threadId);
    setSelectedResourceId(resource.id);
    setViewMode("chat");
    setRightTab("files");
    setRightOpen(true);
    setToast("原著已导入当前项目");
  };

  const sendMessage = async () => {
    const input = composer.trim();
    if (!input || isResponding) return;
    if (!selectedProject) {
      setProjectDialogOpen(true);
      return;
    }

    const config = modelConfigs.chat;
    if (
      !config.enabled ||
      !config.baseUrl.trim() ||
      !config.model.trim()
    ) {
      setActiveModelKind("chat");
      setViewMode("settings");
      setToast("请先配置并启用对话模型");
      return;
    }

    let thread = selectedThread;
    if (!thread) {
      thread = createThread();
      updateProject(selectedProject.id, (project) => ({
        ...project,
        threads: [thread as Thread, ...project.threads],
      }));
      setSelectedThreadId(thread.id);
    }

    const userMessage = createMessage("user", input);
    const projectId = selectedProject.id;
    const threadId = thread.id;
    setComposer("");
    setIsResponding(true);

    updateProject(projectId, (project) => ({
      ...project,
      updatedAt: Date.now(),
      threads: project.threads.map((item) =>
        item.id === threadId
          ? {
              ...item,
              title:
                item.title === "新对话"
                  ? input.slice(0, 24)
                  : item.title,
              updatedAt: Date.now(),
              messages: [...item.messages, userMessage],
            }
          : item,
      ),
    }));

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const reply = await invoke<string>("send_chat_message", {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        apiPath: config.apiPath,
        headersJson: config.headers,
        input,
      });
      updateProject(projectId, (project) => ({
        ...project,
        updatedAt: Date.now(),
        threads: project.threads.map((item) =>
          item.id === threadId
            ? {
                ...item,
                updatedAt: Date.now(),
                messages: [
                  ...item.messages,
                  createMessage("assistant", reply),
                ],
              }
            : item,
        ),
      }));
    } catch (error) {
      updateProject(projectId, (project) => ({
        ...project,
        threads: project.threads.map((item) =>
          item.id === threadId
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  createMessage(
                    "system",
                    `模型请求失败：${String(error)}`,
                  ),
                ],
              }
            : item,
        ),
      }));
    } finally {
      setIsResponding(false);
    }
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
        } ${rightResizing ? "right-resizing" : ""}`}
        style={
          {
            "--right-panel-width": `${rightWidth}px`,
          } as CSSProperties
        }
      >
        <LeftSidebar
          projects={workspace.projects}
          selectedProjectId={selectedProjectId}
          selectedThreadId={selectedThreadId}
          activeView={viewMode}
          onNewThread={createNewThread}
          onSearch={() => setSearchDialogOpen(true)}
          onOpenSettings={() => setViewMode("settings")}
          onNewProject={() => setProjectDialogOpen(true)}
          onSelectProject={selectProject}
          onSelectThread={(projectId, threadId) => {
            setSelectedProjectId(projectId);
            setSelectedThreadId(threadId);
            setViewMode("chat");
          }}
        />

        <main className="center-pane">
          {viewMode === "settings" ? (
            <ModelSettingsView
              configs={modelConfigs}
              activeKind={activeModelKind}
              testState={testState}
              rightOpen={rightOpen}
              onChangeKind={setActiveModelKind}
              onChange={updateModelConfig}
              onTest={() => void testModelConnection()}
              onSaved={() => setToast("模型配置已保存在本机")}
              onToggleRight={() => setRightOpen((open) => !open)}
            />
          ) : (
            <ChatView
              project={selectedProject}
              thread={selectedThread}
              composer={composer}
              isResponding={isResponding}
              rightOpen={rightOpen}
              composerRef={composerRef}
              onComposerChange={setComposer}
              onSend={() => void sendMessage()}
              onCreateProject={() => setProjectDialogOpen(true)}
              onImport={() => fileInputRef.current?.click()}
              onOpenSettings={() => {
                setActiveModelKind("chat");
                setViewMode("settings");
              }}
              onToggleRight={() => setRightOpen((open) => !open)}
            />
          )}
        </main>

        <RightSidebar
          project={selectedProject}
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

      {projectDialogOpen && (
        <NewProjectDialog
          onClose={() => setProjectDialogOpen(false)}
          onCreate={addProject}
        />
      )}

      {searchDialogOpen && (
        <WorkspaceSearchDialog
          projects={workspace.projects}
          onClose={() => setSearchDialogOpen(false)}
          onSelectProject={(projectId) => {
            const project = workspace.projects.find(
              (item) => item.id === projectId,
            );
            if (project) selectProject(project);
          }}
          onSelectThread={(projectId, threadId) => {
            setSelectedProjectId(projectId);
            setSelectedThreadId(threadId);
            setSelectedResourceId("");
            setViewMode("chat");
          }}
          onSelectResource={(projectId, resourceId) => {
            const project = workspace.projects.find(
              (item) => item.id === projectId,
            );
            setSelectedProjectId(projectId);
            setSelectedThreadId(project?.threads[0]?.id ?? "");
            setSelectedResourceId(resourceId);
            setViewMode("chat");
            setRightTab("files");
            setRightOpen(true);
            setResourcePreviewOpen(true);
          }}
        />
      )}

      {resourcePreviewOpen && selectedResource && (
        <ResourcePreview
          resource={selectedResource}
          onClose={() => setResourcePreviewOpen(false)}
        />
      )}

      {toast && <StatusToast key={toast} message={toast} />}
    </div>
  );
}

function LeftSidebar({
  projects,
  selectedProjectId,
  selectedThreadId,
  activeView,
  onNewThread,
  onSearch,
  onOpenSettings,
  onNewProject,
  onSelectProject,
  onSelectThread,
}: {
  projects: Project[];
  selectedProjectId: string;
  selectedThreadId: string;
  activeView: ViewMode;
  onNewThread: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onNewProject: () => void;
  onSelectProject: (project: Project) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
}) {
  return (
    <aside className="left-sidebar">
      <div className="brand-row">
        <div className="brand-button">
          <span className="brand-mark">
            <Clapperboard size={15} />
          </span>
          <span>漫剧 Agent</span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主要功能">
        <button className="nav-row nav-primary" onClick={onNewThread}>
          <SquarePen size={16} />
          <span>新建对话</span>
        </button>
        <button className="nav-row" onClick={onSearch}>
          <Search size={16} />
          <span>搜索</span>
          <kbd className="nav-shortcut">Ctrl K</kbd>
        </button>
      </nav>

      <div className="sidebar-section-header">
        <span>项目</span>
        <button
          className="icon-button small"
          onClick={onNewProject}
          aria-label="新建项目"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="sidebar-empty">
            <Folder size={18} />
            <span>还没有项目</span>
            <button onClick={onNewProject}>新建项目</button>
          </div>
        ) : (
          <AnimatedList className="project-list-entries">
            {projects.map((project) => {
              const selected = project.id === selectedProjectId;
              return (
                <div className="project-block" key={project.id}>
                  <button
                    className={`project-row ${selected ? "selected" : ""}`}
                    onClick={() => onSelectProject(project)}
                  >
                    {selected ? (
                      <FolderOpen size={15} />
                    ) : (
                      <Folder size={15} />
                    )}
                    <span>{project.name}</span>
                    <ChevronRight
                      size={13}
                      className={selected ? "open" : ""}
                    />
                  </button>
                  {selected && (
                    <AnimatedList className="thread-list">
                      {project.threads.map((thread) => (
                        <button
                          key={thread.id}
                          className={`thread-row ${
                            thread.id === selectedThreadId &&
                            activeView === "chat"
                              ? "selected"
                              : ""
                          }`}
                          onClick={() =>
                            onSelectThread(project.id, thread.id)
                          }
                        >
                          <MessageSquareText size={13} />
                          <span>{thread.title}</span>
                        </button>
                      ))}
                    </AnimatedList>
                  )}
                </div>
              );
            })}
          </AnimatedList>
        )}
      </div>

      <button
        className={`workspace-profile ${
          activeView === "settings" ? "active" : ""
        }`}
        onClick={onOpenSettings}
      >
        <span className="profile-avatar">M</span>
        <span>
          <strong>本地工作区</strong>
          <small>设置与模型服务</small>
        </span>
        <Settings size={15} />
      </button>
    </aside>
  );
}

function ChatView({
  project,
  thread,
  composer,
  isResponding,
  rightOpen,
  composerRef,
  onComposerChange,
  onSend,
  onCreateProject,
  onImport,
  onOpenSettings,
  onToggleRight,
}: {
  project: Project | null;
  thread: Thread | null;
  composer: string;
  isResponding: boolean;
  rightOpen: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onCreateProject: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
  onToggleRight: () => void;
}) {
  return (
    <section className="chat-view">
      <header className="center-header">
        <div className="center-title">
          <strong>{thread?.title ?? "新建项目"}</strong>
          <span>{project?.name ?? "尚未选择项目"}</span>
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

      <div className="chat-scroll">
        {!project ? (
          <EmptyWorkspace
            onCreateProject={onCreateProject}
            onImport={onImport}
            onOpenSettings={onOpenSettings}
          />
        ) : !thread || thread.messages.length === 0 ? (
          <EmptyThread
            projectName={project.name}
            onImport={onImport}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <div className="message-column">
            {thread.messages.map((message) => (
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
                <div className="message-content">{message.content}</div>
              </div>
            ))}
            {isResponding && (
              <div className="message message-assistant">
                <span className="message-avatar">
                  <Clapperboard size={14} />
                </span>
                <div className="typing">
                  <ShinyStatus>Agent 正在生成</ShinyStatus>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="composer-area">
        <SpotlightSurface className="composer">
          <textarea
            ref={composerRef}
            value={composer}
            rows={2}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              project
                ? "向 Agent 描述要完成的任务…"
                : "请先新建项目或导入小说"
            }
          />
          <div className="composer-toolbar">
            <div>
              <button className="round-button" onClick={onImport}>
                <Plus size={17} />
              </button>
              <button className="composer-action" onClick={onImport}>
                <Folder size={14} />
                引用项目文件
              </button>
            </div>
            <div>
              <button className="composer-action" onClick={onOpenSettings}>
                <Settings size={14} />
                模型设置
              </button>
              <button className="round-button">
                <Mic size={16} />
              </button>
              <button
                className={`send-button ${
                  composer.trim() ? "ready" : ""
                }`}
                onClick={onSend}
                aria-label="发送"
              >
                {composer.trim() ? (
                  <ArrowUp size={17} />
                ) : (
                  <AudioLines size={17} />
                )}
              </button>
            </div>
          </div>
        </SpotlightSurface>
        <div className="composer-note">
          Agent 生成结果需要在正式发布前审核。
        </div>
      </footer>
    </section>
  );
}

function EmptyWorkspace({
  onCreateProject,
  onImport,
  onOpenSettings,
}: {
  onCreateProject: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <FadeContent className="empty-main-state">
      <span className="empty-mark">
        <Clapperboard size={22} />
      </span>
      <h1>开始你的第一个漫剧项目</h1>
      <p>创建空项目，或直接导入小说开始。</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={onImport}>
          <FileUp size={15} />
          导入小说
        </button>
        <button className="secondary-button" onClick={onCreateProject}>
          <Plus size={15} />
          新建项目
        </button>
        <button className="secondary-button" onClick={onOpenSettings}>
          <Settings size={15} />
          打开设置
        </button>
      </div>
    </FadeContent>
  );
}

function EmptyThread({
  projectName,
  onImport,
  onOpenSettings,
}: {
  projectName: string;
  onImport: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <FadeContent className="empty-main-state compact">
      <span className="empty-mark">
        <MessageSquareText size={21} />
      </span>
      <h1>{projectName}</h1>
      <p>输入任务开始对话，或向项目添加原著文件。</p>
      <div className="empty-actions">
        <button className="secondary-button" onClick={onImport}>
          <FileUp size={15} />
          导入小说
        </button>
        <button className="secondary-button" onClick={onOpenSettings}>
          <Settings size={15} />
          检查模型设置
        </button>
      </div>
    </FadeContent>
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

function ModelSettingsView({
  configs,
  activeKind,
  testState,
  rightOpen,
  onChangeKind,
  onChange,
  onTest,
  onSaved,
  onToggleRight,
}: {
  configs: ModelConfigs;
  activeKind: ModelKind;
  testState: {
    loading: boolean;
    kind?: "success" | "error";
    text?: string;
  };
  rightOpen: boolean;
  onChangeKind: (kind: ModelKind) => void;
  onChange: <K extends keyof ModelConfig>(
    kind: ModelKind,
    key: K,
    value: ModelConfig[K],
  ) => void;
  onTest: () => void;
  onSaved: () => void;
  onToggleRight: () => void;
}) {
  const config = configs[activeKind];
  return (
    <section className="settings-view">
      <header className="center-header">
        <div className="center-title">
          <strong>设置</strong>
          <span>本地工作区与模型服务</span>
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

      <div className="settings-scroll">
        <SpotlightSurface className="settings-page">
          <nav className="model-tabs" aria-label="模型服务类型">
            <div className="settings-nav-label">模型服务</div>
            <ModelTab
              active={activeKind === "chat"}
              enabled={configs.chat.enabled}
              icon={<MessageSquareText size={16} />}
              label="对话模型"
              description="小说分析和 Agent 对话"
              onClick={() => onChangeKind("chat")}
            />
            <ModelTab
              active={activeKind === "image"}
              enabled={configs.image.enabled}
              icon={<ImageIcon size={16} />}
              label="生图模型"
              description="角色、场景和分镜素材"
              onClick={() => onChangeKind("image")}
            />
            <ModelTab
              active={activeKind === "video"}
              enabled={configs.video.enabled}
              icon={<Video size={16} />}
              label="视频模型"
              description="图生视频和镜头动态化"
              onClick={() => onChangeKind("video")}
            />
          </nav>

          <div key={activeKind} className="model-form view-transition">
            <div className="model-form-heading">
              <div>
                <h2>{config.label}</h2>
                <p>配置由你提供，客户端不会预设真实模型或密钥。</p>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(event) =>
                    onChange(
                      activeKind,
                      "enabled",
                      event.target.checked,
                    )
                  }
                />
                <span />
                启用
              </label>
            </div>

            <div className="form-grid">
              <div className="field">
                <span>接口协议</span>
                <CustomSelect
                  label="接口协议"
                  value={config.provider}
                  options={[
                    "OpenAI 兼容",
                    "自定义 REST",
                    ...(activeKind === "image" ? ["ComfyUI"] : []),
                  ]}
                  onChange={(value) =>
                    onChange(
                      activeKind,
                      "provider",
                      value,
                    )
                  }
                />
              </div>

              <label className="field">
                <span>模型 ID</span>
                <input
                  value={config.model}
                  onChange={(event) =>
                    onChange(
                      activeKind,
                      "model",
                      event.target.value,
                    )
                  }
                  placeholder="输入模型 ID"
                  spellCheck={false}
                />
              </label>

              <label className="field span-2">
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

              <label className="field span-2">
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
                <span>API Key</span>
                <div className="secret-field">
                  <KeyRound size={15} />
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(event) =>
                      onChange(
                        activeKind,
                        "apiKey",
                        event.target.value,
                      )
                    }
                    placeholder="输入你自己的 API Key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
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
                  rows={5}
                  spellCheck={false}
                  placeholder='{"X-Custom-Header":"value"}'
                />
              </label>
            </div>

            <div className="model-form-actions">
              <button
                className="secondary-button"
                onClick={onTest}
                disabled={testState.loading}
              >
                {testState.loading ? (
                  <RotateCcw size={14} className="spin" />
                ) : (
                  <Link2 size={14} />
                )}
                {testState.loading ? "正在测试" : "测试连接"}
              </button>
              <button className="primary-button" onClick={onSaved}>
                <Save size={14} />
                保存配置
              </button>
              {testState.text && (
                <span
                  className={`test-result ${testState.kind ?? ""}`}
                >
                  {testState.kind === "success" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                  {testState.text}
                </span>
              )}
            </div>

            <p className="security-note">
              当前开发版配置保存在本机应用数据中。正式发布前应将 API
              Key 迁移到系统凭据存储。
            </p>
          </div>
        </SpotlightSurface>
      </div>
    </section>
  );
}

function ModelTab({
  active,
  enabled,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  enabled: boolean;
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
      <i className={enabled ? "enabled" : ""} />
    </button>
  );
}

function RightSidebar({
  project,
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
          <strong>项目资源</strong>
          <span>{project?.name ?? "尚未选择项目"}</span>
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
              title="尚未选择项目"
              description="创建项目后管理相关资源"
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
              {resource.size && (
                <small>{formatBytes(resource.size)}</small>
              )}
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
  onClose,
  onSelectProject,
  onSelectThread,
  onSelectResource,
}: {
  projects: Project[];
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onSelectResource: (projectId: string, resourceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [closing, setClosing] = useState(false);

  const allItems = useMemo<WorkspaceSearchItem[]>(
    () =>
      projects
        .flatMap((project) => [
          {
            id: `project-${project.id}`,
            kind: "project" as const,
            title: project.name,
            meta: `${project.threads.length} 个对话 · ${project.resources.length} 个文件`,
            timestamp: project.updatedAt,
            projectId: project.id,
          },
          ...project.threads.map((thread) => ({
            id: `thread-${thread.id}`,
            kind: "thread" as const,
            title: thread.title,
            meta: project.name,
            timestamp: thread.updatedAt,
            projectId: project.id,
            threadId: thread.id,
          })),
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
        ])
        .sort((left, right) => right.timestamp - left.timestamp),
    [projects],
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
        onSelectProject(item.projectId);
      } else if (item.kind === "thread" && item.threadId) {
        onSelectThread(item.projectId, item.threadId);
      } else if (item.kind === "resource" && item.resourceId) {
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
            placeholder="搜索项目、对话和文件"
            aria-label="搜索项目、对话和文件"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="search-results" role="listbox">
          {results.length === 0 ? (
            <FadeContent className="search-empty">
              <Search size={22} />
              <strong>
                {projects.length === 0
                  ? "工作区还没有可搜索内容"
                  : "没有找到相关内容"}
              </strong>
              <span>
                {projects.length === 0
                  ? "创建项目或导入小说后，可在这里快速查找"
                  : "尝试输入其他项目、对话或文件名称"}
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
                        ? "项目"
                        : item.kind === "thread"
                          ? "对话"
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

function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const requestCreate = () => {
    if (!name.trim() || closing) return;
    setClosing(true);
    window.setTimeout(() => onCreate(name), 180);
  };
  return (
    <div
      className={`modal-backdrop ${closing ? "closing" : ""}`}
      onMouseDown={requestClose}
    >
      <section
        className="small-dialog ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建项目"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>新建项目</strong>
            <span>创建一个空的漫剧制作空间</span>
          </div>
          <button className="icon-button" onClick={requestClose}>
            <X size={16} />
          </button>
        </header>
        <label className="field">
          <span>项目名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") requestCreate();
              if (event.key === "Escape") requestClose();
            }}
            placeholder="输入项目名称"
          />
        </label>
        <footer>
          <button className="secondary-button" onClick={requestClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!name.trim()}
            onClick={requestCreate}
          >
            创建项目
          </button>
        </footer>
      </section>
    </div>
  );
}

function ResourcePreview({
  resource,
  onClose,
}: {
  resource: ProjectResource;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
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
        aria-label={`预览 ${resource.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{resource.name}</strong>
            <span>
              {resource.category}
              {resource.size ? ` · ${formatBytes(resource.size)}` : ""}
            </span>
          </div>
          <button className="icon-button" onClick={requestClose}>
            <X size={17} />
          </button>
        </header>
        <div className="preview-body">
          {resource.kind === "text" ? (
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
