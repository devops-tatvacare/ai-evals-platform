export interface ApiRoute {
  router: string;
  prefix: string;
  keyEndpoints: string;
  description: string;
}

export const apiRoutes: ApiRoute[] = [
  { router: 'admin', prefix: '/api/admin', keyEndpoints: 'GET /stats, POST /erase', description: 'Admin API routes — database stats and selective data erasure' },
  { router: 'adversarial_config', prefix: '/api/adversarial-config', keyEndpoints: 'GET /, PUT /, POST /reset, GET /export, POST /import', description: 'Adversarial config API routes' },
  { router: 'chat', prefix: '/api/chat', keyEndpoints: 'GET /sessions, GET /sessions/{session_id}, POST /sessions, PUT /sessions/{session_id}, DELETE /sessions/{session_id}, PUT /messages/tags/rename, POST /messages/tags/delete, GET /sessions/{session_id}/messages, GET /messages/{message_id}, POST /messages, PUT /messages/{message_id}, DELETE /messages/{message_id}', description: 'Chat API routes' },
  { router: 'eval_runs', prefix: '/api/eval-runs', keyEndpoints: 'GET /, POST /preview, GET /stats/summary, GET /trends, GET /logs, DELETE /logs, PUT /{ai_run_id}/human-review, GET /{ai_run_id}/human-review, GET /{run_id}, DELETE /{run_id}, GET /{run_id}/threads, GET /{run_id}/adversarial, GET /{run_id}/logs', description: 'Eval runs API - unified query for ALL evaluation run results' },
  { router: 'threads', prefix: '/api/threads', keyEndpoints: 'GET /{thread_id}/history', description: 'Eval runs API - unified query for ALL evaluation run results' },
  { router: 'evaluators', prefix: '/api/evaluators', keyEndpoints: 'GET /, GET /registry, GET /variables, POST /validate-prompt, POST /seed-defaults, GET /variables/api-paths, GET /{evaluator_id}, POST /, PUT /{evaluator_id}, DELETE /{evaluator_id}, POST /{evaluator_id}/fork, PUT /{evaluator_id}/global', description: 'Evaluators API routes' },
  { router: 'files', prefix: '/api/files', keyEndpoints: 'POST /upload, GET /{file_id}, GET /{file_id}/download, DELETE /{file_id}', description: 'Files API routes' },
  { router: 'history', prefix: '/api/history', keyEndpoints: 'GET /, GET /{history_id}, POST /, PUT /{history_id}, DELETE /{history_id}', description: 'History API routes — general history (non-eval purposes only)' },
  { router: 'jobs', prefix: '/api/jobs', keyEndpoints: 'POST /, GET /, GET /{job_id}, POST /{job_id}/cancel', description: 'Jobs API - submit, list, check status, cancel background jobs' },
  { router: 'listings', prefix: '/api/listings', keyEndpoints: 'GET /, GET /search, GET /{listing_id}, POST /, PUT /{listing_id}, DELETE /{listing_id}', description: 'Listings API routes' },
  { router: 'llm', prefix: '/api/llm', keyEndpoints: 'GET /auth-status, GET /models', description: 'LLM-related API endpoints — model discovery and auth status' },
  { router: 'prompts', prefix: '/api/prompts', keyEndpoints: 'GET /, GET /{prompt_id}, POST /, PUT /{prompt_id}, DELETE /{prompt_id}, POST /ensure-defaults', description: 'Prompts API routes' },
  { router: 'schemas', prefix: '/api/schemas', keyEndpoints: 'GET /, GET /{schema_id}, POST /, PUT /{schema_id}, DELETE /{schema_id}, POST /ensure-defaults, POST /sync-from-listing', description: 'Schemas API routes' },
  { router: 'settings', prefix: '/api/settings', keyEndpoints: 'GET /, GET /{setting_id}, PUT /, DELETE /, DELETE /{setting_id}', description: 'Settings API routes' },
  { router: 'tags', prefix: '/api/tags', keyEndpoints: 'GET /, GET /{tag_id}, POST /, PUT /{tag_id}, DELETE /{tag_id}, POST /{tag_id}/increment, POST /{tag_id}/decrement', description: 'Tags API routes' },
];
