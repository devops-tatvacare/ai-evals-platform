export interface ApiRoute {
  router: string;
  prefix: string;
  keyEndpoints: string;
  description: string;
}

export const apiRoutes: ApiRoute[] = [
  { router: 'admin', prefix: '/api/admin', keyEndpoints: 'GET /stats, POST /erase, GET /users, POST /users, PATCH /users/{user_id}, PUT /users/{user_id}/password, DELETE /users/{user_id}, GET /tenant, PATCH /tenant, POST /invite-links, GET /invite-links, POST /invite-links/{link_id}/revoke, DELETE /invite-links/{link_id}, GET /invite-links/{link_id}/uses, GET /tenant-config, PATCH /tenant-config', description: 'Admin API routes — database stats, selective data erasure, user management, tenant management, invite links' },
  { router: 'adversarial_config', prefix: '/api/adversarial-config', keyEndpoints: 'GET /, PUT /, POST /reset, GET /export, POST /import', description: 'Adversarial config API routes' },
  { router: 'apps', prefix: '/api/apps', keyEndpoints: 'GET /', description: 'Apps route — list registered applications' },
  { router: 'auth', prefix: '/api/auth', keyEndpoints: 'POST /login, POST /refresh, POST /logout, GET /me, PUT /me/password, GET /validate-invite, POST /signup', description: 'Auth routes — login, refresh, logout, me, password change' },
  { router: 'chat', prefix: '/api/chat', keyEndpoints: 'GET /sessions, GET /sessions/{session_id}, POST /sessions, PUT /sessions/{session_id}, DELETE /sessions/{session_id}, PUT /messages/tags/rename, POST /messages/tags/delete, GET /sessions/{session_id}/messages, GET /messages/{message_id}, POST /messages, PUT /messages/{message_id}, DELETE /messages/{message_id}', description: 'Chat API routes' },
  { router: 'eval_runs', prefix: '/api/eval-runs', keyEndpoints: 'GET /, POST /preview, GET /stats/summary, GET /trends, GET /logs, DELETE /logs, PUT /{ai_run_id}/human-review, GET /{ai_run_id}/human-review, GET /{run_id}, DELETE /{run_id}, GET /{run_id}/threads, GET /{run_id}/adversarial, GET /{run_id}/logs', description: 'Eval runs API - unified query for ALL evaluation run results' },
  { router: 'threads', prefix: '/api/threads', keyEndpoints: 'GET /{thread_id}/history', description: 'Eval runs API - unified query for ALL evaluation run results' },
  { router: 'evaluators', prefix: '/api/evaluators', keyEndpoints: 'GET /, GET /variables, POST /validate-prompt, POST /seed-defaults, GET /variables/api-paths, GET /{evaluator_id}, POST /, PUT /{evaluator_id}, DELETE /{evaluator_id}, POST /{evaluator_id}/fork, PATCH /{evaluator_id}/visibility', description: 'Evaluators API routes' },
  { router: 'files', prefix: '/api/files', keyEndpoints: 'POST /upload, GET /{file_id}, GET /{file_id}/download, DELETE /{file_id}', description: 'Files API routes' },
  { router: 'history', prefix: '/api/history', keyEndpoints: 'GET /, GET /{history_id}, POST /, PUT /{history_id}, DELETE /{history_id}', description: 'History API routes — general history (non-eval purposes only)' },
  { router: 'inside_sales', prefix: '/api/inside-sales', keyEndpoints: 'GET /calls, GET /leads, GET /leads/{prospect_id}, GET /leads/{prospect_id}/detail, GET /collections/{source_family}/suggestions, GET /collections/{source_family}/status, POST /collections/{source_family}/refresh', description: 'Inside Sales collection routes — every read surface (lists + detail + drilldown + filter suggestions) is served from the source_call_records / source_lead_records mirror, with no date-window restriction. POST /collections/{source_family}/refresh is the only path that triggers a live LeadSquared pull, via the sync-external-source job.' },
  { router: 'jobs', prefix: '/api/jobs', keyEndpoints: 'POST /, GET /, GET /{job_id}, POST /{job_id}/cancel', description: 'Jobs API - submit, list, check status, cancel background jobs' },
  { router: 'listings', prefix: '/api/listings', keyEndpoints: 'GET /, GET /search, GET /{listing_id}, POST /, PUT /{listing_id}, DELETE /{listing_id}', description: 'Listings API routes' },
  { router: 'llm', prefix: '/api/llm', keyEndpoints: 'GET /auth-status', description: 'LLM auth status for the calling user — BYOK provider lookup lives under /api/admin/ai-settings' },
  { router: 'prompts', prefix: '/api/prompts', keyEndpoints: 'GET /, GET /{prompt_id}, POST /, PUT /{prompt_id}, DELETE /{prompt_id}', description: 'Prompts API routes' },
  { router: 'reports', prefix: '/api/reports', keyEndpoints: 'GET /cross-run-analytics, POST /cross-run-analytics/refresh, GET /{run_id}/export-pdf, GET /{run_id}, POST /cross-run-ai-summary', description: 'Report generation endpoint' },
  { router: 'roles', prefix: '/api/admin', keyEndpoints: 'GET /roles, POST /roles, GET /roles/{role_id}, PUT /roles/{role_id}, DELETE /roles/{role_id}, GET /audit-log', description: 'Role management routes — Owner only for mutations' },
  { router: 'schemas', prefix: '/api/schemas', keyEndpoints: 'GET /, GET /{schema_id}, POST /, PUT /{schema_id}, DELETE /{schema_id}, POST /sync-from-listing', description: 'Schemas API routes' },
  { router: 'settings', prefix: '/api/settings', keyEndpoints: 'GET /, GET /{setting_id}, PUT /, DELETE /, DELETE /{setting_id}', description: 'Settings API routes' },
  { router: 'tags', prefix: '/api/tags', keyEndpoints: 'GET /, GET /{tag_id}, POST /, PUT /{tag_id}, DELETE /{tag_id}, POST /{tag_id}/increment, POST /{tag_id}/decrement', description: 'Tags API routes' },
];
