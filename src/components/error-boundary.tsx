/**
 * src/components/error-boundary.tsx — v76.2 Phase 26.1
 *
 * React Error Boundary that catches render errors and shows a
 * user-friendly message instead of a blank screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <DashboardContent />
 *   </ErrorBoundary>
 */

"use client";

import React, { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode;
  /** Called when an error is caught — for logging to blackbox */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for development + call the onError callback if provided.
    console.error("[ErrorBoundary] Caught:", error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    // Best-effort: log to the app's blackbox endpoint.
    fetch("/api/blackbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack?.slice(0, 500),
        componentStack: errorInfo.componentStack?.slice(0, 500),
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => { /* best-effort */ });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-amber-500" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Something went wrong</h2>
              <p className="text-sm text-slate-500 mt-1">
                {this.state.error?.message?.slice(0, 200) || "An unexpected error occurred."}
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={this.handleRetry} variant="default" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
              <Button onClick={() => window.location.reload()} variant="outline" size="sm">
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
