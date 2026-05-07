import { Suspense } from "react";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { MainLayout } from "@/components/layout";
import { LoadingState } from "@/components/ui";
import {
  VoiceRxSettingsPage,
  VoiceRxRunDetail,
} from "@/features/voiceRx";
import {
  KairaBotSettingsPage,
  TagManagementPage,
} from "@/features/kairaBotSettings";
import {
  EvalLogs,
  EvalRunList,
  EvalRunDetail,
  EvalThreadDetailV2,
  EvalAdversarialDetailV2,
  LogsEvaluationRunPage,
  LogsWorkflowActionPage,
  LogsWorkflowRunPage,
} from "@/features/evalRuns";
import { AppEvaluatorsPage, EvaluatorDetailPage } from "@/features/evals";
import { LoginPage, SignupPage, AuthGuard, AdminGuard, RequirePermission } from "@/features/auth";
import { AppAccessGuard } from "@/components/auth/PermissionGate";
import { AdminUsersPage, AdminSherlockPage, AdminSherlockToolCallPage } from "@/features/admin";
import {
  InsideSalesListing,
  InsideSalesRunDetail,
  InsideSalesCallDetail,
  InsideSalesSettings,
  InsideSalesLeadDetail,
} from "@/features/insideSales";
import { AnalyticsDashboardPage } from "@/features/analytics/AnalyticsDashboardPage";
import { ListingPage } from "./pages/ListingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { KairaBotHomePage } from "./pages/kaira";
import { routes } from "@/config/routes";
import { landingRouteForApp } from "@/config/sidebarNav";

