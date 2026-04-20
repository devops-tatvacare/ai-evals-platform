import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { MainLayout } from "@/components/layout";
import {
  VoiceRxSettingsPage,
  VoiceRxDashboard,
  VoiceRxRunList,
  VoiceRxRunDetail,
} from "@/features/voiceRx";
import { AppEvaluatorsPage } from '@/features/evals';
import {
  KairaBotSettingsPage,
  TagManagementPage,
} from "@/features/kairaBotSettings";
import {
  EvalDashboard,
  EvalRunList,
  EvalRunDetail,
  EvalThreadDetailV2,
  EvalAdversarialDetailV2,
  EvalLogs,
} from "@/features/evalRuns";
import { LoginPage, SignupPage, AuthGuard, AdminGuard, RequirePermission } from "@/features/auth";
import { AppAccessGuard } from "@/components/auth/PermissionGate";
import { AdminUsersPage } from "@/features/admin";
import {
  InsideSalesListing,
  InsideSalesEvaluators,
  InsideSalesEvaluatorDetail,
  InsideSalesRunList,
  InsideSalesRunDetail,
  InsideSalesDashboard,
  InsideSalesCallDetail,
  InsideSalesSettings,
  InsideSalesLeadDetail,
} from "@/features/insideSales";
import { HomePage } from "./pages/HomePage";
import { ListingPage } from "./pages/ListingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { KairaBotHomePage } from "./pages/kaira";
import { routes } from "@/config/routes";

const GuidePage = lazy(() => import("@/features/guide"));
const AnalyticsLibraryPage = lazy(() => import('@/features/analytics/pages/AnalyticsLibraryPage').then(m => ({ default: m.AnalyticsLibraryPage })));
const AnalyticsChartDetail = lazy(() => import('@/features/analytics/pages/AnalyticsChartDetail').then(m => ({ default: m.AnalyticsChartDetail })));
const AnalyticsDashboardDetail = lazy(() => import('@/features/analytics/pages/AnalyticsDashboardDetail').then(m => ({ default: m.AnalyticsDashboardDetail })));
const CostPage = lazy(() => import('@/features/cost/pages/CostPage').then(m => ({ default: m.CostPage })));

function VoiceRxGuard() {
  return <AppAccessGuard app="voice-rx"><Outlet /></AppAccessGuard>;
}

function KairaBotGuard() {
  return <AppAccessGuard app="kaira-bot"><Outlet /></AppAccessGuard>;
}

