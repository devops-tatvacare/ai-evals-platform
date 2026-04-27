--
-- PostgreSQL database dump
--

\restrict fLsoR3QOP6aW0maihi3w2YbHqPhkLLe75uZeFwKrnTPEZX9VdFeFk0wdazEcahv

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: adversarial_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adversarial_evaluations (
    id integer NOT NULL,
    run_id uuid NOT NULL,
    goal_flow jsonb,
    difficulty character varying(20),
    active_traits jsonb,
    verdict character varying(20),
    goal_achieved boolean NOT NULL,
    total_turns integer NOT NULL,
    result json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: adversarial_evaluations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.adversarial_evaluations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: adversarial_evaluations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.adversarial_evaluations_id_seq OWNED BY public.adversarial_evaluations.id;


--
-- Name: adversarial_test_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adversarial_test_cases (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    name character varying(200),
    description text,
    synthetic_input text NOT NULL,
    difficulty character varying(20) NOT NULL,
    goal_flow jsonb NOT NULL,
    active_traits jsonb NOT NULL,
    expected_challenges jsonb NOT NULL,
    is_pinned boolean NOT NULL,
    source_kind character varying(20) NOT NULL,
    created_from_run_id uuid,
    created_from_eval_id integer,
    last_used_at timestamp with time zone,
    use_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    persona_tactic character varying(50)
);


--
-- Name: agent_tool_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_tool_logs (
    id uuid NOT NULL,
    session_id text,
    db_session_id uuid,
    app_id text NOT NULL,
    tool_name text NOT NULL,
    arguments jsonb DEFAULT '{}'::jsonb,
    generated_sql text,
    validated_sql text,
    execution_ms double precision,
    row_count integer,
    status text NOT NULL,
    error_message text,
    llm_model text,
    llm_tokens_in integer,
    llm_tokens_out integer,
    cache_hit boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: analytics_charts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_charts (
    id uuid NOT NULL,
    app_id character varying(64) NOT NULL,
    title character varying(256) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sql_query text NOT NULL,
    chart_config jsonb NOT NULL,
    source_question text,
    source_session_id uuid,
    archived_at timestamp with time zone,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_criterion_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_criterion_facts (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    app_id text NOT NULL,
    tenant_id uuid NOT NULL,
    item_id text NOT NULL,
    criterion_source text NOT NULL,
    criterion_id text NOT NULL,
    criterion_label text,
    evaluator_type text NOT NULL,
    status text NOT NULL,
    passed boolean,
    evidence text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN analytics_criterion_facts.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.id IS 'Role: identifier. DataType: nominal. SemanticType: pk.';


--
-- Name: COLUMN analytics_criterion_facts.run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.run_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_criterion_facts.app_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.app_id IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_criterion_facts.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.tenant_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_criterion_facts.item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.item_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_criterion_facts.criterion_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.criterion_source IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: rule_catalog, adversarial_rule, custom_criterion.';


--
-- Name: COLUMN analytics_criterion_facts.criterion_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.criterion_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash. Synonyms: rule id, criterion id.';


--
-- Name: COLUMN analytics_criterion_facts.criterion_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.criterion_label IS 'Role: dimension. DataType: nominal. SemanticType: category. Synonyms: rule, rule name, criterion.';


--
-- Name: COLUMN analytics_criterion_facts.evaluator_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.evaluator_type IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_criterion_facts.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.status IS 'Role: ordered_categorical. DataType: ordinal. SemanticType: category. Values: FOLLOWED, VIOLATED, NOT_APPLICABLE, NOT_EVALUATED.';


--
-- Name: COLUMN analytics_criterion_facts.passed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.passed IS 'Role: dimension. DataType: boolean.';


--
-- Name: COLUMN analytics_criterion_facts.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.evidence IS 'Role: dimension. DataType: nominal. Synonyms: reason, rationale.';


--
-- Name: COLUMN analytics_criterion_facts.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_criterion_facts.created_at IS 'Role: temporal. DataType: temporal.';


--
-- Name: analytics_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_dashboards (
    id uuid NOT NULL,
    app_id character varying(64) NOT NULL,
    title character varying(256) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    chart_entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_session_id uuid,
    archived_at timestamp with time zone,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_eval_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_eval_facts (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    app_id text NOT NULL,
    tenant_id uuid NOT NULL,
    eval_type text NOT NULL,
    item_id text NOT NULL,
    item_type text NOT NULL,
    evaluator_type text NOT NULL,
    evaluator_name text NOT NULL,
    evaluator_id uuid,
    result_status text,
    result_score double precision,
    result_verdict text,
    success boolean,
    agent text,
    direction text,
    duration_seconds double precision,
    intent text,
    route text,
    query_type text,
    difficulty text,
    total_turns integer,
    result_detail jsonb DEFAULT '{}'::jsonb,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN analytics_eval_facts.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.id IS 'Role: identifier. DataType: nominal. SemanticType: pk.';


--
-- Name: COLUMN analytics_eval_facts.run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.run_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_eval_facts.app_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.app_id IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.tenant_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_eval_facts.eval_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.eval_type IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.item_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash. Synonyms: thread id, case id.';


--
-- Name: COLUMN analytics_eval_facts.item_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.item_type IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: thread, adversarial_case, recording, listing.';


--
-- Name: COLUMN analytics_eval_facts.evaluator_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.evaluator_type IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.evaluator_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.evaluator_name IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.result_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.result_status IS 'Role: dimension. DataType: nominal. SemanticType: category. Ordering: PASS, SOFT FAIL, HARD FAIL. Synonyms: verdict.';


--
-- Name: COLUMN analytics_eval_facts.result_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.result_score IS 'Role: measure. DataType: quantitative. SemanticType: score. MeasureKind: score.';


--
-- Name: COLUMN analytics_eval_facts.success; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.success IS 'Role: dimension. DataType: boolean.';


--
-- Name: COLUMN analytics_eval_facts.agent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.agent IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.direction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.direction IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: inbound, outbound.';


--
-- Name: COLUMN analytics_eval_facts.duration_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.duration_seconds IS 'Role: measure. DataType: quantitative. SemanticType: duration. Unit: seconds. MeasureKind: duration_s.';


--
-- Name: COLUMN analytics_eval_facts.intent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.intent IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.route; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.route IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN analytics_eval_facts.query_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.query_type IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: logging, question.';


--
-- Name: COLUMN analytics_eval_facts.difficulty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.difficulty IS 'Role: ordered_categorical. DataType: ordinal. SemanticType: category. Values: EASY, MEDIUM, HARD, CRACK, MORIARTY.';


--
-- Name: COLUMN analytics_eval_facts.total_turns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.total_turns IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_eval_facts.result_detail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.result_detail IS 'Role: dimension. DataType: nominal.';


--
-- Name: COLUMN analytics_eval_facts.context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.context IS 'Role: dimension. DataType: nominal.';


--
-- Name: COLUMN analytics_eval_facts.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_eval_facts.created_at IS 'Role: temporal. DataType: temporal.';


--
-- Name: analytics_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_jobs (
    id uuid NOT NULL,
    run_id uuid,
    app_id text NOT NULL,
    tenant_id uuid NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms double precision,
    rows_inserted integer,
    rows_updated integer,
    rows_deleted integer,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_query_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_query_cache (
    id uuid NOT NULL,
    sql_hash text NOT NULL,
    tenant_id uuid NOT NULL,
    app_id text NOT NULL,
    result_json jsonb NOT NULL,
    row_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: analytics_run_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_run_facts (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    app_id text NOT NULL,
    eval_type text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    duration_ms double precision,
    thread_count integer,
    pass_count integer,
    fail_count integer,
    error_count integer,
    pass_rate double precision,
    avg_intent_accuracy double precision,
    adversarial_total integer,
    adversarial_blocked integer,
    adversarial_block_rate double precision,
    run_name text,
    avg_score double precision,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: COLUMN analytics_run_facts.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.id IS 'Role: identifier. DataType: nominal. SemanticType: pk.';


--
-- Name: COLUMN analytics_run_facts.run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.run_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash. Synonyms: run, run id, evaluation run.';


--
-- Name: COLUMN analytics_run_facts.app_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.app_id IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: voice-rx, kaira-bot, inside-sales.';


--
-- Name: COLUMN analytics_run_facts.eval_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.eval_type IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: batch_thread, call_quality, batch_adversarial, custom, full_evaluation, inside_sales. Synonyms: evaluation type, run type, test type.';


--
-- Name: COLUMN analytics_run_facts.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.status IS 'Role: dimension. DataType: nominal. SemanticType: category. Values: pending, running, completed, completed_with_errors, failed.';


--
-- Name: COLUMN analytics_run_facts.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.created_at IS 'Role: temporal. DataType: temporal.';


--
-- Name: COLUMN analytics_run_facts.completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.completed_at IS 'Role: temporal. DataType: temporal.';


--
-- Name: COLUMN analytics_run_facts.duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.duration_ms IS 'Role: measure. DataType: quantitative. SemanticType: duration. Unit: ms. MeasureKind: duration_ms.';


--
-- Name: COLUMN analytics_run_facts.thread_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.thread_count IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.pass_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.pass_count IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.fail_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.fail_count IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.error_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.error_count IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.pass_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.pass_rate IS '0-100 percentage Role: measure. DataType: quantitative. SemanticType: percent. Unit: percent. MeasureKind: percent.';


--
-- Name: COLUMN analytics_run_facts.avg_intent_accuracy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.avg_intent_accuracy IS '0.0-1.0 Role: measure. DataType: quantitative. SemanticType: ratio. MeasureKind: ratio.';


--
-- Name: COLUMN analytics_run_facts.adversarial_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.adversarial_total IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.adversarial_blocked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.adversarial_blocked IS 'Role: measure. DataType: quantitative. SemanticType: count. MeasureKind: count.';


--
-- Name: COLUMN analytics_run_facts.adversarial_block_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.adversarial_block_rate IS 'Role: measure. DataType: quantitative. SemanticType: percent. Unit: percent. MeasureKind: percent.';


--
-- Name: COLUMN analytics_run_facts.run_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.run_name IS 'User-given run name when present Role: dimension. DataType: nominal.';


--
-- Name: COLUMN analytics_run_facts.avg_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.avg_score IS 'Role: measure. DataType: quantitative. SemanticType: score. MeasureKind: score.';


--
-- Name: COLUMN analytics_run_facts.context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.context IS 'App-specific metadata Role: dimension. DataType: nominal.';


--
-- Name: COLUMN analytics_run_facts.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.tenant_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN analytics_run_facts.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_run_facts.user_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: api_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_logs (
    id integer NOT NULL,
    run_id uuid,
    thread_id character varying(200),
    test_case_label character varying(100),
    provider character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    method character varying(50) NOT NULL,
    prompt text NOT NULL,
    system_prompt text,
    response text,
    error text,
    duration_ms double precision,
    tokens_in integer,
    tokens_out integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_logs_id_seq OWNED BY public.api_logs.id;


--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    id uuid NOT NULL,
    slug character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description character varying(255) NOT NULL,
    icon_url character varying(255) NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action character varying(100) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    before_state jsonb,
    after_state jsonb,
    ip_address character varying(45),
    user_agent character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    metadata json,
    status character varying(20) NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    external_user_id character varying(100),
    thread_id character varying(200),
    server_session_id character varying(200),
    last_response_id character varying(200),
    title character varying(500) NOT NULL,
    status character varying(20) NOT NULL,
    is_first_message boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: eval_review_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_review_items (
    id uuid NOT NULL,
    review_id uuid NOT NULL,
    item_key character varying(200) NOT NULL,
    item_type character varying(80) NOT NULL,
    attribute_key character varying(120) NOT NULL,
    original_value text,
    reviewed_value text,
    decision character varying(20) NOT NULL,
    reason_code character varying(120),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: eval_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_reviews (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    reviewer_user_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    overall_decision character varying(40),
    notes text,
    review_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: eval_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_runs (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    eval_type character varying(30) NOT NULL,
    listing_id uuid,
    session_id uuid,
    evaluator_id uuid,
    job_id uuid,
    status character varying(30) NOT NULL,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms double precision,
    llm_provider character varying(50),
    llm_model character varying(100),
    config json NOT NULL,
    result json,
    summary json,
    batch_metadata json,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone,
    latest_review_id uuid
);


--
-- Name: COLUMN eval_runs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.id IS 'Role: identifier. DataType: nominal. SemanticType: pk.';


--
-- Name: COLUMN eval_runs.app_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.app_id IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN eval_runs.eval_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.eval_type IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN eval_runs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.status IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: COLUMN eval_runs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.created_at IS 'Role: temporal. DataType: temporal.';


--
-- Name: COLUMN eval_runs.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.tenant_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN eval_runs.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.user_id IS 'Role: identifier. DataType: nominal. SemanticType: id_hash.';


--
-- Name: COLUMN eval_runs.visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.eval_runs.visibility IS 'Role: dimension. DataType: nominal. SemanticType: category.';


--
-- Name: eval_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_templates (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    template_type character varying(20) NOT NULL,
    source_type character varying(10),
    branch_key character varying(100) NOT NULL,
    version integer NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    prompt text NOT NULL,
    schema_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_format character varying(20) NOT NULL,
    variables_used jsonb DEFAULT '[]'::jsonb NOT NULL,
    change_summary character varying(20),
    is_default boolean NOT NULL,
    forked_from uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone
);


--
-- Name: evaluation_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_analytics (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    scope character varying(20) NOT NULL,
    run_id uuid,
    analytics_data jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    source_run_count integer,
    latest_source_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evaluators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluators (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    listing_id uuid,
    name character varying(200) NOT NULL,
    prompt text NOT NULL,
    model_id character varying(100),
    output_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    linked_rule_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    forked_from uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone,
    template_id uuid,
    template_branch_key character varying(100),
    seed_key character varying(120),
    seed_variant character varying(50)
);


--
-- Name: external_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_agents (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    source character varying(30) NOT NULL,
    external_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    extra_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id uuid NOT NULL,
    original_name character varying(500) NOT NULL,
    mime_type character varying(100),
    size_bytes bigint,
    storage_path character varying(1000) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.history (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    entity_type character varying(50),
    entity_id character varying(200),
    source_type character varying(50) NOT NULL,
    source_id character varying(200),
    status character varying(20) NOT NULL,
    duration_ms double precision,
    data json,
    triggered_by character varying(20) NOT NULL,
    schema_version character varying(20),
    user_context json,
    "timestamp" bigint NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_links (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_by uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    label character varying(255),
    role_id uuid NOT NULL,
    max_uses integer,
    uses_count integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid NOT NULL,
    app_id character varying(50) DEFAULT ''::character varying NOT NULL,
    job_type character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    queue_class character varying(20) DEFAULT 'standard'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 1 NOT NULL,
    lease_owner character varying(120),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    last_error_at timestamp with time zone,
    next_retry_at timestamp with time zone,
    dead_lettered_at timestamp with time zone,
    dead_letter_reason text,
    params json NOT NULL,
    result json,
    progress json NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    depends_on_job_id uuid,
    scheduled_job_id uuid,
    submission_context jsonb,
    idempotency_key character varying(120)
);


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    title character varying(500) NOT NULL,
    status character varying(20) NOT NULL,
    source_type character varying(20) NOT NULL,
    audio_file json,
    transcript_file json,
    structured_json_file json,
    transcript json,
    api_response json,
    structured_output_references json NOT NULL,
    structured_outputs json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: llm_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_usage (
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    app_id text NOT NULL,
    subsystem text,
    owner_type text NOT NULL,
    owner_id uuid,
    parent_usage_id uuid,
    correlation_id uuid,
    provider text NOT NULL,
    model text NOT NULL,
    model_family text,
    api_surface text,
    call_purpose text,
    stage_index integer,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cached_read_tokens integer DEFAULT 0 NOT NULL,
    cached_write_tokens integer DEFAULT 0 NOT NULL,
    cached_write_ttl text,
    reasoning_tokens integer DEFAULT 0 NOT NULL,
    tool_use_prompt_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer GENERATED ALWAYS AS ((((((input_tokens + output_tokens) + reasoning_tokens) + cached_read_tokens) + cached_write_tokens) + tool_use_prompt_tokens)) STORED NOT NULL,
    modality_details jsonb,
    audio_seconds numeric(10,2),
    cost_usd numeric(14,8) DEFAULT 0 NOT NULL,
    cost_breakdown jsonb,
    pricing_version_id uuid,
    pricing_fallback boolean DEFAULT false NOT NULL,
    duration_ms integer,
    status text DEFAULT 'ok'::text NOT NULL,
    error_code text,
    finish_reason text,
    server_tool_usage jsonb,
    traffic_type text,
    request_id text,
    idempotency_key text
);


--
-- Name: llm_usage_daily_rollup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_usage_daily_rollup (
    id uuid NOT NULL,
    day date NOT NULL,
    tenant_id uuid NOT NULL,
    app_id text NOT NULL,
    user_id uuid,
    provider text NOT NULL,
    model text NOT NULL,
    call_purpose text,
    status text DEFAULT 'ok'::text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cached_read_tokens integer DEFAULT 0 NOT NULL,
    cached_write_tokens integer DEFAULT 0 NOT NULL,
    reasoning_tokens integer DEFAULT 0 NOT NULL,
    tool_use_prompt_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(14,8) DEFAULT 0 NOT NULL,
    call_count integer DEFAULT 0 NOT NULL
);


--
-- Name: lsq_lead_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lsq_lead_cache (
    id uuid NOT NULL,
    prospect_id character varying(100) NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    phone character varying(50),
    email character varying(255),
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: model_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_aliases (
    id uuid NOT NULL,
    tenant_id uuid,
    provider text NOT NULL,
    observed text NOT NULL,
    canonical text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_pricing (
    id uuid NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    input_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    cached_read_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    cache_write_5m_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    cache_write_1h_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    output_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    reasoning_per_1m_usd numeric(12,6) DEFAULT 0 NOT NULL,
    audio_input_per_1m_usd numeric(12,6),
    audio_input_per_minute_usd numeric(12,6),
    image_input_per_1m_usd numeric(12,6),
    server_tool_prices jsonb,
    currency text DEFAULT 'USD'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_snapshot_id uuid,
    source_model_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: models_dev_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.models_dev_catalog (
    id uuid NOT NULL,
    provider_key text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    model text NOT NULL,
    display_name text,
    family text,
    context_limit integer,
    output_limit integer,
    supports_reasoning boolean DEFAULT false NOT NULL,
    supports_tool_call boolean DEFAULT false NOT NULL,
    supports_attachment boolean DEFAULT false NOT NULL,
    modalities_input text[] DEFAULT '{}'::text[] NOT NULL,
    modalities_output text[] DEFAULT '{}'::text[] NOT NULL,
    open_weights boolean DEFAULT false NOT NULL,
    release_date date,
    last_updated_source date,
    knowledge_cutoff text,
    status text DEFAULT 'active'::text NOT NULL,
    last_snapshot_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: models_dev_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.models_dev_snapshots (
    id uuid NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    actor_id uuid,
    source_url text DEFAULT 'https://models.dev/api.json'::text NOT NULL,
    source_etag text,
    payload_hash text NOT NULL,
    model_count integer NOT NULL,
    added_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    removed_count integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    error_message text,
    duration_ms integer,
    raw_payload jsonb NOT NULL
);


--
-- Name: prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompts (
    id integer NOT NULL,
    app_id character varying(50) NOT NULL,
    prompt_type character varying(50) NOT NULL,
    branch_key character varying(64) NOT NULL,
    version integer NOT NULL,
    name character varying(200) NOT NULL,
    prompt text NOT NULL,
    description text NOT NULL,
    is_default boolean NOT NULL,
    source_type character varying(20),
    forked_from integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone
);


--
-- Name: prompts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prompts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prompts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prompts_id_seq OWNED BY public.prompts.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_artifacts (
    id uuid NOT NULL,
    report_run_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    report_id character varying(100) NOT NULL,
    scope character varying(20) NOT NULL,
    artifact_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash character varying(128),
    source_run_count integer,
    latest_source_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_configs (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    report_id character varying(100) NOT NULL,
    scope character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    presentation_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    narrative_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    export_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_report_run_visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone,
    source_session_id uuid
);


--
-- Name: report_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_runs (
    id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    report_id character varying(100) NOT NULL,
    scope character varying(20) NOT NULL,
    source_eval_run_id uuid,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    job_id uuid,
    llm_provider character varying(50),
    llm_model character varying(100),
    report_config_version integer,
    prompt_asset_version character varying(100),
    schema_asset_version character varying(100),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone
);


--
-- Name: role_app_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_app_access (
    id uuid NOT NULL,
    role_id uuid NOT NULL,
    app_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(500),
    is_system boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_jobs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(64) NOT NULL,
    job_type character varying(64) NOT NULL,
    schedule_key character varying(128) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    cron character varying(64) NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    override jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    next_check_at timestamp with time zone,
    current_cycle_started_at timestamp with time zone,
    current_cycle_attempts integer DEFAULT 0 NOT NULL,
    last_fire_at timestamp with time zone,
    last_fire_job_id uuid,
    last_skip_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduler_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduler_heartbeats (
    worker_id character varying(160) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_tick_at timestamp with time zone DEFAULT now() NOT NULL,
    tick_count integer DEFAULT 0 NOT NULL,
    host_label character varying(160),
    fired_count integer DEFAULT 0 NOT NULL
);


--
-- Name: schemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schemas (
    id integer NOT NULL,
    app_id character varying(50) NOT NULL,
    prompt_type character varying(50) NOT NULL,
    branch_key character varying(64) NOT NULL,
    version integer NOT NULL,
    name character varying(200) NOT NULL,
    schema_data jsonb NOT NULL,
    description text NOT NULL,
    is_default boolean NOT NULL,
    source_type character varying(20),
    forked_from integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone
);


--
-- Name: schemas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schemas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schemas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schemas_id_seq OWNED BY public.schemas.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    app_id character varying(50),
    key character varying(200) NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    forked_from integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visibility character varying(7) DEFAULT 'private'::character varying NOT NULL,
    shared_by uuid,
    shared_at timestamp with time zone
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: sherlock_entity_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_entity_types (
    id uuid NOT NULL,
    tenant_id uuid,
    app_id text,
    name text NOT NULL,
    ontology_class_id uuid NOT NULL,
    role text,
    safety text DEFAULT 'safe_first_pass'::text NOT NULL,
    description text,
    examples jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sherlock_ontology_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_ontology_classes (
    id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    description text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sherlock_resolvers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_resolvers (
    id uuid NOT NULL,
    tenant_id uuid,
    app_id text,
    key text NOT NULL,
    entity_type text NOT NULL,
    description text,
    source text NOT NULL,
    config jsonb NOT NULL,
    safety text DEFAULT 'safe_first_pass'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sherlock_runtime_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_runtime_events (
    id uuid NOT NULL,
    chat_session_id uuid NOT NULL,
    app_id text NOT NULL,
    seq integer NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: sherlock_runtime_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_runtime_sessions (
    chat_session_id uuid NOT NULL,
    app_id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    message_state jsonb DEFAULT '[]'::jsonb NOT NULL,
    scratchpad jsonb DEFAULT '{"errors": [], "lookups": {}, "findings": [], "discovery": null, "last_analysis": null, "last_evidence": null, "active_filters": {}, "composed_report": null, "last_data_check": null, "analysis_history": [], "discovered_schema": {"json_structures": {}, "relations_found": [], "columns_by_table": {}, "tables_inspected": []}, "resolved_entities": {}}'::jsonb NOT NULL,
    next_event_seq integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_error text,
    last_response_id text,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_job_observed_at timestamp with time zone
);


--
-- Name: sherlock_runtime_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sherlock_runtime_turns (
    id uuid NOT NULL,
    chat_session_id uuid NOT NULL,
    app_id text NOT NULL,
    client_turn_id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    user_message text,
    status text DEFAULT 'queued'::text NOT NULL,
    assistant_message_id uuid,
    last_event_seq integer DEFAULT 0 NOT NULL,
    last_error text,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id uuid
);


--
-- Name: source_call_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_call_records (
    id uuid NOT NULL,
    activity_id character varying(100) NOT NULL,
    prospect_id character varying(100) NOT NULL,
    agent_id character varying(100),
    agent_name character varying(255),
    agent_name_normalized character varying(255),
    agent_email character varying(255),
    event_code integer DEFAULT 0 NOT NULL,
    direction character varying(20) NOT NULL,
    status character varying(50),
    status_normalized character varying(50),
    call_started_at timestamp with time zone,
    duration_seconds integer DEFAULT 0 NOT NULL,
    has_recording boolean DEFAULT false NOT NULL,
    recording_url text,
    phone_number character varying(100),
    display_number character varying(100),
    call_notes text,
    call_session_id character varying(120),
    created_on timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    source_system character varying(30) DEFAULT 'lsq'::character varying NOT NULL,
    source_record_hash character varying(128),
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_in_source_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_by_user_id uuid,
    raw_payload jsonb
);


--
-- Name: source_lead_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_lead_records (
    id uuid NOT NULL,
    prospect_id character varying(100) NOT NULL,
    first_name text,
    last_name text,
    phone text,
    email text,
    prospect_stage text DEFAULT ''::character varying NOT NULL,
    prospect_stage_normalized text,
    city text,
    city_normalized text,
    age_group text,
    condition text,
    condition_normalized text,
    hba1c_band text,
    intent_to_pay text,
    agent_name text,
    agent_name_normalized text,
    source text,
    source_campaign text,
    created_on timestamp with time zone,
    first_activity_on timestamp with time zone,
    last_activity_on timestamp with time zone,
    rnr_count integer DEFAULT 0 NOT NULL,
    answered_count integer DEFAULT 0 NOT NULL,
    total_dials integer DEFAULT 0 NOT NULL,
    connect_rate numeric(5,2),
    frt_seconds integer,
    lead_age_days integer DEFAULT 0 NOT NULL,
    days_since_last_contact integer,
    mql_score integer DEFAULT 0 NOT NULL,
    mql_signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    source_system character varying(30) DEFAULT 'lsq'::character varying NOT NULL,
    source_record_hash character varying(128),
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_in_source_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_by_user_id uuid,
    raw_payload jsonb,
    plan_name text
);


--
-- Name: source_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_sync_runs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    app_id character varying(50) NOT NULL,
    source_system character varying(30) DEFAULT 'lsq'::character varying NOT NULL,
    source_family character varying(20) NOT NULL,
    sync_mode character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    requested_by_user_id uuid,
    targeted_source_id character varying(120),
    watermark_from character varying(255),
    watermark_to character varying(255),
    records_scanned integer DEFAULT 0 NOT NULL,
    records_upserted integer DEFAULT 0 NOT NULL,
    records_failed integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    is_scheduled_run boolean DEFAULT false NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    app_id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    count integer NOT NULL,
    last_used timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: tenant_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_configs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    app_url character varying(500),
    logo_url character varying(500),
    allowed_domains jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: thread_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_evaluations (
    id integer NOT NULL,
    run_id uuid NOT NULL,
    thread_id character varying(200) NOT NULL,
    data_file_hash character varying(50),
    intent_accuracy double precision,
    worst_correctness character varying(20),
    efficiency_verdict character varying(20),
    success_status boolean NOT NULL,
    result json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: thread_evaluations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.thread_evaluations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: thread_evaluations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.thread_evaluations_id_seq OWNED BY public.thread_evaluations.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    role_id uuid NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: adversarial_evaluations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_evaluations ALTER COLUMN id SET DEFAULT nextval('public.adversarial_evaluations_id_seq'::regclass);


--
-- Name: api_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_logs ALTER COLUMN id SET DEFAULT nextval('public.api_logs_id_seq'::regclass);


--
-- Name: prompts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts ALTER COLUMN id SET DEFAULT nextval('public.prompts_id_seq'::regclass);


--
-- Name: schemas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas ALTER COLUMN id SET DEFAULT nextval('public.schemas_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: thread_evaluations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_evaluations ALTER COLUMN id SET DEFAULT nextval('public.thread_evaluations_id_seq'::regclass);


--
-- Name: adversarial_evaluations adversarial_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_evaluations
    ADD CONSTRAINT adversarial_evaluations_pkey PRIMARY KEY (id);


--
-- Name: adversarial_test_cases adversarial_test_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_test_cases
    ADD CONSTRAINT adversarial_test_cases_pkey PRIMARY KEY (id);


--
-- Name: agent_tool_logs agent_tool_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tool_logs
    ADD CONSTRAINT agent_tool_logs_pkey PRIMARY KEY (id);


--
-- Name: analytics_charts analytics_charts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT analytics_charts_pkey PRIMARY KEY (id);


--
-- Name: analytics_criterion_facts analytics_criterion_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_criterion_facts
    ADD CONSTRAINT analytics_criterion_facts_pkey PRIMARY KEY (id);


--
-- Name: analytics_dashboards analytics_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_pkey PRIMARY KEY (id);


--
-- Name: analytics_eval_facts analytics_eval_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_eval_facts
    ADD CONSTRAINT analytics_eval_facts_pkey PRIMARY KEY (id);


--
-- Name: analytics_jobs analytics_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_jobs
    ADD CONSTRAINT analytics_jobs_pkey PRIMARY KEY (id);


--
-- Name: analytics_query_cache analytics_query_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_query_cache
    ADD CONSTRAINT analytics_query_cache_pkey PRIMARY KEY (id);


--
-- Name: analytics_query_cache analytics_query_cache_sql_hash_tenant_id_app_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_query_cache
    ADD CONSTRAINT analytics_query_cache_sql_hash_tenant_id_app_id_key UNIQUE (sql_hash, tenant_id, app_id);


--
-- Name: analytics_run_facts analytics_run_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_run_facts
    ADD CONSTRAINT analytics_run_facts_pkey PRIMARY KEY (id);


--
-- Name: analytics_run_facts analytics_run_facts_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_run_facts
    ADD CONSTRAINT analytics_run_facts_run_id_key UNIQUE (run_id);


--
-- Name: api_logs api_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: apps apps_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_slug_key UNIQUE (slug);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: eval_review_items eval_review_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_review_items
    ADD CONSTRAINT eval_review_items_pkey PRIMARY KEY (id);


--
-- Name: eval_reviews eval_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_reviews
    ADD CONSTRAINT eval_reviews_pkey PRIMARY KEY (id);


--
-- Name: eval_runs eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);


--
-- Name: eval_templates eval_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT eval_templates_pkey PRIMARY KEY (id);


--
-- Name: evaluation_analytics evaluation_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_analytics
    ADD CONSTRAINT evaluation_analytics_pkey PRIMARY KEY (id);


--
-- Name: evaluators evaluators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_pkey PRIMARY KEY (id);


--
-- Name: external_agents external_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_agents
    ADD CONSTRAINT external_agents_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: history history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.history
    ADD CONSTRAINT history_pkey PRIMARY KEY (id);


--
-- Name: source_call_records inside_sales_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_call_records
    ADD CONSTRAINT inside_sales_calls_pkey PRIMARY KEY (id);


--
-- Name: source_lead_records inside_sales_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_lead_records
    ADD CONSTRAINT inside_sales_leads_pkey PRIMARY KEY (id);


--
-- Name: source_sync_runs inside_sales_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_sync_runs
    ADD CONSTRAINT inside_sales_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: invite_links invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_links
    ADD CONSTRAINT invite_links_pkey PRIMARY KEY (id);


--
-- Name: invite_links invite_links_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_links
    ADD CONSTRAINT invite_links_token_hash_key UNIQUE (token_hash);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: llm_usage_daily_rollup llm_usage_daily_rollup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage_daily_rollup
    ADD CONSTRAINT llm_usage_daily_rollup_pkey PRIMARY KEY (id);


--
-- Name: llm_usage llm_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_pkey PRIMARY KEY (id);


--
-- Name: lsq_lead_cache lsq_lead_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lsq_lead_cache
    ADD CONSTRAINT lsq_lead_cache_pkey PRIMARY KEY (id);


--
-- Name: model_aliases model_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_aliases
    ADD CONSTRAINT model_aliases_pkey PRIMARY KEY (id);


--
-- Name: model_pricing model_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_pricing
    ADD CONSTRAINT model_pricing_pkey PRIMARY KEY (id);


--
-- Name: models_dev_catalog models_dev_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models_dev_catalog
    ADD CONSTRAINT models_dev_catalog_pkey PRIMARY KEY (id);


--
-- Name: models_dev_snapshots models_dev_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models_dev_snapshots
    ADD CONSTRAINT models_dev_snapshots_pkey PRIMARY KEY (id);


--
-- Name: prompts prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: report_artifacts report_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT report_artifacts_pkey PRIMARY KEY (id);


--
-- Name: report_configs report_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT report_configs_pkey PRIMARY KEY (id);


--
-- Name: report_runs report_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_pkey PRIMARY KEY (id);


--
-- Name: role_app_access role_app_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_app_access
    ADD CONSTRAINT role_app_access_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: scheduled_jobs scheduled_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id);


--
-- Name: scheduler_heartbeats scheduler_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduler_heartbeats
    ADD CONSTRAINT scheduler_heartbeats_pkey PRIMARY KEY (worker_id);


--
-- Name: schemas schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: sherlock_entity_types sherlock_entity_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_entity_types
    ADD CONSTRAINT sherlock_entity_types_pkey PRIMARY KEY (id);


--
-- Name: sherlock_ontology_classes sherlock_ontology_classes_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_ontology_classes
    ADD CONSTRAINT sherlock_ontology_classes_name_key UNIQUE (name);


--
-- Name: sherlock_ontology_classes sherlock_ontology_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_ontology_classes
    ADD CONSTRAINT sherlock_ontology_classes_pkey PRIMARY KEY (id);


--
-- Name: sherlock_resolvers sherlock_resolvers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_resolvers
    ADD CONSTRAINT sherlock_resolvers_pkey PRIMARY KEY (id);


--
-- Name: sherlock_runtime_events sherlock_runtime_events_chat_session_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_events
    ADD CONSTRAINT sherlock_runtime_events_chat_session_id_seq_key UNIQUE (chat_session_id, seq);


--
-- Name: sherlock_runtime_events sherlock_runtime_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_events
    ADD CONSTRAINT sherlock_runtime_events_pkey PRIMARY KEY (id);


--
-- Name: sherlock_runtime_sessions sherlock_runtime_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_sessions
    ADD CONSTRAINT sherlock_runtime_sessions_pkey PRIMARY KEY (chat_session_id);


--
-- Name: sherlock_runtime_turns sherlock_runtime_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_turns
    ADD CONSTRAINT sherlock_runtime_turns_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tenant_configs tenant_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_pkey PRIMARY KEY (id);


--
-- Name: tenant_configs tenant_configs_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: thread_evaluations thread_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_evaluations
    ADD CONSTRAINT thread_evaluations_pkey PRIMARY KEY (id);


--
-- Name: evaluation_analytics uq_analytics_app_scope_run; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_analytics
    ADD CONSTRAINT uq_analytics_app_scope_run UNIQUE (tenant_id, app_id, scope, run_id);


--
-- Name: eval_templates uq_eval_template_branch_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT uq_eval_template_branch_version UNIQUE (tenant_id, app_id, template_type, source_type, branch_key, version);


--
-- Name: external_agents uq_external_agent_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_agents
    ADD CONSTRAINT uq_external_agent_identity UNIQUE (tenant_id, source, external_id);


--
-- Name: llm_usage_daily_rollup uq_llm_usage_daily_rollup_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage_daily_rollup
    ADD CONSTRAINT uq_llm_usage_daily_rollup_scope UNIQUE (day, tenant_id, app_id, user_id, provider, model, call_purpose, status);


--
-- Name: lsq_lead_cache uq_lsq_lead_cache_tenant_prospect; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lsq_lead_cache
    ADD CONSTRAINT uq_lsq_lead_cache_tenant_prospect UNIQUE (tenant_id, prospect_id);


--
-- Name: model_aliases uq_model_alias_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_aliases
    ADD CONSTRAINT uq_model_alias_scope UNIQUE (tenant_id, provider, observed);


--
-- Name: model_pricing uq_model_pricing_effective; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_pricing
    ADD CONSTRAINT uq_model_pricing_effective UNIQUE (provider, model, effective_from);


--
-- Name: models_dev_catalog uq_models_dev_catalog_provider_model; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models_dev_catalog
    ADD CONSTRAINT uq_models_dev_catalog_provider_model UNIQUE (provider, model);


--
-- Name: prompts uq_prompt_branch_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT uq_prompt_branch_version UNIQUE (tenant_id, app_id, prompt_type, source_type, branch_key, version);


--
-- Name: report_artifacts uq_report_artifacts_report_run; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT uq_report_artifacts_report_run UNIQUE (report_run_id);


--
-- Name: report_configs uq_report_configs_tenant_app_report; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT uq_report_configs_tenant_app_report UNIQUE (tenant_id, app_id, report_id);


--
-- Name: role_app_access uq_role_app_access; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_app_access
    ADD CONSTRAINT uq_role_app_access UNIQUE (role_id, app_id);


--
-- Name: roles uq_role_name_per_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT uq_role_name_per_tenant UNIQUE (tenant_id, name);


--
-- Name: role_permissions uq_role_permission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT uq_role_permission UNIQUE (role_id, permission);


--
-- Name: scheduled_jobs uq_scheduled_jobs_tenant_app_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT uq_scheduled_jobs_tenant_app_type_key UNIQUE (tenant_id, app_id, job_type, schedule_key);


--
-- Name: schemas uq_schema_branch_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT uq_schema_branch_version UNIQUE (tenant_id, app_id, prompt_type, source_type, branch_key, version);


--
-- Name: settings uq_setting; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT uq_setting UNIQUE (tenant_id, app_id, key, user_id, visibility);


--
-- Name: sherlock_entity_types uq_sherlock_entity_type_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_entity_types
    ADD CONSTRAINT uq_sherlock_entity_type_scope UNIQUE (tenant_id, app_id, name);


--
-- Name: sherlock_resolvers uq_sherlock_resolver_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_resolvers
    ADD CONSTRAINT uq_sherlock_resolver_scope UNIQUE (tenant_id, app_id, key);


--
-- Name: sherlock_runtime_turns uq_sherlock_runtime_turn_client_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_turns
    ADD CONSTRAINT uq_sherlock_runtime_turn_client_id UNIQUE (chat_session_id, client_turn_id);


--
-- Name: source_call_records uq_source_call_records_tenant_app_activity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_call_records
    ADD CONSTRAINT uq_source_call_records_tenant_app_activity UNIQUE (tenant_id, app_id, activity_id);


--
-- Name: source_lead_records uq_source_lead_records_tenant_app_prospect; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_lead_records
    ADD CONSTRAINT uq_source_lead_records_tenant_app_prospect UNIQUE (tenant_id, app_id, prospect_id);


--
-- Name: tags uq_tag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT uq_tag UNIQUE (tenant_id, app_id, name, user_id);


--
-- Name: users uq_user_email_per_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_user_email_per_tenant UNIQUE (tenant_id, email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_acf_criterion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acf_criterion ON public.analytics_criterion_facts USING btree (criterion_id, status);


--
-- Name: idx_acf_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acf_item ON public.analytics_criterion_facts USING btree (item_id);


--
-- Name: idx_acf_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acf_run ON public.analytics_criterion_facts USING btree (run_id);


--
-- Name: idx_acf_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acf_tenant_app ON public.analytics_criterion_facts USING btree (tenant_id, app_id);


--
-- Name: idx_acf_tenant_app_criterion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acf_tenant_app_criterion ON public.analytics_criterion_facts USING btree (tenant_id, app_id, criterion_id, status);


--
-- Name: idx_adversarial_test_cases_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adversarial_test_cases_tenant_app ON public.adversarial_test_cases USING btree (tenant_id, app_id, created_at);


--
-- Name: idx_adversarial_test_cases_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adversarial_test_cases_tenant_user ON public.adversarial_test_cases USING btree (tenant_id, user_id, created_at);


--
-- Name: idx_aef_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aef_context ON public.analytics_eval_facts USING gin (context);


--
-- Name: idx_aef_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aef_evaluator ON public.analytics_eval_facts USING btree (evaluator_type, evaluator_name, result_status);


--
-- Name: idx_aef_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aef_item ON public.analytics_eval_facts USING btree (item_id, evaluator_type);


--
-- Name: idx_aef_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aef_run ON public.analytics_eval_facts USING btree (run_id);


--
-- Name: idx_aef_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aef_tenant_app ON public.analytics_eval_facts USING btree (tenant_id, app_id, created_at DESC);


--
-- Name: idx_aj_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aj_run ON public.analytics_jobs USING btree (run_id);


--
-- Name: idx_aj_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aj_status ON public.analytics_jobs USING btree (status);


--
-- Name: idx_aj_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aj_tenant ON public.analytics_jobs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_analytics_app_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_app_scope ON public.evaluation_analytics USING btree (app_id, scope);


--
-- Name: idx_analytics_charts_owned_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_charts_owned_active ON public.analytics_charts USING btree (tenant_id, user_id, app_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_analytics_charts_shared_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_charts_shared_active ON public.analytics_charts USING btree (tenant_id, app_id, visibility, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_analytics_dashboards_owned_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_dashboards_owned_active ON public.analytics_dashboards USING btree (tenant_id, user_id, app_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_analytics_dashboards_shared_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_dashboards_shared_active ON public.analytics_dashboards USING btree (tenant_id, app_id, visibility, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_analytics_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_tenant_app ON public.evaluation_analytics USING btree (tenant_id, app_id);


--
-- Name: idx_api_logs_run_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_logs_run_id_id ON public.api_logs USING btree (run_id, id DESC);


--
-- Name: idx_aqc_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aqc_lookup ON public.analytics_query_cache USING btree (sql_hash, tenant_id, app_id, expires_at);


--
-- Name: idx_arf_app_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arf_app_type ON public.analytics_run_facts USING btree (app_id, eval_type, created_at DESC);


--
-- Name: idx_arf_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arf_context ON public.analytics_run_facts USING gin (context);


--
-- Name: idx_arf_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arf_tenant_app ON public.analytics_run_facts USING btree (tenant_id, app_id, created_at DESC);


--
-- Name: idx_atl_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_session ON public.agent_tool_logs USING btree (db_session_id);


--
-- Name: idx_atl_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_tenant ON public.agent_tool_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_atl_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_tool ON public.agent_tool_logs USING btree (tool_name, status);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_log_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_tenant_created ON public.audit_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_chat_messages_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session_created ON public.chat_messages USING btree (session_id, created_at);


--
-- Name: idx_chat_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_tenant ON public.chat_messages USING btree (tenant_id);


--
-- Name: idx_chat_messages_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_tenant_user ON public.chat_messages USING btree (tenant_id, user_id);


--
-- Name: idx_chat_sessions_non_sherlock_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_non_sherlock_updated ON public.chat_sessions USING btree (tenant_id, user_id, app_id, updated_at DESC) WHERE ((server_session_id)::text IS DISTINCT FROM 'sherlock'::text);


--
-- Name: idx_chat_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant ON public.chat_sessions USING btree (tenant_id);


--
-- Name: idx_chat_sessions_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant_app ON public.chat_sessions USING btree (tenant_id, app_id);


--
-- Name: idx_chat_sessions_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant_user ON public.chat_sessions USING btree (tenant_id, user_id);


--
-- Name: idx_chat_sessions_tenant_user_app_source_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant_user_app_source_updated ON public.chat_sessions USING btree (tenant_id, user_id, app_id, server_session_id, updated_at DESC);


--
-- Name: idx_chat_sessions_tenant_user_app_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant_user_app_updated ON public.chat_sessions USING btree (tenant_id, user_id, app_id, updated_at DESC);


--
-- Name: idx_eval_review_items_review_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_review_items_review_created ON public.eval_review_items USING btree (review_id, created_at);


--
-- Name: idx_eval_reviews_reviewer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_reviews_reviewer_created ON public.eval_reviews USING btree (reviewer_user_id, created_at);


--
-- Name: idx_eval_reviews_run_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_reviews_run_status_created ON public.eval_reviews USING btree (run_id, status, created_at);


--
-- Name: idx_eval_runs_app_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_app_type ON public.eval_runs USING btree (app_id, eval_type, created_at);


--
-- Name: idx_eval_runs_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_evaluator ON public.eval_runs USING btree (evaluator_id);


--
-- Name: idx_eval_runs_latest_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_latest_review ON public.eval_runs USING btree (latest_review_id);


--
-- Name: idx_eval_runs_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_listing ON public.eval_runs USING btree (listing_id, created_at);


--
-- Name: idx_eval_runs_search_batch_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_search_batch_name_trgm ON public.eval_runs USING gin (COALESCE((batch_metadata ->> 'name'::text), ''::text) public.gin_trgm_ops);


--
-- Name: idx_eval_runs_search_config_evaluator_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_search_config_evaluator_trgm ON public.eval_runs USING gin (COALESCE((config ->> 'evaluator_name'::text), ''::text) public.gin_trgm_ops);


--
-- Name: idx_eval_runs_search_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_search_id_trgm ON public.eval_runs USING gin (((id)::text) public.gin_trgm_ops);


--
-- Name: idx_eval_runs_search_summary_evaluator_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_search_summary_evaluator_trgm ON public.eval_runs USING gin (COALESCE((summary ->> 'evaluator_name'::text), ''::text) public.gin_trgm_ops);


--
-- Name: idx_eval_runs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_session ON public.eval_runs USING btree (session_id, created_at);


--
-- Name: idx_eval_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant ON public.eval_runs USING btree (tenant_id);


--
-- Name: idx_eval_runs_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_app ON public.eval_runs USING btree (tenant_id, app_id, created_at);


--
-- Name: idx_eval_runs_tenant_app_visibility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_app_visibility_created ON public.eval_runs USING btree (tenant_id, app_id, visibility, created_at);


--
-- Name: idx_eval_runs_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_user ON public.eval_runs USING btree (tenant_id, user_id, created_at);


--
-- Name: idx_eval_runs_tenant_user_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_user_app_created ON public.eval_runs USING btree (tenant_id, user_id, app_id, created_at);


--
-- Name: idx_eval_runs_tenant_user_app_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_user_app_status_created ON public.eval_runs USING btree (tenant_id, user_id, app_id, status, created_at);


--
-- Name: idx_eval_runs_tenant_visibility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_visibility_created ON public.eval_runs USING btree (tenant_id, visibility, created_at);


--
-- Name: idx_eval_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant ON public.eval_templates USING btree (tenant_id);


--
-- Name: idx_eval_templates_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant_app ON public.eval_templates USING btree (tenant_id, app_id);


--
-- Name: idx_eval_templates_tenant_app_visibility_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant_app_visibility_updated ON public.eval_templates USING btree (tenant_id, app_id, visibility, updated_at DESC);


--
-- Name: idx_eval_templates_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant_branch ON public.eval_templates USING btree (tenant_id, branch_key);


--
-- Name: idx_eval_templates_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant_user ON public.eval_templates USING btree (tenant_id, user_id);


--
-- Name: idx_eval_templates_tenant_user_app_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_templates_tenant_user_app_updated ON public.eval_templates USING btree (tenant_id, user_id, app_id, updated_at DESC);


--
-- Name: idx_evaluators_listing_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_listing_created ON public.evaluators USING btree (listing_id, created_at DESC);


--
-- Name: idx_evaluators_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_tenant ON public.evaluators USING btree (tenant_id);


--
-- Name: idx_evaluators_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_tenant_app ON public.evaluators USING btree (tenant_id, app_id);


--
-- Name: idx_evaluators_tenant_app_visibility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_tenant_app_visibility_created ON public.evaluators USING btree (tenant_id, app_id, visibility, created_at DESC);


--
-- Name: idx_evaluators_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_tenant_user ON public.evaluators USING btree (tenant_id, user_id);


--
-- Name: idx_evaluators_tenant_user_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluators_tenant_user_app_created ON public.evaluators USING btree (tenant_id, user_id, app_id, created_at DESC);


--
-- Name: idx_external_agent_tenant_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_agent_tenant_source ON public.external_agents USING btree (tenant_id, source);


--
-- Name: idx_files_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_tenant ON public.files USING btree (tenant_id);


--
-- Name: idx_files_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_tenant_user ON public.files USING btree (tenant_id, user_id);


--
-- Name: idx_history_app_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_app_source ON public.history USING btree (app_id, source_type, "timestamp");


--
-- Name: idx_history_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_entity ON public.history USING btree (entity_type, entity_id, "timestamp");


--
-- Name: idx_history_entity_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_entity_source ON public.history USING btree (entity_id, source_type, source_id, "timestamp");


--
-- Name: idx_history_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_source ON public.history USING btree (source_type, source_id, "timestamp");


--
-- Name: idx_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_tenant ON public.history USING btree (tenant_id);


--
-- Name: idx_history_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_tenant_user ON public.history USING btree (tenant_id, user_id);


--
-- Name: idx_history_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_timestamp ON public.history USING btree ("timestamp");


--
-- Name: idx_invite_links_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_links_tenant ON public.invite_links USING btree (tenant_id);


--
-- Name: idx_invite_links_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_links_token_hash ON public.invite_links USING btree (token_hash);


--
-- Name: idx_jobs_depends_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_depends_on ON public.jobs USING btree (depends_on_job_id);


--
-- Name: idx_jobs_scheduled_job_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_scheduled_job_created ON public.jobs USING btree (scheduled_job_id, created_at);


--
-- Name: idx_jobs_status_lease_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status_lease_expires ON public.jobs USING btree (status, lease_expires_at);


--
-- Name: idx_jobs_status_next_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status_next_retry ON public.jobs USING btree (status, next_retry_at);


--
-- Name: idx_jobs_status_priority_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status_priority_created ON public.jobs USING btree (status, priority, created_at);


--
-- Name: idx_jobs_submission_context_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_submission_context_gin ON public.jobs USING gin (submission_context jsonb_path_ops);


--
-- Name: idx_jobs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_tenant ON public.jobs USING btree (tenant_id);


--
-- Name: idx_jobs_tenant_app_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_tenant_app_status_created ON public.jobs USING btree (tenant_id, app_id, status, created_at);


--
-- Name: idx_jobs_tenant_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_tenant_status_created ON public.jobs USING btree (tenant_id, status, created_at);


--
-- Name: idx_jobs_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_tenant_user ON public.jobs USING btree (tenant_id, user_id);


--
-- Name: idx_listings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_tenant ON public.listings USING btree (tenant_id);


--
-- Name: idx_listings_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_tenant_app ON public.listings USING btree (tenant_id, app_id);


--
-- Name: idx_listings_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_tenant_user ON public.listings USING btree (tenant_id, user_id);


--
-- Name: idx_listings_tenant_user_app_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_tenant_user_app_updated ON public.listings USING btree (tenant_id, user_id, app_id, updated_at DESC);


--
-- Name: idx_listings_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_updated_at ON public.listings USING btree (updated_at);


--
-- Name: idx_llm_usage_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_correlation_id ON public.llm_usage USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: idx_llm_usage_daily_rollup_tenant_app_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_daily_rollup_tenant_app_day ON public.llm_usage_daily_rollup USING btree (tenant_id, app_id, day);


--
-- Name: idx_llm_usage_daily_rollup_tenant_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_daily_rollup_tenant_day ON public.llm_usage_daily_rollup USING btree (tenant_id, day);


--
-- Name: idx_llm_usage_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_owner ON public.llm_usage USING btree (owner_type, owner_id);


--
-- Name: idx_llm_usage_provider_model_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_provider_model_created ON public.llm_usage USING btree (provider, model, created_at);


--
-- Name: idx_llm_usage_status_error; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_status_error ON public.llm_usage USING btree (tenant_id, created_at) WHERE (status <> 'ok'::text);


--
-- Name: idx_llm_usage_tenant_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_tenant_app_created ON public.llm_usage USING btree (tenant_id, app_id, created_at);


--
-- Name: idx_llm_usage_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_tenant_created ON public.llm_usage USING btree (tenant_id, created_at);


--
-- Name: idx_llm_usage_tenant_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_tenant_user_created ON public.llm_usage USING btree (tenant_id, user_id, created_at);


--
-- Name: idx_lsq_lead_cache_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lsq_lead_cache_tenant ON public.lsq_lead_cache USING btree (tenant_id);


--
-- Name: idx_model_alias_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_alias_lookup ON public.model_aliases USING btree (provider, observed, tenant_id);


--
-- Name: idx_model_pricing_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_pricing_lookup ON public.model_pricing USING btree (provider, model, effective_from);


--
-- Name: idx_model_pricing_source_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_pricing_source_snapshot ON public.model_pricing USING btree (source_snapshot_id);


--
-- Name: idx_models_dev_catalog_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_models_dev_catalog_source_id ON public.models_dev_catalog USING btree (provider_key, model_id);


--
-- Name: idx_models_dev_catalog_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_models_dev_catalog_status ON public.models_dev_catalog USING btree (status);


--
-- Name: idx_models_dev_snapshots_fetched_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_models_dev_snapshots_fetched_at ON public.models_dev_snapshots USING btree (fetched_at);


--
-- Name: idx_models_dev_snapshots_payload_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_models_dev_snapshots_payload_hash ON public.models_dev_snapshots USING btree (payload_hash);


--
-- Name: idx_prompts_branch_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_branch_latest ON public.prompts USING btree (tenant_id, app_id, prompt_type, branch_key, version);


--
-- Name: idx_prompts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_tenant ON public.prompts USING btree (tenant_id);


--
-- Name: idx_prompts_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_tenant_app ON public.prompts USING btree (tenant_id, app_id);


--
-- Name: idx_prompts_tenant_app_visibility_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_tenant_app_visibility_updated ON public.prompts USING btree (tenant_id, app_id, visibility, updated_at DESC);


--
-- Name: idx_prompts_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_tenant_user ON public.prompts USING btree (tenant_id, user_id);


--
-- Name: idx_prompts_tenant_user_app_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompts_tenant_user_app_updated ON public.prompts USING btree (tenant_id, user_id, app_id, updated_at DESC);


--
-- Name: idx_refresh_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_expires ON public.refresh_tokens USING btree (expires_at);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_report_artifacts_content_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_artifacts_content_hash ON public.report_artifacts USING btree (content_hash);


--
-- Name: idx_report_artifacts_tenant_app_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_artifacts_tenant_app_scope ON public.report_artifacts USING btree (tenant_id, app_id, scope);


--
-- Name: idx_report_configs_tenant_app_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_configs_tenant_app_default ON public.report_configs USING btree (tenant_id, app_id, is_default);


--
-- Name: idx_report_configs_tenant_app_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_configs_tenant_app_scope ON public.report_configs USING btree (tenant_id, app_id, scope);


--
-- Name: idx_report_runs_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_job_id ON public.report_runs USING btree (job_id);


--
-- Name: idx_report_runs_tenant_app_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_tenant_app_report ON public.report_runs USING btree (tenant_id, app_id, report_id);


--
-- Name: idx_report_runs_tenant_app_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_tenant_app_scope ON public.report_runs USING btree (tenant_id, app_id, scope);


--
-- Name: idx_report_runs_tenant_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_tenant_status_created ON public.report_runs USING btree (tenant_id, status, created_at);


--
-- Name: idx_scheduled_jobs_enabled_next_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_jobs_enabled_next_check ON public.scheduled_jobs USING btree (enabled, next_check_at);


--
-- Name: idx_scheduled_jobs_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_jobs_tenant_app ON public.scheduled_jobs USING btree (tenant_id, app_id);


--
-- Name: idx_schemas_branch_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_branch_latest ON public.schemas USING btree (tenant_id, app_id, prompt_type, branch_key, version);


--
-- Name: idx_schemas_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_tenant ON public.schemas USING btree (tenant_id);


--
-- Name: idx_schemas_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_tenant_app ON public.schemas USING btree (tenant_id, app_id);


--
-- Name: idx_schemas_tenant_app_visibility_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_tenant_app_visibility_updated ON public.schemas USING btree (tenant_id, app_id, visibility, updated_at DESC);


--
-- Name: idx_schemas_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_tenant_user ON public.schemas USING btree (tenant_id, user_id);


--
-- Name: idx_schemas_tenant_user_app_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schemas_tenant_user_app_updated ON public.schemas USING btree (tenant_id, user_id, app_id, updated_at DESC);


--
-- Name: idx_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_tenant ON public.settings USING btree (tenant_id);


--
-- Name: idx_settings_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_tenant_user ON public.settings USING btree (tenant_id, user_id);


--
-- Name: idx_sherlock_entity_type_app_safety; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_entity_type_app_safety ON public.sherlock_entity_types USING btree (app_id, safety);


--
-- Name: idx_sherlock_entity_type_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_entity_type_tenant_app ON public.sherlock_entity_types USING btree (tenant_id, app_id);


--
-- Name: idx_sherlock_resolver_app_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_resolver_app_entity ON public.sherlock_resolvers USING btree (app_id, entity_type);


--
-- Name: idx_sherlock_runtime_events_session_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_runtime_events_session_seq ON public.sherlock_runtime_events USING btree (chat_session_id, seq);


--
-- Name: idx_sherlock_runtime_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_runtime_tenant_app ON public.sherlock_runtime_sessions USING btree (tenant_id, app_id);


--
-- Name: idx_sherlock_runtime_turn_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_runtime_turn_correlation_id ON public.sherlock_runtime_turns USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: idx_sherlock_runtime_turn_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sherlock_runtime_turn_status ON public.sherlock_runtime_turns USING btree (chat_session_id, status);


--
-- Name: idx_source_call_records_tenant_app_activity_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_activity_agent ON public.source_call_records USING btree (tenant_id, app_id, COALESCE(call_started_at, created_on), agent_name_normalized, agent_name) WHERE ((agent_name IS NOT NULL) AND (agent_name_normalized IS NOT NULL));


--
-- Name: idx_source_call_records_tenant_app_activity_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_activity_time ON public.source_call_records USING btree (tenant_id, app_id, COALESCE(call_started_at, created_on) DESC, activity_id DESC);


--
-- Name: idx_source_call_records_tenant_app_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_agent ON public.source_call_records USING btree (tenant_id, app_id, agent_name_normalized);


--
-- Name: idx_source_call_records_tenant_app_call_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_call_started ON public.source_call_records USING btree (tenant_id, app_id, call_started_at);


--
-- Name: idx_source_call_records_tenant_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_created ON public.source_call_records USING btree (tenant_id, app_id, created_on);


--
-- Name: idx_source_call_records_tenant_app_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_direction ON public.source_call_records USING btree (tenant_id, app_id, direction);


--
-- Name: idx_source_call_records_tenant_app_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_prospect ON public.source_call_records USING btree (tenant_id, app_id, prospect_id);


--
-- Name: idx_source_call_records_tenant_app_recording; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_recording ON public.source_call_records USING btree (tenant_id, app_id, has_recording);


--
-- Name: idx_source_call_records_tenant_app_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_call_records_tenant_app_status ON public.source_call_records USING btree (tenant_id, app_id, status_normalized);


--
-- Name: idx_source_lead_records_tenant_app_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_agent ON public.source_lead_records USING btree (tenant_id, app_id, agent_name_normalized);


--
-- Name: idx_source_lead_records_tenant_app_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_city ON public.source_lead_records USING btree (tenant_id, app_id, city_normalized);


--
-- Name: idx_source_lead_records_tenant_app_condition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_condition ON public.source_lead_records USING btree (tenant_id, app_id, condition_normalized);


--
-- Name: idx_source_lead_records_tenant_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_created ON public.source_lead_records USING btree (tenant_id, app_id, created_on);


--
-- Name: idx_source_lead_records_tenant_app_created_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_created_prospect ON public.source_lead_records USING btree (tenant_id, app_id, created_on DESC, prospect_id DESC);


--
-- Name: idx_source_lead_records_tenant_app_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_last_activity ON public.source_lead_records USING btree (tenant_id, app_id, last_activity_on);


--
-- Name: idx_source_lead_records_tenant_app_mql; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_mql ON public.source_lead_records USING btree (tenant_id, app_id, mql_score);


--
-- Name: idx_source_lead_records_tenant_app_plan_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_plan_name ON public.source_lead_records USING btree (tenant_id, app_id, plan_name);


--
-- Name: idx_source_lead_records_tenant_app_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_lead_records_tenant_app_stage ON public.source_lead_records USING btree (tenant_id, app_id, prospect_stage_normalized);


--
-- Name: idx_source_sync_runs_tenant_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_sync_runs_tenant_app_created ON public.source_sync_runs USING btree (tenant_id, app_id, created_at);


--
-- Name: idx_source_sync_runs_tenant_app_family_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_sync_runs_tenant_app_family_scheduled ON public.source_sync_runs USING btree (tenant_id, app_id, source_family, is_scheduled_run, completed_at);


--
-- Name: idx_source_sync_runs_tenant_family_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_sync_runs_tenant_family_completed ON public.source_sync_runs USING btree (tenant_id, source_family, completed_at);


--
-- Name: idx_source_sync_runs_tenant_family_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_sync_runs_tenant_family_status ON public.source_sync_runs USING btree (tenant_id, source_family, status);


--
-- Name: idx_tags_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_tenant ON public.tags USING btree (tenant_id);


--
-- Name: idx_tags_tenant_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_tenant_app ON public.tags USING btree (tenant_id, app_id);


--
-- Name: idx_tags_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_tenant_user ON public.tags USING btree (tenant_id, user_id);


--
-- Name: idx_tags_tenant_user_app_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_tenant_user_app_name ON public.tags USING btree (tenant_id, user_id, app_id, name);


--
-- Name: idx_thread_evaluations_thread_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_evaluations_thread_id_id ON public.thread_evaluations USING btree (thread_id, id);


--
-- Name: ix_adversarial_evaluations_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_adversarial_evaluations_run_id ON public.adversarial_evaluations USING btree (run_id);


--
-- Name: ix_analytics_charts_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_analytics_charts_app_id ON public.analytics_charts USING btree (app_id);


--
-- Name: ix_analytics_charts_source_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_analytics_charts_source_session_id ON public.analytics_charts USING btree (source_session_id);


--
-- Name: ix_analytics_dashboards_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_analytics_dashboards_app_id ON public.analytics_dashboards USING btree (app_id);


--
-- Name: ix_analytics_dashboards_source_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_analytics_dashboards_source_session_id ON public.analytics_dashboards USING btree (source_session_id);


--
-- Name: ix_api_logs_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_api_logs_run_id ON public.api_logs USING btree (run_id);


--
-- Name: ix_api_logs_test_case_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_api_logs_test_case_label ON public.api_logs USING btree (test_case_label);


--
-- Name: ix_api_logs_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_api_logs_thread_id ON public.api_logs USING btree (thread_id);


--
-- Name: ix_chat_messages_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chat_messages_session_id ON public.chat_messages USING btree (session_id);


--
-- Name: ix_chat_sessions_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chat_sessions_app_id ON public.chat_sessions USING btree (app_id);


--
-- Name: ix_evaluators_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_evaluators_app_id ON public.evaluators USING btree (app_id);


--
-- Name: ix_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_jobs_status ON public.jobs USING btree (status);


--
-- Name: ix_listings_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_listings_app_id ON public.listings USING btree (app_id);


--
-- Name: ix_report_configs_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_report_configs_app_id ON public.report_configs USING btree (app_id);


--
-- Name: ix_report_runs_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_report_runs_app_id ON public.report_runs USING btree (app_id);


--
-- Name: ix_sherlock_runtime_events_chat_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sherlock_runtime_events_chat_session_id ON public.sherlock_runtime_events USING btree (chat_session_id);


--
-- Name: ix_thread_evaluations_data_file_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_thread_evaluations_data_file_hash ON public.thread_evaluations USING btree (data_file_hash);


--
-- Name: ix_thread_evaluations_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_thread_evaluations_run_id ON public.thread_evaluations USING btree (run_id);


--
-- Name: ix_thread_evaluations_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_thread_evaluations_thread_id ON public.thread_evaluations USING btree (thread_id);


--
-- Name: uq_analytics_cross_run_per_app; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_analytics_cross_run_per_app ON public.evaluation_analytics USING btree (tenant_id, app_id) WHERE ((scope)::text = 'cross_run'::text);


--
-- Name: uq_eval_review_items_review_item_attribute; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_eval_review_items_review_item_attribute ON public.eval_review_items USING btree (review_id, item_key, attribute_key);


--
-- Name: uq_eval_reviews_run_reviewer_draft; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_eval_reviews_run_reviewer_draft ON public.eval_reviews USING btree (run_id, reviewer_user_id) WHERE ((status)::text = 'draft'::text);


--
-- Name: uq_evaluators_seed_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_evaluators_seed_scope ON public.evaluators USING btree (tenant_id, app_id, COALESCE(seed_variant, ''::character varying), seed_key) WHERE ((listing_id IS NULL) AND (forked_from IS NULL) AND (seed_key IS NOT NULL) AND ((visibility)::text = 'shared'::text));


--
-- Name: uq_jobs_user_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_jobs_user_idempotency_key ON public.jobs USING btree (tenant_id, user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_llm_usage_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_llm_usage_idempotency_key ON public.llm_usage USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_settings_private_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_settings_private_scope ON public.settings USING btree (tenant_id, app_id, key, user_id) WHERE ((visibility)::text = 'PRIVATE'::text);


--
-- Name: uq_settings_shared_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_settings_shared_scope ON public.settings USING btree (tenant_id, app_id, key, visibility) WHERE ((visibility)::text = 'SHARED'::text);


--
-- Name: adversarial_evaluations adversarial_evaluations_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_evaluations
    ADD CONSTRAINT adversarial_evaluations_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: adversarial_test_cases adversarial_test_cases_created_from_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_test_cases
    ADD CONSTRAINT adversarial_test_cases_created_from_run_id_fkey FOREIGN KEY (created_from_run_id) REFERENCES public.eval_runs(id) ON DELETE SET NULL;


--
-- Name: adversarial_test_cases adversarial_test_cases_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_test_cases
    ADD CONSTRAINT adversarial_test_cases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: adversarial_test_cases adversarial_test_cases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adversarial_test_cases
    ADD CONSTRAINT adversarial_test_cases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: agent_tool_logs agent_tool_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tool_logs
    ADD CONSTRAINT agent_tool_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: agent_tool_logs agent_tool_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tool_logs
    ADD CONSTRAINT agent_tool_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: analytics_charts analytics_charts_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT analytics_charts_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_charts analytics_charts_source_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT analytics_charts_source_session_id_fkey FOREIGN KEY (source_session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: analytics_charts analytics_charts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT analytics_charts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_charts analytics_charts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT analytics_charts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: analytics_criterion_facts analytics_criterion_facts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_criterion_facts
    ADD CONSTRAINT analytics_criterion_facts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: analytics_criterion_facts analytics_criterion_facts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_criterion_facts
    ADD CONSTRAINT analytics_criterion_facts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_dashboards analytics_dashboards_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_dashboards analytics_dashboards_source_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_source_session_id_fkey FOREIGN KEY (source_session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: analytics_dashboards analytics_dashboards_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_dashboards analytics_dashboards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: analytics_eval_facts analytics_eval_facts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_eval_facts
    ADD CONSTRAINT analytics_eval_facts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: analytics_eval_facts analytics_eval_facts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_eval_facts
    ADD CONSTRAINT analytics_eval_facts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_jobs analytics_jobs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_jobs
    ADD CONSTRAINT analytics_jobs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE SET NULL;


--
-- Name: analytics_jobs analytics_jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_jobs
    ADD CONSTRAINT analytics_jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_run_facts analytics_run_facts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_run_facts
    ADD CONSTRAINT analytics_run_facts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: analytics_run_facts analytics_run_facts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_run_facts
    ADD CONSTRAINT analytics_run_facts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: analytics_run_facts analytics_run_facts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_run_facts
    ADD CONSTRAINT analytics_run_facts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: api_logs api_logs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: eval_review_items eval_review_items_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_review_items
    ADD CONSTRAINT eval_review_items_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.eval_reviews(id) ON DELETE CASCADE;


--
-- Name: eval_reviews eval_reviews_reviewer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_reviews
    ADD CONSTRAINT eval_reviews_reviewer_user_id_fkey FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: eval_reviews eval_reviews_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_reviews
    ADD CONSTRAINT eval_reviews_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: eval_reviews eval_reviews_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_reviews
    ADD CONSTRAINT eval_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: eval_runs eval_runs_evaluator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.evaluators(id) ON DELETE SET NULL;


--
-- Name: eval_runs eval_runs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: eval_runs eval_runs_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: eval_runs eval_runs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: eval_runs eval_runs_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: eval_runs eval_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: eval_runs eval_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: eval_templates eval_templates_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT eval_templates_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.eval_templates(id) ON DELETE SET NULL;


--
-- Name: eval_templates eval_templates_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT eval_templates_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: eval_templates eval_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT eval_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: eval_templates eval_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_templates
    ADD CONSTRAINT eval_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: evaluation_analytics evaluation_analytics_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_analytics
    ADD CONSTRAINT evaluation_analytics_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: evaluation_analytics evaluation_analytics_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_analytics
    ADD CONSTRAINT evaluation_analytics_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: evaluators evaluators_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.evaluators(id) ON DELETE SET NULL;


--
-- Name: evaluators evaluators_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: evaluators evaluators_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: evaluators evaluators_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: evaluators evaluators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluators
    ADD CONSTRAINT evaluators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: external_agents external_agents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_agents
    ADD CONSTRAINT external_agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: files files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: files files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: analytics_charts fk_analytics_charts_source_session_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_charts
    ADD CONSTRAINT fk_analytics_charts_source_session_id FOREIGN KEY (source_session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: analytics_dashboards fk_analytics_dashboards_source_session_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT fk_analytics_dashboards_source_session_id FOREIGN KEY (source_session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: eval_runs fk_eval_runs_latest_review_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT fk_eval_runs_latest_review_id FOREIGN KEY (latest_review_id) REFERENCES public.eval_reviews(id) ON DELETE SET NULL;


--
-- Name: jobs fk_jobs_depends_on_job_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT fk_jobs_depends_on_job_id FOREIGN KEY (depends_on_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: jobs fk_jobs_scheduled_job_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT fk_jobs_scheduled_job_id FOREIGN KEY (scheduled_job_id) REFERENCES public.scheduled_jobs(id) ON DELETE SET NULL;


--
-- Name: report_configs fk_report_configs_source_session_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT fk_report_configs_source_session_id FOREIGN KEY (source_session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: source_sync_runs fk_source_sync_runs_job_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_sync_runs
    ADD CONSTRAINT fk_source_sync_runs_job_id FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: history history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.history
    ADD CONSTRAINT history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: history history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.history
    ADD CONSTRAINT history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: source_call_records inside_sales_calls_last_synced_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_call_records
    ADD CONSTRAINT inside_sales_calls_last_synced_by_user_id_fkey FOREIGN KEY (last_synced_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: source_call_records inside_sales_calls_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_call_records
    ADD CONSTRAINT inside_sales_calls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: source_lead_records inside_sales_leads_last_synced_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_lead_records
    ADD CONSTRAINT inside_sales_leads_last_synced_by_user_id_fkey FOREIGN KEY (last_synced_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: source_lead_records inside_sales_leads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_lead_records
    ADD CONSTRAINT inside_sales_leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: source_sync_runs inside_sales_sync_runs_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_sync_runs
    ADD CONSTRAINT inside_sales_sync_runs_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: source_sync_runs inside_sales_sync_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_sync_runs
    ADD CONSTRAINT inside_sales_sync_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invite_links invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_links
    ADD CONSTRAINT invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invite_links invite_links_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_links
    ADD CONSTRAINT invite_links_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: invite_links invite_links_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_links
    ADD CONSTRAINT invite_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: listings listings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: listings listings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: llm_usage llm_usage_pricing_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_pricing_version_id_fkey FOREIGN KEY (pricing_version_id) REFERENCES public.model_pricing(id) ON DELETE RESTRICT;


--
-- Name: llm_usage llm_usage_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: lsq_lead_cache lsq_lead_cache_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lsq_lead_cache
    ADD CONSTRAINT lsq_lead_cache_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lsq_lead_cache lsq_lead_cache_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lsq_lead_cache
    ADD CONSTRAINT lsq_lead_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: model_aliases model_aliases_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_aliases
    ADD CONSTRAINT model_aliases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: prompts prompts_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: prompts prompts_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: prompts prompts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: prompts prompts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: report_artifacts report_artifacts_report_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT report_artifacts_report_run_id_fkey FOREIGN KEY (report_run_id) REFERENCES public.report_runs(id) ON DELETE CASCADE;


--
-- Name: report_artifacts report_artifacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT report_artifacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: report_configs report_configs_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT report_configs_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: report_configs report_configs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT report_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: report_configs report_configs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_configs
    ADD CONSTRAINT report_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: report_runs report_runs_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: report_runs report_runs_source_eval_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_source_eval_run_id_fkey FOREIGN KEY (source_eval_run_id) REFERENCES public.eval_runs(id) ON DELETE SET NULL;


--
-- Name: report_runs report_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_app_access role_app_access_app_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_app_access
    ADD CONSTRAINT role_app_access_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: role_app_access role_app_access_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_app_access
    ADD CONSTRAINT role_app_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: scheduled_jobs scheduled_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scheduled_jobs scheduled_jobs_last_fire_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_last_fire_job_id_fkey FOREIGN KEY (last_fire_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: scheduled_jobs scheduled_jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: schemas schemas_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.schemas(id) ON DELETE SET NULL;


--
-- Name: schemas schemas_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: schemas schemas_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: schemas schemas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: settings settings_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.settings(id) ON DELETE SET NULL;


--
-- Name: settings settings_shared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: settings settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: settings settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: settings settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sherlock_entity_types sherlock_entity_types_ontology_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_entity_types
    ADD CONSTRAINT sherlock_entity_types_ontology_class_id_fkey FOREIGN KEY (ontology_class_id) REFERENCES public.sherlock_ontology_classes(id) ON DELETE CASCADE;


--
-- Name: sherlock_ontology_classes sherlock_ontology_classes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_ontology_classes
    ADD CONSTRAINT sherlock_ontology_classes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.sherlock_ontology_classes(id) ON DELETE SET NULL;


--
-- Name: sherlock_runtime_events sherlock_runtime_events_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_events
    ADD CONSTRAINT sherlock_runtime_events_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_events sherlock_runtime_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_events
    ADD CONSTRAINT sherlock_runtime_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_events sherlock_runtime_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_events
    ADD CONSTRAINT sherlock_runtime_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_sessions sherlock_runtime_sessions_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_sessions
    ADD CONSTRAINT sherlock_runtime_sessions_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_sessions sherlock_runtime_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_sessions
    ADD CONSTRAINT sherlock_runtime_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_sessions sherlock_runtime_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_sessions
    ADD CONSTRAINT sherlock_runtime_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_turns sherlock_runtime_turns_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_turns
    ADD CONSTRAINT sherlock_runtime_turns_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_turns sherlock_runtime_turns_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_turns
    ADD CONSTRAINT sherlock_runtime_turns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sherlock_runtime_turns sherlock_runtime_turns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sherlock_runtime_turns
    ADD CONSTRAINT sherlock_runtime_turns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tags tags_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tags tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_configs tenant_configs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: thread_evaluations thread_evaluations_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_evaluations
    ADD CONSTRAINT thread_evaluations_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict fLsoR3QOP6aW0maihi3w2YbHqPhkLLe75uZeFwKrnTPEZX9VdFeFk0wdazEcahv

