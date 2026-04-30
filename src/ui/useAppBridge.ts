import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal MCP Apps host bridge.
 *
 * We avoid a hard dependency on `@modelcontextprotocol/ext-apps/react` so
 * the same bundle works in the official Apps host *and* in standalone
 * preview (e.g. when the operator opens `dist/ui/dashboard.html` directly
 * to debug). When the bridge is missing, all tool calls go through a stub
 * that resolves with empty data — this is the official "fallback when
 * unsupported" pattern.
 */

export type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
} | null;

export interface AppBridge<T> {
  state: T;
  setState(updater: (current: T) => T): void;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  updateModelContext(context: Record<string, unknown>): void;
  /** True iff a real MCP Apps host bridge was detected (window.mcpApps). */
  hasHost: boolean;
}

interface HostBridge {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  setView?(state: unknown): void;
  updateModelContext?(context: Record<string, unknown>): void;
  onStateChange?(handler: (state: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** MCP Apps host bridge. Injected by the host iframe wrapper. */
    mcpApps?: HostBridge;
  }
}

export function useAppBridge<T>(initial: T): AppBridge<T> {
  const [state, setStateInternal] = useState<T>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hasHost = typeof window !== "undefined" && !!window.mcpApps;

  const setState = useCallback((updater: (current: T) => T) => {
    setStateInternal((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      window.mcpApps?.setView?.(next);
      return next;
    });
  }, []);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const bridge = window.mcpApps;
      if (!bridge) {
        // Standalone preview: emit a console hint and return a placeholder
        // result so the UI keeps rendering. Operators see this when they
        // open `dist/ui/dashboard.html` outside an Apps host.
        // eslint-disable-next-line no-console
        console.info(`[mcp-apps fallback] ${name}`, args);
        return { content: [{ type: "text", text: "preview mode" }], structuredContent: null };
      }
      try {
        return await bridge.callTool(name, args);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: (err as Error).message }],
        };
      }
    },
    [],
  );

  const updateModelContext = useCallback((context: Record<string, unknown>) => {
    window.mcpApps?.updateModelContext?.(context);
  }, []);

  // Sync host-pushed state back into React.
  useEffect(() => {
    const bridge = window.mcpApps;
    if (!bridge?.onStateChange) return;
    return bridge.onStateChange((incoming) => {
      if (incoming && typeof incoming === "object") {
        setStateInternal((prev) => ({ ...prev, ...(incoming as Partial<T>) }));
      }
    });
  }, []);

  return { state, setState, callTool, updateModelContext, hasHost };
}
