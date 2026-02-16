"""Data loader for evaluation data.

Ported from kaira-evals/src/data/loader.py — adapted to load from:
1. Uploaded CSV files (via file storage)
2. Direct data passed in job params

All operations are sync (run in thread pool from async handlers).
"""
import io
import logging
from pathlib import Path
from typing import List, Optional, Dict

import pandas as pd

from app.services.evaluators.models import ChatMessage, ConversationThread

logger = logging.getLogger(__name__)


class DataLoader:
    """Loads and processes evaluation data from CSV content."""

    def __init__(self, csv_content: Optional[str] = None, csv_path: Optional[Path] = None):
        self.df: Optional[pd.DataFrame] = None
        self._messages: Optional[List[ChatMessage]] = None

        if csv_content:
            self.df = pd.read_csv(io.StringIO(csv_content))
        elif csv_path and Path(csv_path).exists():
            self.df = pd.read_csv(csv_path)

    def get_messages(self) -> List[ChatMessage]:
        if self._messages is None:
            if self.df is None:
                raise ValueError("No data loaded")
            self._messages = [
                ChatMessage.from_csv_row(row)
                for _, row in self.df.iterrows()
            ]
        return self._messages

    def get_thread(self, thread_id: str) -> Optional[ConversationThread]:
        messages = self.get_messages()
        thread_messages = [msg for msg in messages if msg.thread_id == thread_id]
        if not thread_messages:
            return None

        thread_messages.sort(key=lambda x: x.timestamp)
        start_time = thread_messages[0].timestamp
        end_time = thread_messages[-1].timestamp
        duration = (end_time - start_time).total_seconds()
        has_errors = any(msg.error_message for msg in thread_messages)

        return ConversationThread(
            thread_id=thread_id,
            user_id=thread_messages[0].user_id,
            messages=thread_messages,
            start_time=start_time,
            end_time=end_time,
            duration_seconds=duration,
            message_count=len(thread_messages),
            has_errors=has_errors,
        )

    def get_all_thread_ids(self) -> List[str]:
        messages = self.get_messages()
        return list(set(msg.thread_id for msg in messages))

    def get_statistics(self) -> Dict:
        messages = self.get_messages()
        thread_ids = set(msg.thread_id for msg in messages)
        user_ids = set(msg.user_id for msg in messages)

        from collections import Counter
        intent_counts = Counter(msg.intent_detected for msg in messages)

        return {
            "total_messages": len(messages),
            "total_threads": len(thread_ids),
            "total_users": len(user_ids),
            "intent_distribution": dict(intent_counts),
            "messages_with_images": sum(1 for msg in messages if msg.has_image),
            "messages_with_errors": sum(1 for msg in messages if msg.error_message),
        }
