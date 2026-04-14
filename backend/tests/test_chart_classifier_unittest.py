from __future__ import annotations

import unittest

from app.services.chat_engine.chart_classifier import classify_columns


class ClassifyColumnsTests(unittest.TestCase):

    def test_numeric_column(self):
        rows = [{'revenue': 100}, {'revenue': 200.5}, {'revenue': 0}]
        result = classify_columns(['revenue'], rows)
        self.assertEqual(result['revenue'], 'numeric')

    def test_temporal_column_by_name(self):
        rows = [{'created_date': '2026-01-01'}, {'created_date': '2026-02-01'}]
        result = classify_columns(['created_date'], rows)
        self.assertEqual(result['created_date'], 'temporal')

    def test_temporal_column_by_value(self):
        rows = [{'ts': '2026-01-15T10:00:00'}, {'ts': '2026-02-20T12:00:00'}]
        result = classify_columns(['ts'], rows)
        self.assertEqual(result['ts'], 'temporal')

    def test_categorical_column(self):
        rows = [{'agent': 'Alice'}, {'agent': 'Bob'}]
        result = classify_columns(['agent'], rows)
        self.assertEqual(result['agent'], 'categorical')

    def test_ordered_categorical_from_dimension_metadata(self):
        rows = [{'stage': 'new'}, {'stage': 'closed'}]
        dimensions = [{'name': 'stage', 'ordering': ['new', 'contacted', 'closed']}]
        result = classify_columns(['stage'], rows, dimensions=dimensions)
        self.assertEqual(result['stage'], 'ordered_categorical')

    def test_mixed_columns(self):
        rows = [
            {'agent': 'Alice', 'revenue': 100, 'month': '2026-01'},
            {'agent': 'Bob', 'revenue': 200, 'month': '2026-02'},
        ]
        result = classify_columns(['agent', 'revenue', 'month'], rows)
        self.assertEqual(result['agent'], 'categorical')
        self.assertEqual(result['revenue'], 'numeric')
        self.assertEqual(result['month'], 'temporal')

    def test_empty_rows_all_categorical(self):
        result = classify_columns(['a', 'b'], [])
        self.assertEqual(result['a'], 'categorical')
        self.assertEqual(result['b'], 'categorical')

    def test_null_values_skipped(self):
        rows = [{'count': None}, {'count': 5}, {'count': 10}]
        result = classify_columns(['count'], rows)
        self.assertEqual(result['count'], 'numeric')
