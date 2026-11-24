import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Naba Studio UI boundary caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#180E15] text-[#F9F1F4] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#654354] bg-[#27131F] p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#F07883]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold">حدث خطأ غير متوقع / Unexpected Error</h1>
            </div>
            <p className="text-sm text-[#C8B7C0] leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-[#F9F1F4] text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              إعادة تحميل الأستوديو / Reload Studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
