import uuid
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from app.auth.context import AuthContext
from app.routes.reports import (
    BlueprintSaveRequest,
    BlueprintSectionInput,
    BlueprintUpdateRequest,
    archive_report_config,
    create_report_config_from_blueprint,
    update_report_config,
)


def _blueprint_save_request(**overrides) -> BlueprintSaveRequest:
    defaults: dict = {
        'app_id': 'kaira-bot',
        'name': 'Kaira Full Evaluation Blueprint',
        'sections': [
            BlueprintSectionInput(id='section-1', type='summary_cards', title='Summary Cards'),
            BlueprintSectionInput(id='section-2', type='narrative', title='Narrative Overview'),
        ],
        'source_session_id': uuid.UUID('8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'),
    }
    defaults.update(overrides)
    return BlueprintSaveRequest(**defaults)


def _auth_ctx() -> AuthContext:
    return cast(AuthContext, SimpleNamespace(tenant_id=uuid.uuid4(), user_id=uuid.uuid4()))


@pytest.mark.asyncio
async def test_rejects_empty_sections():
    with pytest.raises(HTTPException) as ctx:
        await create_report_config_from_blueprint(
            payload=_blueprint_save_request(sections=[]),
            auth=_auth_ctx(),
            _app_check=_auth_ctx(),
            db=AsyncMock(),
        )
    assert ctx.value.status_code == 400
    assert 'sections' in ctx.value.detail


@pytest.mark.asyncio
async def test_rejects_blank_name():
    with pytest.raises(HTTPException) as ctx:
        await create_report_config_from_blueprint(
            payload=_blueprint_save_request(name='   '),
            auth=_auth_ctx(),
            _app_check=_auth_ctx(),
            db=AsyncMock(),
        )
    assert ctx.value.status_code == 400
    assert 'name' in ctx.value.detail


@pytest.mark.asyncio
async def test_translates_handler_error_to_http_500():
    auth = _auth_ctx()
    db = AsyncMock()

    with patch(
        'app.routes.reports.handle_save_template',
        AsyncMock(return_value={'error': 'Database error: boom'}),
    ):
        with pytest.raises(HTTPException) as ctx:
            await create_report_config_from_blueprint(
                payload=_blueprint_save_request(),
                auth=auth,
                _app_check=auth,
                db=db,
            )

    assert ctx.value.status_code == 500
    assert 'Database error' in ctx.value.detail
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_happy_path_commits_and_returns_config():
    auth = _auth_ctx()
    db = AsyncMock()
    saved_report_id = 'custom-abc12345'
    stub_config = object()
    select_result = Mock()
    select_result.scalar_one = Mock(return_value=stub_config)
    db.execute = AsyncMock(return_value=select_result)

    handler_result = {
        'status': 'saved',
        'report_id': saved_report_id,
        'report_name': 'Kaira Full Evaluation Blueprint',
        'section_count': 2,
    }

    with patch(
        'app.routes.reports.handle_save_template',
        AsyncMock(return_value=handler_result),
    ) as handler_mock:
        returned = await create_report_config_from_blueprint(
            payload=_blueprint_save_request(),
            auth=auth,
            _app_check=auth,
            db=db,
        )

    assert returned is stub_config
    db.commit.assert_awaited_once()

    call_kwargs = handler_mock.await_args.kwargs
    assert call_kwargs['app_id'] == 'kaira-bot'
    assert call_kwargs['report_name'] == 'Kaira Full Evaluation Blueprint'
    assert call_kwargs['session'] == {'chat_session_id': '8d7d7d56-5dca-4f6a-a2c6-4cb5f6f8e221'}
    forwarded_sections = call_kwargs['sections']
    assert forwarded_sections[0] == {
        'id': 'section-1', 'type': 'summary_cards', 'title': 'Summary Cards', 'variant': '',
    }
    assert forwarded_sections[1]['type'] == 'narrative'


