"""One-time migration: merge prompts + schemas into evaluation_templates.

Run with: PYTHONPATH=backend python -m app.services.migration.migrate_templates
"""

import asyncio
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.eval_template import EvaluationTemplate
from app.models.library_prompt_definition import LibraryPromptDefinition
from app.models.library_output_schema_definition import LibraryOutputSchemaDefinition


def _extract_variables(prompt_text: str) -> list[str]:
    return sorted(set(re.findall(r"\{\{(\w+(?:\.\w+)*)\}\}", prompt_text)))


async def migrate() -> None:
    async with async_session() as db:
        # Load all prompts and schemas
        prompts = (await db.execute(select(LibraryPromptDefinition))).scalars().all()
        schemas = (await db.execute(select(LibraryOutputSchemaDefinition))).scalars().all()

        # Index schemas by matching key
        schema_map: dict[tuple, object] = {}
        for s in schemas:
            key = (
                str(s.tenant_id), str(s.user_id), s.app_id,
                s.prompt_type, s.source_type, s.branch_key, s.version,
            )
            schema_map[key] = s

        created = 0
        orphan_prompts = 0
        orphan_schemas = 0
        seen_keys: set[tuple] = set()

        # Process prompts (primary side)
        for p in prompts:
            key = (
                str(p.tenant_id), str(p.user_id), p.app_id,
                p.prompt_type, p.source_type, p.branch_key, p.version,
            )
            seen_keys.add(key)
            schema_row = schema_map.get(key)

            template = EvaluationTemplate(
                id=uuid.uuid4(),
                tenant_id=p.tenant_id,
                user_id=p.user_id,
                app_id=p.app_id,
                template_type=p.prompt_type,
                source_type=p.source_type,
                branch_key=p.branch_key,
                version=p.version,
                name=p.name,
                description=p.description,
                prompt=p.prompt,
                schema_data=schema_row.schema_data if schema_row else {},
                schema_format='json_schema',
                variables_used=_extract_variables(p.prompt),
                change_summary='created',
                is_default=p.is_default,
                forked_from=None,
            )
            if hasattr(p, 'visibility') and p.visibility:
                template.visibility = p.visibility
            if hasattr(p, 'shared_by') and p.shared_by:
                template.shared_by = p.shared_by
                template.shared_at = p.shared_at

            db.add(template)
            created += 1
            if not schema_row:
                orphan_prompts += 1

        # Process orphan schemas (no matching prompt)
        for s in schemas:
            key = (
                str(s.tenant_id), str(s.user_id), s.app_id,
                s.prompt_type, s.source_type, s.branch_key, s.version,
            )
            if key in seen_keys:
                continue

            template = EvaluationTemplate(
                id=uuid.uuid4(),
                tenant_id=s.tenant_id,
                user_id=s.user_id,
                app_id=s.app_id,
                template_type=s.prompt_type,
                source_type=s.source_type,
                branch_key=s.branch_key,
                version=s.version,
                name=s.name,
                description=s.description,
                prompt='',
                schema_data=s.schema_data,
                schema_format='json_schema',
                variables_used=[],
                change_summary='created',
                is_default=s.is_default,
                forked_from=None,
            )
            if hasattr(s, 'visibility') and s.visibility:
                template.visibility = s.visibility
            if hasattr(s, 'shared_by') and s.shared_by:
                template.shared_by = s.shared_by
                template.shared_at = s.shared_at

            db.add(template)
            created += 1
            orphan_schemas += 1

        await db.commit()
        print(f'Migration complete: {created} templates created')
        print(f'  Paired: {created - orphan_prompts - orphan_schemas}')
        print(f'  Orphan prompts (no schema): {orphan_prompts}')
        print(f'  Orphan schemas (no prompt): {orphan_schemas}')


if __name__ == '__main__':
    asyncio.run(migrate())
