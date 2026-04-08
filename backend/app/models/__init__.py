"""Import all models so SQLAlchemy metadata knows about them."""
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User, RefreshToken
from app.models.app import App
from app.models.role import Role, RoleAppAccess, RolePermission
from app.models.audit_log import AuditLog
from app.models.listing import Listing
from app.models.file_record import FileRecord
from app.models.prompt import Prompt
from app.models.schema import Schema
from app.models.evaluator import Evaluator
from app.models.chat import ChatSession, ChatMessage
from app.models.history import History
from app.models.setting import Setting
from app.models.adversarial_test_case import AdversarialSavedTestCase
from app.models.tag import Tag
from app.models.job import Job
from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation, ApiLog
from app.models.review import EvalReview, EvalReviewItem
from app.models.evaluation_analytics import EvaluationAnalytics
from app.models.report_config import ReportConfig
from app.models.report_run import ReportRun
from app.models.report_artifact import ReportArtifact
from app.models.invite_link import InviteLink
from app.models.tenant_config import TenantConfig
from app.models.lsq_call_cache import LsqLeadCache
from app.models.inside_sales_mirror import InsideSalesCallMirror, InsideSalesLeadMirror, InsideSalesSyncRun
from app.models.external_agent import ExternalAgent
from app.models.eval_template import EvalTemplate

__all__ = [
    "Base",
    "Tenant", "TenantConfig", "User", "RefreshToken", "InviteLink",
    "App", "Role", "RoleAppAccess", "RolePermission", "AuditLog",
    "Listing", "FileRecord", "Prompt", "Schema", "Evaluator",
    "ChatSession", "ChatMessage", "History", "Setting", "AdversarialSavedTestCase", "Tag",
    "Job", "EvalRun", "ThreadEvaluation", "AdversarialEvaluation", "ApiLog", "EvalReview", "EvalReviewItem",
    "EvaluationAnalytics", "ReportConfig", "ReportRun", "ReportArtifact",
    "LsqLeadCache",
    "InsideSalesCallMirror", "InsideSalesLeadMirror", "InsideSalesSyncRun",
    "ExternalAgent",
    "EvalTemplate",
]