function InsideSalesGuard() {
  return <AppAccessGuard app="inside-sales"><Outlet /></AppAccessGuard>;
}

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — login + signup */}
        <Route path={routes.login} element={<LoginPage />} />
        <Route path={routes.signup} element={<SignupPage />} />

        {/* Guide — full-page layout, lazy-loaded, behind auth */}
        <Route
          path={routes.guide}
          element={
            <AuthGuard>
              <Suspense fallback={null}>
                <GuidePage />
              </Suspense>
            </AuthGuard>
          }
        />

        {/* Protected routes — wrapped with AuthGuard + MainLayout */}
        <Route
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        >
          {/* Voice Rx routes */}
          <Route element={<VoiceRxGuard />}>
            <Route
              path={routes.voiceRx.home}
              element={<Navigate to={routes.voiceRx.dashboard} replace />}
            />
            <Route path={routes.voiceRx.upload} element={<HomePage />} />
            <Route path="/listing/:id" element={<ListingPage />} />
            <Route
              path={routes.voiceRx.dashboard}
              element={<VoiceRxDashboard />}
            />
            <Route
              path={routes.voiceRx.evaluators}
              element={<AppEvaluatorsPage />}
            />
            <Route path="/runs/:runId" element={<VoiceRxRunDetail />} />
            <Route path={routes.voiceRx.runs} element={<VoiceRxRunList />} />
            <Route path={routes.voiceRx.logs} element={<EvalLogs />} />
            <Route path={routes.voiceRx.analytics} element={<Suspense fallback={null}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/analytics/charts/:chartId" element={<Suspense fallback={null}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/analytics/dashboards/:dashboardId" element={<Suspense fallback={null}><AnalyticsDashboardDetail /></Suspense>} />
            <Route
              path={routes.voiceRx.settings}
              element={<RequirePermission action="configuration:edit"><VoiceRxSettingsPage /></RequirePermission>}
            />
          </Route>

          {/* Kaira Bot routes */}
          <Route element={<KairaBotGuard />}>
            <Route
              path={routes.kaira.home}
              element={<Navigate to={routes.kaira.dashboard} replace />}
            />
            <Route path="/kaira/chat/:chatId" element={<KairaBotHomePage />} />
            <Route path={routes.kaira.chat} element={<KairaBotHomePage />} />
            <Route
              path={routes.kaira.settings}
              element={<RequirePermission action="configuration:edit"><KairaBotSettingsPage /></RequirePermission>}
            />
            <Route
              path={routes.kaira.settingsTags}
              element={<TagManagementPage />}
            />

            {/* Kaira Evals routes */}
            <Route path={routes.kaira.dashboard} element={<EvalDashboard />} />
            <Route
              path={routes.kaira.evaluators}
              element={<AppEvaluatorsPage />}
            />
            <Route path={routes.kaira.runs} element={<EvalRunList />} />
            <Route path="/kaira/runs/:runId" element={<EvalRunDetail />} />
            <Route
              path="/kaira/runs/:runId/adversarial/:evalId"
              element={<EvalAdversarialDetailV2 />}
            />
            <Route
              path="/kaira/threads/:threadId"
              element={<EvalThreadDetailV2 />}
            />
            <Route path={routes.kaira.logs} element={<EvalLogs />} />
            <Route path={routes.kaira.analytics} element={<Suspense fallback={null}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/kaira/analytics/charts/:chartId" element={<Suspense fallback={null}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/kaira/analytics/dashboards/:dashboardId" element={<Suspense fallback={null}><AnalyticsDashboardDetail /></Suspense>} />
          </Route>

          {/* Inside Sales routes */}
          <Route element={<InsideSalesGuard />}>
            <Route path={routes.insideSales.listing} element={<InsideSalesListing />} />
            <Route path={routes.insideSales.evaluators} element={<InsideSalesEvaluators />} />
            <Route path="/inside-sales/evaluators/:id" element={<InsideSalesEvaluatorDetail />} />
            <Route path={routes.insideSales.runs} element={<InsideSalesRunList />} />
            <Route path="/inside-sales/runs/:runId" element={<InsideSalesRunDetail />} />
            <Route path="/inside-sales/runs/:runId/calls/:callId" element={<InsideSalesRunDetail />} />
            <Route path="/inside-sales/calls/:activityId" element={<InsideSalesCallDetail />} />
            <Route path="/inside-sales/leads/:prospectId" element={<InsideSalesLeadDetail />} />
            <Route path={routes.insideSales.dashboard} element={<InsideSalesDashboard />} />
            <Route path={routes.insideSales.logs} element={<EvalLogs />} />
            <Route path={routes.insideSales.settings} element={<RequirePermission action="configuration:edit"><InsideSalesSettings /></RequirePermission>} />
            <Route path={routes.insideSales.analytics} element={<Suspense fallback={null}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/inside-sales/analytics/charts/:chartId" element={<Suspense fallback={null}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/inside-sales/analytics/dashboards/:dashboardId" element={<Suspense fallback={null}><AnalyticsDashboardDetail /></Suspense>} />
          </Route>

          {/* Admin routes */}
          <Route
            path={routes.adminUsers}
            element={
              <AdminGuard>
                <AdminUsersPage />
              </AdminGuard>
            }
          />
          <Route
            path={routes.adminCost}
            element={
              <RequirePermission action="cost:view">
                <Suspense fallback={null}>
                  <CostPage />
                </Suspense>
              </RequirePermission>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
