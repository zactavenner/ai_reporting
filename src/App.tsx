import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DateFilterProvider } from "@/contexts/DateFilterContext";
import { PasswordGate } from "@/components/auth/PasswordGate";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Loader2 } from "lucide-react";

// Auto-retry dynamic imports on failure (handles stale cache after deploys)
function lazyRetry(fn: () => Promise<any>) {
  return lazy(() => fn().catch(() => {
    const key = 'chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
    sessionStorage.removeItem(key);
    return fn();
  }));
}

// Core reporting pages (lazy-loaded for code-splitting)
const Index = lazyRetry(() => import("./pages/Index"));
const ClientDetail = lazyRetry(() => import("./pages/ClientDetail"));
const ClientRecords = lazyRetry(() => import("./pages/ClientRecords"));
const PublicReport = lazyRetry(() => import("./pages/PublicReport"));
const NotFound = lazyRetry(() => import("./pages/NotFound"));
const PublicCreatives = lazyRetry(() => import("./pages/PublicCreatives"));
const PublicTaskUrl = lazyRetry(() => import("./pages/PublicTaskUrl"));
const SheetsHealthPage = lazyRetry(() => import("./pages/SheetsHealthPage"));
const ClientProjectsPage = lazyRetry(() => import("./pages/ClientProjectsPage"));
const ProjectPage = lazyRetry(() => import("./pages/ProjectPage"));
const OfferDetailPage = lazyRetry(() => import("./pages/OfferDetailPage"));
const FundAdStudioPage = lazyRetry(() => import("./pages/FundAdStudioPage"));
const GhlWorkflowsPage = lazyRetry(() => import("./pages/GhlWorkflowsPage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DateFilterProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Protected routes - require password */}
            <Route path="/" element={<PasswordGate><Index /></PasswordGate>} />
            <Route path="/client/:clientId" element={<PasswordGate><ClientDetail /></PasswordGate>} />
            <Route path="/client/:clientId/records" element={<PasswordGate><ClientRecords /></PasswordGate>} />
            <Route path="/client/:clientId/offer/:offerId" element={<PasswordGate><OfferDetailPage /></PasswordGate>} />
            <Route path="/sheets-health" element={<PasswordGate><SheetsHealthPage /></PasswordGate>} />
            <Route path="/projects" element={<PasswordGate><ClientProjectsPage /></PasswordGate>} />
            <Route path="/projects/:projectId" element={<PasswordGate><ProjectPage /></PasswordGate>} />
            <Route path="/fundad-studio" element={<PasswordGate><FundAdStudioPage /></PasswordGate>} />
            <Route path="/ghl-workflows" element={<PasswordGate><GhlWorkflowsPage /></PasswordGate>} />

            {/* Public routes - no password required */}
            <Route path="/public/:token" element={<PublicReport />} />
            <Route path="/public/:token/creatives" element={<PublicCreatives />} />
            <Route path="/taskurl" element={<PublicTaskUrl />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </DateFilterProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;