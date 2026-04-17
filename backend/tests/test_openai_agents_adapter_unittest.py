import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from openai.types.responses import ResponseTextDeltaEvent

from app.services.chat_engine.openai_agents_adapter import (
    SherlockContext,
    build_sherlock_agent,
    build_sherlock_tools,
    create_openai_client,
)


class SherlockContextTests(unittest.TestCase):
    def test_context_holds_platform_state_including_provider(self):
        ctx = SherlockContext(
            db=MagicMock(),
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='azure_openai',
            working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        self.assertEqual(ctx.app_id, 'kaira-bot')
        self.assertEqual(ctx.provider, 'azure_openai')
        self.assertIsNotNone(ctx.db)
        self.assertIsNotNone(ctx.auth)


class BuildToolsTests(unittest.TestCase):
    def test_creates_function_tools_from_json_definitions(self):
        tool_defs = [
            {
                'name': 'data_query',
                'description': 'Answer analytical questions.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {'question': {'type': 'string'}},
                    'required': ['question'],
                },
            },
            {
                'name': 'blueprint_save',
                'description': 'Persist a blueprint.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {'name': {'type': 'string'}},
                    'required': ['name'],
                },
            },
        ]

        tools = build_sherlock_tools(tool_defs)

        self.assertEqual(len(tools), 2)
        self.assertEqual(tools[0].name, 'data_query')
        self.assertEqual(tools[1].name, 'blueprint_save')

    def test_tool_schemas_use_non_strict_mode(self):
        tool_defs = [
            {
                'name': 'discover',
                'description': 'Discover dimensions.',
                'inputSchema': {
                    'type': 'object',
                    'properties': {},
                    'required': [],
                },
            },
        ]

        tools = build_sherlock_tools(tool_defs)

        self.assertFalse(tools[0].strict_json_schema)


class ClientFactoryTests(unittest.TestCase):
    def test_creates_native_openai_client(self):
        import openai

        client = create_openai_client(api_key='test-key', azure=False)

        self.assertIsInstance(client, openai.AsyncOpenAI)

    def test_creates_azure_openai_client(self):
        import openai

        client = create_openai_client(
            api_key='test-key',
            azure=True,
            azure_endpoint='https://sanp-ai.openai.azure.com',
            api_version='2025-04-01-preview',
        )

        self.assertIsInstance(client, openai.AsyncAzureOpenAI)


class AgentConfigurationTests(unittest.TestCase):
    def test_agent_uses_openai_responses_model(self):
        from agents.models.openai_responses import OpenAIResponsesModel

        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertIsInstance(agent.model, OpenAIResponsesModel)

    def test_agent_uses_chat_completions_model_is_forbidden(self):
        from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel

        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertNotIsInstance(agent.model, OpenAIChatCompletionsModel)

    def test_agent_temperature_is_point_three(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertEqual(agent.model_settings.temperature, 0.3)

    def test_tool_choice_required_when_forced(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=True,
        )

        self.assertEqual(agent.model_settings.tool_choice, 'required')

    def test_tool_choice_auto_when_not_forced(self):
        agent = build_sherlock_agent(
            instructions='You are Sherlock.',
            tools=[],
            model='gpt-5.4',
            client=MagicMock(),
            force_first_tool_call=False,
        )

        self.assertIn(agent.model_settings.tool_choice, (None, 'auto'))


class StreamingBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_content_deltas_flow_through_queue(self):
        from app.services.chat_engine.openai_agents_adapter import run_sherlock_sdk_turn

        ctx = SherlockContext(
            db=MagicMock(),
            auth=MagicMock(),
            app_id='kaira-bot',
            provider='openai',
            working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
            emit=AsyncMock(),
            tool_call_log=[],
        )

        mock_stream = MagicMock()
        mock_event = MagicMock()
        mock_event.type = 'raw_response_event'
        mock_event.data = ResponseTextDeltaEvent.model_construct(
            content_index=0,
            delta='Pass rate is 91%',
            item_id='output_1',
            logprobs=[],
            output_index=0,
            sequence_number=1,
            type='response.output_text.delta',
        )

        async def fake_stream_events():
            yield mock_event

        mock_stream.stream_events = fake_stream_events
        mock_stream.final_output = 'Pass rate is 91%'
        mock_stream.last_response_id = 'resp_abc123'

        with patch('app.services.chat_engine.openai_agents_adapter.Runner') as mock_runner:
            mock_runner.run_streamed.return_value = mock_stream

            events = []
            async for event in run_sherlock_sdk_turn(
                user_message='show pass rate',
                instructions='You are Sherlock.',
                tools=[],
                sherlock_context=ctx,
                model='gpt-5.4',
                client=MagicMock(),
            ):
                events.append(event)

        content_deltas = [event for event in events if event['event'] == 'content_delta']
        self.assertTrue(len(content_deltas) >= 1)
        self.assertEqual(content_deltas[0]['data']['delta'], 'Pass rate is 91%')
        self.assertEqual([event for event in events if event['event'] == 'done'], [])
        self.assertEqual([event for event in events if event['event'] == 'chart'], [])
        self.assertEqual([event for event in events if event['event'] == 'blueprint'], [])

        internal = [event for event in events if event['event'] == '_internal_turn_complete']
        self.assertEqual(len(internal), 1)
        self.assertEqual(internal[0]['data']['last_response_id'], 'resp_abc123')
        self.assertEqual(internal[0]['data']['final_output'], 'Pass rate is 91%')
