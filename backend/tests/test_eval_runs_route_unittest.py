from sqlalchemy.dialects import postgresql

from app.routes.eval_runs import list_eval_runs


async def test_list_eval_runs_search_uses_json_extract_path_text_for_json_columns(auth, fake_db):
    fake_db.scalar.return_value = 0

    payload = await list_eval_runs(
        app_id='kaira-bot',
        eval_type=None,
        listing_id=None,
        session_id=None,
        evaluator_id=None,
        status=None,
        command=None,
        run_type=None,
        q='l',
        sort=None,
        order=None,
        page=1,
        page_size=10,
        limit=50,
        offset=0,
        auth=auth,
        db=fake_db,
    )

    assert payload == {
        'items': [],
        'total_items': 0,
        'page': 1,
        'page_size': 10,
    }

    statement = fake_db.execute.await_args_list[-1].args[0]
    compiled = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={'literal_binds': True},
        )
    )

    # Roadmap 01 §9.5: evaluation_runs lives in the platform schema.
    assert "json_extract_path_text(platform.evaluation_runs.summary, 'evaluator_name')" in compiled
    assert "json_extract_path_text(platform.evaluation_runs.config, 'evaluator_name')" in compiled
    assert "json_extract_path_text(platform.evaluation_runs.batch_metadata, 'name')" in compiled
    assert '.astext' not in compiled
