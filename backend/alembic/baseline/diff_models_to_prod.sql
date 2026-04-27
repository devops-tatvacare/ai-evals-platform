create extension if not exists "pg_trgm" with schema "public" version '1.6';

alter table "public"."eval_runs" drop constraint "eval_runs_latest_review_id_fkey";

alter table "public"."report_configs" drop constraint "report_configs_source_session_id_fkey";

alter table "public"."source_call_records" drop constraint "source_call_records_last_synced_by_user_id_fkey";

alter table "public"."source_call_records" drop constraint "source_call_records_tenant_id_fkey";

alter table "public"."source_lead_records" drop constraint "source_lead_records_last_synced_by_user_id_fkey";

alter table "public"."source_lead_records" drop constraint "source_lead_records_tenant_id_fkey";

alter table "public"."source_sync_runs" drop constraint "source_sync_runs_requested_by_user_id_fkey";

alter table "public"."source_sync_runs" drop constraint "source_sync_runs_tenant_id_fkey";

alter table "public"."source_call_records" drop constraint "source_call_records_pkey";

alter table "public"."source_lead_records" drop constraint "source_lead_records_pkey";

alter table "public"."source_sync_runs" drop constraint "source_sync_runs_pkey";

drop index if exists "public"."ix_report_configs_source_session_id";

drop index if exists "public"."source_call_records_pkey";

drop index if exists "public"."source_lead_records_pkey";

drop index if exists "public"."source_sync_runs_pkey";

create table "public"."lsq_lead_cache" (
    "id" uuid not null,
    "prospect_id" character varying(100) not null,
    "first_name" character varying(255),
    "last_name" character varying(255),
    "phone" character varying(50),
    "email" character varying(255),
    "fetched_at" timestamp with time zone not null default now(),
    "tenant_id" uuid not null,
    "user_id" uuid not null
);


alter table "public"."sherlock_runtime_sessions" alter column "scratchpad" set default '{"errors": [], "lookups": {}, "findings": [], "discovery": null, "last_analysis": null, "last_evidence": null, "active_filters": {}, "composed_report": null, "last_data_check": null, "analysis_history": [], "discovered_schema": {"json_structures": {}, "relations_found": [], "columns_by_table": {}, "tables_inspected": []}, "resolved_entities": {}}'::jsonb;

alter table "public"."source_lead_records" alter column "prospect_stage" set default ''::character varying;

CREATE INDEX idx_eval_runs_search_batch_name_trgm ON public.eval_runs USING gin (COALESCE((batch_metadata ->> 'name'::text), ''::text) gin_trgm_ops);

CREATE INDEX idx_eval_runs_search_config_evaluator_trgm ON public.eval_runs USING gin (COALESCE((config ->> 'evaluator_name'::text), ''::text) gin_trgm_ops);

CREATE INDEX idx_eval_runs_search_id_trgm ON public.eval_runs USING gin (((id)::text) gin_trgm_ops);

CREATE INDEX idx_eval_runs_search_summary_evaluator_trgm ON public.eval_runs USING gin (COALESCE((summary ->> 'evaluator_name'::text), ''::text) gin_trgm_ops);

CREATE INDEX idx_jobs_submission_context_gin ON public.jobs USING gin (submission_context jsonb_path_ops);

CREATE INDEX idx_llm_usage_correlation_id ON public.llm_usage USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);

CREATE INDEX idx_llm_usage_status_error ON public.llm_usage USING btree (tenant_id, created_at) WHERE (status <> 'ok'::text);

CREATE INDEX idx_lsq_lead_cache_tenant ON public.lsq_lead_cache USING btree (tenant_id);

CREATE UNIQUE INDEX inside_sales_calls_pkey ON public.source_call_records USING btree (id);

CREATE UNIQUE INDEX inside_sales_leads_pkey ON public.source_lead_records USING btree (id);

CREATE UNIQUE INDEX inside_sales_sync_runs_pkey ON public.source_sync_runs USING btree (id);

CREATE UNIQUE INDEX lsq_lead_cache_pkey ON public.lsq_lead_cache USING btree (id);

CREATE UNIQUE INDEX uq_lsq_lead_cache_tenant_prospect ON public.lsq_lead_cache USING btree (tenant_id, prospect_id);

alter table "public"."lsq_lead_cache" add constraint "lsq_lead_cache_pkey" PRIMARY KEY using index "lsq_lead_cache_pkey";

alter table "public"."source_call_records" add constraint "inside_sales_calls_pkey" PRIMARY KEY using index "inside_sales_calls_pkey";

alter table "public"."source_lead_records" add constraint "inside_sales_leads_pkey" PRIMARY KEY using index "inside_sales_leads_pkey";

alter table "public"."source_sync_runs" add constraint "inside_sales_sync_runs_pkey" PRIMARY KEY using index "inside_sales_sync_runs_pkey";

alter table "public"."analytics_charts" add constraint "fk_analytics_charts_source_session_id" FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL not valid;

alter table "public"."analytics_charts" validate constraint "fk_analytics_charts_source_session_id";

alter table "public"."analytics_dashboards" add constraint "fk_analytics_dashboards_source_session_id" FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL not valid;

alter table "public"."analytics_dashboards" validate constraint "fk_analytics_dashboards_source_session_id";

alter table "public"."eval_runs" add constraint "fk_eval_runs_latest_review_id" FOREIGN KEY (latest_review_id) REFERENCES eval_reviews(id) ON DELETE SET NULL not valid;

alter table "public"."eval_runs" validate constraint "fk_eval_runs_latest_review_id";

alter table "public"."lsq_lead_cache" add constraint "lsq_lead_cache_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."lsq_lead_cache" validate constraint "lsq_lead_cache_tenant_id_fkey";

alter table "public"."lsq_lead_cache" add constraint "lsq_lead_cache_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE not valid;

alter table "public"."lsq_lead_cache" validate constraint "lsq_lead_cache_user_id_fkey";

alter table "public"."lsq_lead_cache" add constraint "uq_lsq_lead_cache_tenant_prospect" UNIQUE using index "uq_lsq_lead_cache_tenant_prospect";

alter table "public"."report_configs" add constraint "fk_report_configs_source_session_id" FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL not valid;

alter table "public"."report_configs" validate constraint "fk_report_configs_source_session_id";

alter table "public"."source_call_records" add constraint "inside_sales_calls_last_synced_by_user_id_fkey" FOREIGN KEY (last_synced_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_call_records" validate constraint "inside_sales_calls_last_synced_by_user_id_fkey";

alter table "public"."source_call_records" add constraint "inside_sales_calls_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_call_records" validate constraint "inside_sales_calls_tenant_id_fkey";

alter table "public"."source_lead_records" add constraint "inside_sales_leads_last_synced_by_user_id_fkey" FOREIGN KEY (last_synced_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_lead_records" validate constraint "inside_sales_leads_last_synced_by_user_id_fkey";

alter table "public"."source_lead_records" add constraint "inside_sales_leads_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_lead_records" validate constraint "inside_sales_leads_tenant_id_fkey";

alter table "public"."source_sync_runs" add constraint "inside_sales_sync_runs_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL not valid;

alter table "public"."source_sync_runs" validate constraint "inside_sales_sync_runs_requested_by_user_id_fkey";

alter table "public"."source_sync_runs" add constraint "inside_sales_sync_runs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE not valid;

alter table "public"."source_sync_runs" validate constraint "inside_sales_sync_runs_tenant_id_fkey";


