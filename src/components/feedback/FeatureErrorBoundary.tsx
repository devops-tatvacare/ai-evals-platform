import { Component, type ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';
import { logger } from '@/services/logger';

interface Props {
  children: ReactNode;
  featureName: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class FeatureErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(`Error in ${this.props.featureName}`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
          title={`Error in ${this.props.featureName}`}
          compact
        />
      );
    }

    return this.props.children;
  }
}