@pytest.mark.asyncio
async def test_omits_session_when_no_source_session_id_provided():
    auth = _auth_ctx()
    db = AsyncMock()
    stub_config = object()
    select_result = Mock()
    select_result.scalar_one = Mock(return_value=stub_config)
    db.execute = AsyncMock(return_value=select_result)

    handler_result = {
        'status': 'saved',
        'report_id': 'custom-xyz00000',
        'report_name': 'No Lineage Blueprint',
        'section_count': 1,
    }

    payload = _blueprint_save_request(
        name='No Lineage Blueprint',
        sections=[BlueprintSectionInput(id='only', type='summary_cards', title='Only')],
        source_session_id=None,
    )

    with patch(
        'app.routes.reports.handle_save_template',
        AsyncMock(return_value=handler_result),
    ) as handler_mock:
        await create_report_config_from_blueprint(
            payload=payload,
            auth=auth,
            _app_check=auth,
            db=db,
        )

    assert handler_mock.await_args.kwargs['session'] is None


def _stub_config(*, user_id, tenant_id, app_id='voice-rx', name='Custom', is_default=False, status='active'):
    return SimpleNamespace(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        scope='single_run',
        report_id='custom-11111111',
        name=name,
        description='desc',
        is_default=is_default,
        status=status,
    )


@pytest.mark.asyncio
async def test_update_rejects_missing_config():
    auth = _auth_ctx()
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=None)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as ctx:
        await update_report_config(
            config_id=uuid.uuid4(),
            payload=BlueprintUpdateRequest(name='New name'),
            auth=auth,
            db=db,
        )
    assert ctx.value.status_code == 404


@pytest.mark.asyncio
async def test_update_rejects_foreign_user():
    auth = _auth_ctx()
    other = _stub_config(user_id=uuid.uuid4(), tenant_id=auth.tenant_id)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=other)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as ctx:
        await update_report_config(
            config_id=uuid.uuid4(),
            payload=BlueprintUpdateRequest(name='New name'),
            auth=auth,
            db=db,
        )
    assert ctx.value.status_code == 403


@pytest.mark.asyncio
async def test_update_rejects_blank_name():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=config)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as ctx:
        await update_report_config(
            config_id=config.id,
            payload=BlueprintUpdateRequest(name='   '),
            auth=auth,
            db=db,
        )
    assert ctx.value.status_code == 400
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_applies_name_and_description():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id, name='Old')
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=config)
    db.execute = AsyncMock(return_value=result)

    returned = await update_report_config(
        config_id=config.id,
        payload=BlueprintUpdateRequest(name='  New name  ', description='New desc'),
        auth=auth,
        db=db,
    )

    assert returned is config
    assert config.name == 'New name'
    assert config.description == 'New desc'
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_setting_default_unsets_other_user_defaults():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id, is_default=False)
    scalar_result = Mock()
    scalar_result.scalar_one_or_none = Mock(return_value=config)
    update_result = Mock()

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[scalar_result, update_result])

    await update_report_config(
        config_id=config.id,
        payload=BlueprintUpdateRequest(is_default=True),
        auth=auth,
        db=db,
    )

    assert config.is_default is True
    # Two execute calls: initial SELECT, then UPDATE-others-to-false
    assert db.execute.await_count == 2
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_no_op_skips_commit():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id, name='Same', is_default=False)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=config)
    db.execute = AsyncMock(return_value=result)

    await update_report_config(
        config_id=config.id,
        payload=BlueprintUpdateRequest(name='Same', is_default=False),
        auth=auth,
        db=db,
    )

    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_archive_rejects_foreign_user():
    auth = _auth_ctx()
    other = _stub_config(user_id=uuid.uuid4(), tenant_id=auth.tenant_id)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=other)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as ctx:
        await archive_report_config(config_id=other.id, auth=auth, db=db)
    assert ctx.value.status_code == 403
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_archive_flips_status_and_clears_default():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id, is_default=True)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=config)
    db.execute = AsyncMock(return_value=result)

    await archive_report_config(config_id=config.id, auth=auth, db=db)

    assert config.status == 'archived'
    assert config.is_default is False
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_archive_already_archived_returns_404():
    auth = _auth_ctx()
    config = _stub_config(user_id=auth.user_id, tenant_id=auth.tenant_id, status='archived')
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none = Mock(return_value=config)
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as ctx:
        await archive_report_config(config_id=config.id, auth=auth, db=db)
    assert ctx.value.status_code == 404
