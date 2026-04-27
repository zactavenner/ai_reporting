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
const DatabaseView = lazyRetry(() => import("./pages/DatabaseView"));
const PublicReport = lazyRetry(() => import("./pages/PublicReport"));
const SpamBlacklist = lazyRetry(() => import("./pages/SpamBlacklist"));
const NotFound = lazyRetry(() => import("./pages/NotFound"));
const ClientCreatives = lazyRetry(() => import("./pages/ClientCreatives"));
const PublicCreatives = lazyRetry(() => import("./pages/PublicCreatives"));
const MetaAdsOverlay = lazyRetry(() => import("./pages/MetaAdsOverlay"));
const CreativeBriefs = lazyRetry(() => import("./pages/CreativeBriefs"));
const QuizPage = lazyRetry(() => import("./pages/QuizPage"));
const PublicUpload = lazyRetry(() => import("./pages/PublicUpload"));

// Creative tools pages (from ad-verse-ally)
const StaticAdsPage = lazyRetry(() => import("./pages/StaticAdsPage"));
const StaticCreativesPage = lazyRetry(() => import("./pages/StaticCreativesPage"));
const BatchVideoPage = lazyRetry(() => import("./pages/BatchVideoPage"));
const AdScrapingPage = lazyRetry(() => import("./pages/AdScrapingPage"));
const AdVariationsPage = lazyRetry(() => import("./pages/AdVariationsPage"));
const AvatarsPage = lazyRetry(() => import("./pages/AvatarsPage"));
const BrollPage = lazyRetry(() => import("./pages/BrollPage"));
const VideoEditorPage = lazyRetry(() => import("./pages/VideoEditorPage"));
const AvatarAdGeneratorPage = lazyRetry(() => import("./pages/AvatarAdGeneratorPage"));
const InstagramIntelPage = lazyRetry(() => import("./pages/InstagramIntelPage"));
const HistoryPage = lazyRetry(() => import("./pages/HistoryPage"));
const ExportHubPage = lazyRetry(() => import("./pages/ExportHubPage"));
const ClientProjectsPage = lazyRetry(() => import("./pages/ClientProjectsPage"));
const ProjectPage = lazyRetry(() => import("./pages/ProjectPage"));
const OfferDetailPage = lazyRetry(() => import("./pages/OfferDetailPage"));

