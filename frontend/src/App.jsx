import { useCallback, useMemo, useState } from 'react';
import Navbar from './components/Navbar';
import Sidebar, { MODULES } from './components/Sidebar';
import Overview from './components/Overview';
import SafetyMonitor from './components/SafetyMonitor';
import CrackAnalyzer from './components/CrackAnalyzer';
import ValuationPlanner from './components/ValuationPlanner';
import WeatherAdvisory from './components/WeatherAdvisory';
import AssistantChat from './components/AssistantChat';
import ErrorBoundary from './components/ErrorBoundary';
import { Button } from './components/ui/Primitives';
import { useBackendHealth } from './hooks/useAsync';
import { ViewModeProvider, useViewMode } from './lib/viewMode';
import { WifiOff, X } from 'lucide-react';

export default function App() {
  return (
    <ViewModeProvider>
      <AppShell />
    </ViewModeProvider>
  );
}

function AppShell() {
  const [active, setActive] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { health, offline, refresh } = useBackendHealth(30_000);
  const { isExpert } = useViewMode();

  const activeModule = useMemo(() => MODULES.find((m) => m.id === active), [active]);

  const navigate = useCallback((id) => {
    setActive(id);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const requireBackend = useCallback(() => {
    setBannerDismissed(false);
    refresh();
  }, [refresh]);

  const renderModule = () => {
    switch (active) {
      case 'safety':
        return <SafetyMonitor onRequireBackend={requireBackend} />;
      case 'crack':
        return <CrackAnalyzer onRequireBackend={requireBackend} />;
      case 'valuation':
        return <ValuationPlanner onRequireBackend={requireBackend} />;
      case 'weather':
        return <WeatherAdvisory onRequireBackend={requireBackend} />;
      case 'assistant':
        return <AssistantChat onRequireBackend={requireBackend} />;
      default:
        return <Overview health={health} offline={offline} onNavigate={navigate} />;
    }
  };

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <Sidebar
        active={active}
        onNavigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        health={health}
        offline={offline}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          health={health}
          offline={offline}
          activeModule={activeModule}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <main className="flex-1 overflow-x-hidden px-4 py-5 lg:px-7 lg:py-6">
          {offline && !bannerDismissed ? (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5">
              <WifiOff size={17} className="mt-0.5 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-800">
                  {isExpert ? 'API connection lost' : 'We cannot reach the system right now'}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                  {isExpert ? (
                    <>
                      Requests will fail until the backend is reachable. Start it with{' '}
                      <code className="rounded bg-white/70 px-1 font-mono text-[11px]">
                        uvicorn main:app --reload --port 8000
                      </code>{' '}
                      inside <code className="rounded bg-white/70 px-1 font-mono text-[11px]">backend/</code>.
                    </>
                  ) : (
                    'Anything you tap will fail until it is back. Try again in a moment, or ask your site manager to restart the system.'
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={refresh}>
                  Retry
                </Button>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  className="grid h-7 w-7 place-items-center rounded text-red-400 hover:bg-red-100"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}

          {active !== 'overview' && isExpert ? (
            <div className="mb-3 hidden items-center gap-1.5 text-[11px] text-slate-400 lg:flex">
              <button type="button" onClick={() => navigate('overview')} className="hover:text-slate-600">
                Workspace
              </button>
              <span>/</span>
              <span className="font-medium text-slate-600">{activeModule?.label}</span>
            </div>
          ) : null}

          <div key={active} className="animate-fade-up">
            <ErrorBoundary moduleName={activeModule?.label}>{renderModule()}</ErrorBoundary>
          </div>
        </main>

        <footer className="border-t border-slate-200/80 bg-white px-4 py-3 lg:px-6">
          <div className="flex flex-col items-start justify-between gap-1.5 text-[10px] text-slate-400 sm:flex-row sm:items-center">
            {isExpert ? (
              <p>
                Multimodal Construction Intelligence Platform · v{health?.version || '1.0.0'} ·{' '}
                {health ? `${health.provider}/${health.model}` : 'engine unknown'}
              </p>
            ) : (
              <p>Construction Intelligence · easy site checks</p>
            )}
            <p className="flex items-center gap-2">
              {isExpert ? (
                <>
                  <span className="font-mono">{health ? `${health.knowledge_chunks} KB chunks` : '—'}</span>
                  <span>·</span>
                </>
              ) : null}
              <span>Decision support only — verify on site.</span>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
