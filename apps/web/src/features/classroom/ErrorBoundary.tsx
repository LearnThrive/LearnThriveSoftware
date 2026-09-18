import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState { hasError: boolean }

/** Catches render-phase errors so a bug shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[LearnThrive][app] Unexpected UI error', error, info.componentStack);
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="app-error">
        <div className="app-error-card">
          <h1>Something went wrong.</h1>
          <p>An unexpected error interrupted this page. If your camera or microphone light is still on, reloading will release them.</p>
          <button type="button" className="button button-primary" onClick={this.reload}>Reload the page</button>
        </div>
      </div>
    );
  }
}