// Funnel Builder pages
const FunnelBuilderPage = lazyRetry(() => import("./pages/FunnelBuilderPage"));
const FunnelBookingPage = lazyRetry(() => import("./pages/FunnelBookingPage"));
const FunnelOnboardingPage = lazyRetry(() => import("./pages/FunnelOnboardingPage"));
const FunnelAdminPage = lazyRetry(() => import("./pages/FunnelAdminPage"));
const FunnelClientPage = lazyRetry(() => import("./pages/FunnelClientPage"));
const FunnelDeckPage = lazyRetry(() => import("./pages/FunnelDeckPage"));
const FunnelFulfillmentPage = lazyRetry(() => import("./pages/FunnelFulfillmentPage"));
const FunnelInvestPage = lazyRetry(() => import("./pages/FunnelInvestPage"));
const FunnelKickoffPage = lazyRetry(() => import("./pages/FunnelKickoffPage"));
const FunnelAccessPage = lazyRetry(() => import("./pages/FunnelAccessPage"));
const SyncHealthPage = lazyRetry(() => import("./pages/SyncHealthPage"));
const SheetsHealthPage = lazyRetry(() => import("./pages/SheetsHealthPage"));
const DailyReportPage = lazyRetry(() => import("./pages/DailyReportPage"));
const DailyReportThankYouPage = lazyRetry(() => import("./pages/DailyReportThankYouPage"));
const ClientOnboardingPage = lazyRetry(() => import("./pages/ClientOnboardingPage"));
const FulfillmentReviewPage = lazyRetry(() => import("./pages/FulfillmentReviewPage"));

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
            <Route path="/client/:clientId/creatives" element={<PasswordGate><ClientCreatives /></PasswordGate>} />
            <Route path="/client/:clientId/offer/:offerId" element={<PasswordGate><OfferDetailPage /></PasswordGate>} />
            <Route path="/database" element={<PasswordGate><DatabaseView /></PasswordGate>} />
            <Route path="/spam-blacklist" element={<PasswordGate><SpamBlacklist /></PasswordGate>} />
            <Route path="/sync-health" element={<PasswordGate><SyncHealthPage /></PasswordGate>} />
            <Route path="/sheets-health" element={<PasswordGate><SheetsHealthPage /></PasswordGate>} />
            <Route path="/daily" element={<PasswordGate><DailyReportPage /></PasswordGate>} />
            <Route path="/daily/thank-you" element={<PasswordGate><DailyReportThankYouPage /></PasswordGate>} />
            <Route path="/briefs" element={<PasswordGate><CreativeBriefs /></PasswordGate>} />

            {/* Creative Tools - from ad-verse-ally */}
            <Route path="/static-ads" element={<PasswordGate><StaticCreativesPage /></PasswordGate>} />
            <Route path="/static-creatives" element={<PasswordGate><StaticCreativesPage /></PasswordGate>} />
            <Route path="/batch-video" element={<PasswordGate><BatchVideoPage /></PasswordGate>} />
            <Route path="/ad-scraping" element={<PasswordGate><AdScrapingPage /></PasswordGate>} />
            <Route path="/ad-variations" element={<PasswordGate><AdVariationsPage /></PasswordGate>} />
            <Route path="/avatars" element={<PasswordGate><AvatarsPage /></PasswordGate>} />
            <Route path="/broll" element={<PasswordGate><BrollPage /></PasswordGate>} />
            <Route path="/video-editor" element={<PasswordGate><VideoEditorPage /></PasswordGate>} />
            <Route path="/avatar-ad-generator" element={<PasswordGate><AvatarAdGeneratorPage /></PasswordGate>} />
            <Route path="/instagram-intel" element={<PasswordGate><InstagramIntelPage /></PasswordGate>} />
            <Route path="/history" element={<PasswordGate><HistoryPage /></PasswordGate>} />
            <Route path="/export" element={<PasswordGate><ExportHubPage /></PasswordGate>} />
            <Route path="/projects" element={<PasswordGate><ClientProjectsPage /></PasswordGate>} />
            <Route path="/projects/:projectId" element={<PasswordGate><ProjectPage /></PasswordGate>} />

            {/* Funnel Builder - from aicapitalraising */}
            <Route path="/funnel-builder" element={<PasswordGate><FunnelBuilderPage /></PasswordGate>} />
            <Route path="/funnel/:clientId/booking" element={<FunnelBookingPage />} />
            <Route path="/funnel/:clientId/onboarding" element={<FunnelOnboardingPage />} />
            <Route path="/funnel/:clientId/admin" element={<PasswordGate><FunnelAdminPage /></PasswordGate>} />
            <Route path="/funnel/:clientId/client" element={<FunnelClientPage />} />
            <Route path="/funnel/:clientId/deck" element={<FunnelDeckPage />} />
            <Route path="/funnel/:clientId/fulfillment" element={<PasswordGate><FunnelFulfillmentPage /></PasswordGate>} />
            <Route path="/funnel/:clientId/invest" element={<FunnelInvestPage />} />
            <Route path="/funnel/:clientId/kickoff" element={<FunnelKickoffPage />} />
            <Route path="/funnel/:clientId/access" element={<FunnelAccessPage />} />

            {/* Onboarding & Fulfillment */}
            <Route path="/onboarding" element={<ClientOnboardingPage />} />
            <Route path="/fulfillment-review/:clientId" element={<PasswordGate><FulfillmentReviewPage /></PasswordGate>} />

            {/* Public routes - no password required */}
            <Route path="/public/:token" element={<PublicReport />} />
            <Route path="/public/:token/creatives" element={<PublicCreatives />} />
            <Route path="/upload/:token" element={<PublicUpload />} />
            <Route path="/quiz/:slug" element={<QuizPage />} />
            <Route path="/meta-overlay" element={<MetaAdsOverlay />} />

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