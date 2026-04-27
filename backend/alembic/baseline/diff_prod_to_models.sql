alter table "public"."analytics_charts" drop constraint "fk_analytics_charts_source_session_id";

alter table "public"."analytics_dashboards" drop constraint "fk_analytics_dashboards_source_session_id";

alter table "public"."eval_runs" drop constraint "fk_eval_runs_latest_review_id";

alter table "public"."lsq_lead_cache" drop constraint "lsq_lead_cache_tenant_id_fkey";

alter table "public"."lsq_lead_cache" drop constraint "lsq_lead_cache_user_id_fkey";

alter table "public"."lsq_lead_cache" drop constraint "uq_lsq_lead_cache_tenant_prospect";

alter table "public"."report_configs" drop constraint "fk_report_configs_source_session_id";

alter table "public"."source_call_records" drop constraint "inside_sales_calls_last_synced_by_user_id_fkey";

alter table "public"."source_call_records" drop constraint "inside_sales_calls_tenant_id_fkey";

alter table "public"."source_lead_records" drop constraint "inside_sales_leads_last_synced_by_user_id_fkey";

alter table "public"."source_lead_records" drop constraint "inside_sales_leads_tenant_id_fkey";

alter table "public"."source_sync_runs" drop constraint "inside_sales_sync_runs_requested_by_user_id_fkey";

alter table "public"."source_sync_runs" drop constraint "inside_sales_sync_runs_tenant_id_fkey";

alter table "public"."lsq_lead_cache" drop constraint "lsq_lead_cache_pkey";

alter table "public"."source_call_records" drop constraint "inside_sales_calls_pkey";

alter table "public"."source_lead_records" drop constraint "inside_sales_leads_pkey";

alter table "public"."source_sync_runs" drop constraint "inside_sales_sync_runs_pkey";

drop index if exists "public"."idx_eval_runs_search_batch_name_trgm";

drop index if exists "public"."idx_eval_runs_search_config_evaluator_trgm";

drop index if exists "public"."idx_eval_runs_search_id_trgm";

drop index if exists "public"."idx_eval_runs_search_summary_evaluator_trgm";

drop index if exists "public"."idx_jobs_submission_context_gin";

drop index if exists "public"."idx_llm_usage_correlation_id";

drop index if exists "public"."idx_llm_usage_status_error";

drop index if exists "public"."idx_lsq_lead_cache_tenant";

drop index if exists "public"."inside_sales_calls_pkey";

drop index if exists "public"."inside_sales_leads_pkey";

drop index if exists "public"."inside_sales_sync_runs_pkey";

drop index if exists "public"."lsq_lead_cache_pkey";

drop index if exists "public"."uq_lsq_lead_cache_tenant_prospect";

drop table "public"."lsq_lead_cache";

alter table "public"."sherlock_runtime_sessions" alter column "scratchpad" set default '{"errors": [], "lookups": {}, "findings": [], "discovery": null, "last_analysis": null, "last_evidence": null, "active_filters": {}, "last_data_check": null, "analysis_history": [], "discovered_schema": {"json_structures": {}, "relations_found": [], "columns_by_table": {}, "tables_inspected": []}, "resolved_entities": {}}'::jsonb;

alter table "public"."source_lead_records" alter column "prospect_stage" set default ''::text;

drop extension if exists "pg_trgm";

CREATE INDEX ix_report_configs_source_session_id ON public.report_configs USING btree (source_session_id);

CREATE UNIQUE INDEX source_call_records_pkey ON public.source_call_records USING btree (id);

CREATE UNIQUE INDEX source_lead_records_pkey ON public.source_lead_records USING btree (id);

CREATE UNIQUE INDEX source_sync_runs_pkey ON public.source_sync_runs USING btree (id);

alter table "public"."source_call_records" add constraint "source_call_records_pkey" PRIMARY KEY using index "source_call_records_pkey";

alter table "public"."source_lead_records" add constraint "source_lead_records_pkey" PRIMARY KEY using index "source_lead_records_pkey";

alter table "public"."source_sync_runs" add constraint "source_sync_runs_pkey" PRIMARY KEY using index "source_sync_runs_pkey";

alter table "public"."eval_runs" add constraint "eval_runs_latest_review_id_fkey" FOREIGN KEY (latest_review_id) REFERENCES eval_reviews(id) ON DELETE SET NULL not valid;

alter table "public"."eval_runs" validate constraint "eval_runs_latest_review_id_fkey";

alter table "public"."report_configs" add constraint "report_configs_source_session_id_fkey" FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL not valid;

alter table "public"."report_configs" validate constraint "report_configs_source_session_id_fkey";

alter table "public"."source_call_records" add constraint "source_call_records_last_synced_by_user_id_fkey" FOREIGN KEY (last_synced_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_call_records" validate constraint "source_call_records_last_synced_by_user_id_fkey";

alter table "public"."source_call_records" add constraint "source_call_records_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_call_records" validate constraint "source_call_records_tenant_id_fkey";

alter table "public"."source_lead_records" add constraint "source_lead_records_last_synced_by_user_id_fkey" FOREIGN KEY (last_synced_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_lead_records" validate constraint "source_lead_records_last_synced_by_user_id_fkey";

alter table "public"."source_lead_records" add constraint "source_lead_records_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_lead_records" validate constraint "source_lead_records_tenant_id_fkey";

alter table "public"."source_sync_runs" add constraint "source_sync_runs_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_sync_runs" validate constraint "source_sync_runs_requested_by_user_id_fkey";

alter table "public"."source_sync_runs" add constraint "source_sync_runs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_sync_runs" validate constraint "source_sync_runs_tenant_id_fkey";


