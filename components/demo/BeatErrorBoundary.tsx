'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type BeatErrorBoundaryProps = {
  beatId: string;
  children: ReactNode;
  fallback: ReactNode;
};

type BeatErrorBoundaryState = {
  hasError: boolean;
};

export class BeatErrorBoundary extends Component<BeatErrorBoundaryProps, BeatErrorBoundaryState> {
  state: BeatErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): BeatErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[demo] Beat ${this.props.beatId} render failed; showing static fallback.`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
