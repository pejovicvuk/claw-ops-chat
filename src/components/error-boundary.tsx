"use client";

import { Component, type ReactNode } from "react";
import { FiAlertOctagon, FiRefreshCw } from "react-icons/fi";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label shown in the fallback UI ("the file editor", "the file list"). */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep a single console line — the fallback UI tells the user what to do.
    console.error("[ErrorBoundary]", this.props.label ?? "unlabeled", error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return (
      <div
        role="alert"
        className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center"
      >
        <FiAlertOctagon size={22} className="text-red-400" />
        <p className="text-[13px] font-medium text-canvas-fg">
          Something broke in {this.props.label ?? "this section"}.
        </p>
        <p className="max-w-[320px] text-[11px] text-canvas-muted">
          {this.state.error.message || "Unknown error"}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-2 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
        >
          <FiRefreshCw size={11} />
          Try again
        </button>
      </div>
    );
  }
}
