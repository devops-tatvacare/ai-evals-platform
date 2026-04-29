"""Import all models so SQLAlchemy metadata knows about them."""
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User, RefreshToken
from app.models.application import Application
from app.models.role import Role, RoleAppAccess, RolePermission
from app.models.audit_log import AuditLog
from app.models.evaluation_dataset import EvaluationDataset
from app.models.application_uploaded_file import ApplicationUploadedFile
from app.models.library_prompt_definition import LibraryPromptDefinition
from app.models.library_output_schema_definition import LibraryOutputSchemaDefinition
from app.models.evaluator import Evaluator
from app.models.chat import ChatSession, ChatMessage
from app.models.history import ApplicationEventHistory
from app.models.application_setting import ApplicationSetting
from app.models.library_adversarial_test_case import LibraryAdversarialTestCase
from app.models.application_tag import ApplicationTag
from app.models.job import Job
from app.models.eval_run import (
    EvaluationRun,
    EvaluationRunThreadResult,
    EvaluationRunAdversarialResult,
    EvaluationRunApiCallLog,
)
from app.models.review import EvaluationReview, EvaluationReviewItem
from app.models.report_config import ReportConfiguration
from app.models.report_run import ReportGenerationRun
from app.models.report_artifact import ReportGeneratedArtifact
from app.models.invite_link import InviteLink
from app.models.tenant_config import TenantConfig
from app.models.source_records import CrmCallRecord, CrmLeadRecord, LogCrmSourceSync
from app.models.application_external_agent_connector import ApplicationExternalAgentConnector
from app.models.scheduled_job import ScheduledJob
from app.models.scheduler_heartbeat import SchedulerHeartbeat
from app.models.eval_template import EvaluationTemplate
from app.models.analytics_facts import AggEvaluationRun, FactEvaluation, FactEvaluationCriterion
from app.models.analytics_log import LogFactPopulationRun, LogSherlockToolCall, CacheSqlQuery
from app.models.analytics_chart import AnalyticsChart
from app.models.analytics_dashboard import AnalyticsDashboard
from app.models.sherlock_runtime import SherlockAgentSession, SherlockTurnEvent, SherlockConversationTurn
from app.models.sherlock_ontology import (
    SherlockOntologyClass,
    SherlockOntologyEntityType,
    SherlockEntityResolver,
)
from app.models.cost import (
    FactLlmGeneration,
    RefLlmModelPricing,
    RefLlmModelAlias,
    AggLlmUsageDaily,
    RefLlmModelsCatalog,
    SnapshotLlmModelsCatalog,
)

__all__ = [
    "Base",
    "Tenant", "TenantConfig", "User", "RefreshToken", "InviteLink",
    "Application", "Role", "RoleAppAccess", "RolePermission", "AuditLog",
    "EvaluationDataset", "ApplicationUploadedFile", "LibraryPromptDefinition", "LibraryOutputSchemaDefinition", "Evaluator",
    "ChatSession", "ChatMessage", "ApplicationEventHistory", "ApplicationSetting", "LibraryAdversarialTestCase", "ApplicationTag",
    "Job",
    "EvaluationRun", "EvaluationRunThreadResult", "EvaluationRunAdversarialResult",
    "EvaluationRunApiCallLog", "EvaluationReview", "EvaluationReviewItem",
    "ReportConfiguration", "ReportGenerationRun", "ReportGeneratedArtifact",
    "CrmCallRecord", "CrmLeadRecord", "LogCrmSourceSync",
    "ApplicationExternalAgentConnector",
    "ScheduledJob", "SchedulerHeartbeat",
    "EvaluationTemplate",
    "AggEvaluationRun", "FactEvaluation", "FactEvaluationCriterion",
    "LogFactPopulationRun", "LogSherlockToolCall", "CacheSqlQuery",
    "AnalyticsChart", "AnalyticsDashboard",
    "SherlockAgentSession", "SherlockTurnEvent", "SherlockConversationTurn",
    "SherlockOntologyClass", "SherlockOntologyEntityType", "SherlockEntityResolver",
    "FactLlmGeneration", "RefLlmModelPricing", "RefLlmModelAlias", "AggLlmUsageDaily",
    "RefLlmModelsCatalog", "SnapshotLlmModelsCatalog",
]
