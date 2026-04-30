/**
 * Side-effect classification reused across all tools.
 * See `.cursor/rules/03-mcp-tool-rules.mdc`.
 */
export type SideEffect = "read-only" | "draft" | "mutating" | "destructive";

/**
 * Visibility flag controlling whether the tool is exposed to the model.
 * Tools whose primary surface is the MCP Apps UI should be `app` only.
 */
export type Visibility = "model" | "app";

export interface ToolMeta {
  name: string;
  sideEffect: SideEffect;
  visibility: Visibility;
  /** Phase number where the tool was introduced. Used for changelog/version assertions. */
  introducedInPhase: number;
}

export interface ToolDefinition {
  meta: ToolMeta;
}
