import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Catches render-time exceptions inside a module so a single bad payload can never
 * blank the entire console. Without this, one undefined field unmounts the whole tree
 * and the operator loses access to every other module.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // In production this is where you'd forward to Sentry/Datadog.
    console.error('[module-boundary]', this.props.moduleName, error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="rounded-xl border border-red-200 bg-white p-6 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
            <AlertTriangle size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">
              {this.props.moduleName || 'This module'} hit an unexpected error
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              The rest of the console is unaffected. Reset the module to try again — if it recurs, the response
              payload may not match the contract.
            </p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[10.5px] leading-relaxed text-red-300">
              {String(error?.message || error)}
            </pre>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-700"
            >
              <RotateCcw size={13} /> Reset module
            </button>
          </div>
        </div>
      </div>
    );
  }
}
