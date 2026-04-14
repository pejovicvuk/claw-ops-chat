export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  type: "text" | "tool_use" | "tool_result" | "thinking" | "permission_request" | "ask_question" | "error";
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: string;
  isError?: boolean;
  timestamp: number;
  /** For permission_request messages */
  permissionId?: string;
  permissionInput?: Record<string, unknown>;
  permissionResolved?: boolean;
  permissionAllowed?: boolean;
  /** For ask_question messages */
  askId?: string;
  askQuestions?: AskQuestionItem[];
  askResolved?: boolean;
}

export type ClaudeStatus =
  | "disconnected"
  | "connecting"
  | "idle"
  | "thinking"
  | "tool_running"
  | "awaiting_permission"
  | "awaiting_input";

export interface ActiveToolInfo {
  name: string;
  callId: string;
}

export interface AskQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface ChatSession {
  sessionId: string;
  display: string;
  timestamp: number;
}

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}