const GuidePage = lazyWithRetry(() => import("@/features/guide"));
const AnalyticsLibraryPage = lazyWithRetry(() => import('@/features/analytics/pages/AnalyticsLibraryPage').then(m => ({ default: m.AnalyticsLibraryPage })));
const AnalyticsChartDetail = lazyWithRetry(() => import('@/features/analytics/pages/AnalyticsChartDetail').then(m => ({ default: m.AnalyticsChartDetail })));
const AnalyticsDashboardDetail = lazyWithRetry(() => import('@/features/analytics/pages/AnalyticsDashboardDetail').then(m => ({ default: m.AnalyticsDashboardDetail })));
const CostPage = lazyWithRetry(() => import('@/features/cost/pages/CostPage').then(m => ({ default: m.CostPage })));
const ScheduledJobsListPage = lazyWithRetry(() => import('@/features/admin/scheduledJobs/pages/ScheduledJobsListPage').then(m => ({ default: m.ScheduledJobsListPage })));
const WorkflowListPage = lazyWithRetry(() => import('@/features/orchestration/components/WorkflowListPage').then(m => ({ default: m.WorkflowListPage })));
const WorkflowBuilderPage = lazyWithRetry(() => import('@/features/orchestration/components/WorkflowBuilderPage').then(m => ({ default: m.WorkflowBuilderPage })));
const CampaignRunsPage = lazyWithRetry(() => import('@/features/orchestration/components/CampaignRunsPage').then(m => ({ default: m.CampaignRunsPage })));
const LegacyRunDetailRedirect = lazyWithRetry(() => import('@/features/orchestration/components/runs/LegacyRunDetailRedirect').then(m => ({ default: m.LegacyRunDetailRedirect })));
const ConnectionsPage = lazyWithRetry(() => import('@/features/orchestration/components/connections/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const DatasetsPage = lazyWithRetry(() => import('@/features/orchestration/components/datasets/DatasetsPage').then(m => ({ default: m.DatasetsPage })));
const DatasetDetail = lazyWithRetry(() => import('@/features/orchestration/components/datasets/DatasetDetail').then(m => ({ default: m.DatasetDetail })));

const ROUTE_FALLBACK = <LoadingState />;

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
              <Suspense fallback={ROUTE_FALLBACK}>
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
              element={<Navigate to={landingRouteForApp('voice-rx')} replace />}
            />
            <Route path="/listing/:id" element={<ListingPage />} />
            <Route
              path={routes.voiceRx.dashboard}
              element={<AnalyticsDashboardPage appId="voice-rx" />}
            />
            <Route
              path={routes.voiceRx.evaluators}
              element={<AppEvaluatorsPage />}
            />
            <Route path="/runs/:runId" element={<VoiceRxRunDetail />} />
            <Route path={routes.voiceRx.runs} element={<EvalRunList />} />
            <Route path={routes.voiceRx.logs} element={<EvalLogs />} />
            <Route path={`${routes.voiceRx.logs}/runs/:runId`} element={<LogsEvaluationRunPage />} />
            <Route path={`${routes.voiceRx.logs}/workflow-runs/:runId`} element={<LogsWorkflowRunPage />} />
            <Route path={`${routes.voiceRx.logs}/workflow-actions/:actionId`} element={<LogsWorkflowActionPage />} />
            <Route path={routes.voiceRx.analytics} element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/analytics/charts/:chartId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/analytics/dashboards/:dashboardId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsDashboardDetail /></Suspense>} />
            <Route
              path={routes.voiceRx.settings}
              element={<RequirePermission action="configuration:edit"><VoiceRxSettingsPage /></RequirePermission>}
            />
          </Route>

          {/* Kaira Bot routes */}
          <Route element={<KairaBotGuard />}>
            <Route
              path={routes.kaira.home}
              element={<Navigate to={landingRouteForApp('kaira-bot')} replace />}
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
            <Route path={routes.kaira.dashboard} element={<AnalyticsDashboardPage appId="kaira-bot" />} />
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
            <Route path={`${routes.kaira.logs}/runs/:runId`} element={<LogsEvaluationRunPage />} />
            <Route path={`${routes.kaira.logs}/workflow-runs/:runId`} element={<LogsWorkflowRunPage />} />
            <Route path={`${routes.kaira.logs}/workflow-actions/:actionId`} element={<LogsWorkflowActionPage />} />
            <Route path={routes.kaira.analytics} element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/kaira/analytics/charts/:chartId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/kaira/analytics/dashboards/:dashboardId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsDashboardDetail /></Suspense>} />
          </Route>

          {/* Inside Sales routes */}
          <Route element={<InsideSalesGuard />}>
            <Route path={routes.insideSales.listing} element={<InsideSalesListing />} />
            <Route path={routes.insideSales.evaluators} element={<AppEvaluatorsPage />} />
            <Route path="/inside-sales/evaluators/:id" element={<EvaluatorDetailPage />} />
            <Route path={routes.insideSales.runs} element={<EvalRunList />} />
            <Route path="/inside-sales/runs/:runId" element={<InsideSalesRunDetail />} />
            <Route path="/inside-sales/runs/:runId/calls/:callId" element={<InsideSalesRunDetail />} />
            <Route path="/inside-sales/calls/:activityId" element={<InsideSalesCallDetail />} />
            <Route path="/inside-sales/leads/:prospectId" element={<InsideSalesLeadDetail />} />
            <Route path={routes.insideSales.dashboard} element={<AnalyticsDashboardPage appId="inside-sales" />} />
            <Route path={routes.insideSales.logs} element={<EvalLogs />} />
            <Route path={`${routes.insideSales.logs}/runs/:runId`} element={<LogsEvaluationRunPage />} />
            <Route path={`${routes.insideSales.logs}/workflow-runs/:runId`} element={<LogsWorkflowRunPage />} />
            <Route path={`${routes.insideSales.logs}/workflow-actions/:actionId`} element={<LogsWorkflowActionPage />} />
            <Route path={routes.insideSales.settings} element={<RequirePermission action="configuration:edit"><InsideSalesSettings /></RequirePermission>} />
            <Route path={routes.insideSales.analytics} element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsLibraryPage /></Suspense>} />
            <Route path="/inside-sales/analytics/charts/:chartId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsChartDetail /></Suspense>} />
            <Route path="/inside-sales/analytics/dashboards/:dashboardId" element={<Suspense fallback={ROUTE_FALLBACK}><AnalyticsDashboardDetail /></Suspense>} />
            <Route path={routes.insideSales.campaigns} element={<Suspense fallback={ROUTE_FALLBACK}><WorkflowListPage /></Suspense>} />
            <Route path="/inside-sales/orchestration/workflows/:workflowId" element={<Suspense fallback={ROUTE_FALLBACK}><WorkflowBuilderPage /></Suspense>} />
            <Route path={routes.insideSales.campaignRuns} element={<Suspense fallback={ROUTE_FALLBACK}><CampaignRunsPage /></Suspense>} />
            <Route path="/inside-sales/orchestration/runs/:runId" element={<Suspense fallback={ROUTE_FALLBACK}><LegacyRunDetailRedirect /></Suspense>} />
            <Route path={routes.insideSales.connections} element={<RequirePermission action="configuration:edit"><Suspense fallback={ROUTE_FALLBACK}><ConnectionsPage /></Suspense></RequirePermission>} />
            <Route path={routes.insideSales.datasets} element={<RequirePermission action="configuration:edit"><Suspense fallback={ROUTE_FALLBACK}><DatasetsPage /></Suspense></RequirePermission>} />
            <Route path="/inside-sales/orchestration/datasets/:datasetId" element={<RequirePermission action="configuration:edit"><Suspense fallback={ROUTE_FALLBACK}><DatasetDetail /></Suspense></RequirePermission>} />
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
                <Suspense fallback={ROUTE_FALLBACK}>
                  <CostPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path={routes.adminScheduledJobs}
            element={
              <RequirePermission action="schedule:manage">
                <Suspense fallback={ROUTE_FALLBACK}>
                  <ScheduledJobsListPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path={routes.adminSherlock}
            element={
              <AdminGuard>
                <AdminSherlockPage />
              </AdminGuard>
            }
          />
          <Route
            path="/admin/sherlock/:toolCallId"
            element={
              <AdminGuard>
                <AdminSherlockToolCallPage />
              </AdminGuard>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
