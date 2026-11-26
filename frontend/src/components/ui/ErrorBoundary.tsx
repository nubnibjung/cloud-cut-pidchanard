import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';
import { LottieIllustration } from './LottieIllustration';
import { EmptyState } from './Feedback';

interface Props {
  children: ReactNode;
  /** Offered as a way out, e.g. back to the project list. */
  onExit?(): void;
  exitLabel?: string;
}

/** Keeps a crash in one screen from blanking the whole app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          large
          icon={<LottieIllustration name="error" className="-my-10 h-64 w-[26rem] max-w-[90vw]" />}
          title="Something went wrong"
          description="Your saved work is safe. Try again, or go back and reopen the project."
          action={
            <div className="flex gap-2">
              {this.props.onExit && (
                <Button onClick={() => { this.setState({ error: null }); this.props.onExit?.(); }}>
                  {this.props.exitLabel ?? 'Go back'}
                </Button>
              )}
              <Button variant="primary" onClick={() => this.setState({ error: null })}>Try again</Button>
            </div>
          }
        />
      </div>
    );
  }
}
