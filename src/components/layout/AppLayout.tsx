import { ReactNode, useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Users, Sparkles, Settings, BarChart3, Menu, X, ChevronRight, FileSpreadsheet, FolderKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppLayoutProps {
  children: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

const navSections = [
  {
    label: 'Reporting',
    items: [
      { path: '/', label: 'Clients', icon: Users },
      { path: '/sheets-health', label: 'Sheets Health', icon: FileSpreadsheet },
    ],
  },
  {
    label: 'Work',
    items: [
      { path: '/projects', label: 'Projects & Tasks', icon: FolderKanban },
    ],
  },
];

export function AppLayout({ children, breadcrumbs }: AppLayoutProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setSidebarOpen(false);
      setIsNavigating(true);
      const t = setTimeout(() => setIsNavigating(false), 400);
      prevPathRef.current = location.pathname;
      return () => clearTimeout(t);
    }
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] bg-primary/30 overflow-hidden">
          <div className="h-full w-1/3 bg-primary animate-progress-bar" />
        </div>
      )}

      {isMobile && (
        <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-card px-4">
          <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="font-bold">Capital Creative</span>
        </header>
      )}

      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-64 border-r border-border bg-card transition-transform duration-300 ease-out',
          isMobile && !sidebarOpen && '-translate-x-full',
          isMobile && sidebarOpen && 'translate-x-0'
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-border px-6">
            <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">Capital Creative</span>
            </Link>
            {isMobile && (
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => setSidebarOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto p-4 space-y-5">
            {navSections.map((section) => (
              <div key={section.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-3 mb-1.5">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 min-h-[40px]',
                          isActive
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary-foreground rounded-r-full" />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-border p-4">
            <p className="text-xs text-muted-foreground">Powered by AI Video Generation</p>
          </div>
        </div>
      </aside>

      <main className={cn('flex-1', isMobile ? 'pt-14' : 'ml-64')}>
        <div className="min-h-screen p-4 md:p-6">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4 animate-fade-in">
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  {crumb.href ? (
                    <Link to={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                  ) : (
                    <span className="text-foreground font-medium">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <div className="animate-fade-in">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
