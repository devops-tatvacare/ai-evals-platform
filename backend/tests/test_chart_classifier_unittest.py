from __future__ import annotations

import unittest

from app.services.chat_engine.chart_classifier import classify_columns, get_eligible_charts
from app.services.report_builder.scratchpad_state import build_analysis_snapshot


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


class GetEligibleChartsTests(unittest.TestCase):

    def test_one_categorical_one_numeric(self):
        column_types = {'agent': 'categorical', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=5)
        self.assertIn('bar', eligible)
        self.assertIn('horizontal_bar', eligible)
        self.assertIn('pie', eligible)
        self.assertNotIn('line', eligible)
        self.assertNotIn('scatter', eligible)

    def test_one_temporal_one_numeric(self):
        column_types = {'month': 'temporal', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=12)
        self.assertIn('line', eligible)
        self.assertIn('area', eligible)
        self.assertIn('bar', eligible)
        self.assertNotIn('funnel', eligible)

    def test_ordered_categorical_enables_funnel(self):
        column_types = {'stage': 'ordered_categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('funnel', eligible)
        # Funnel should rank first due to specificity
        self.assertEqual(eligible[0], 'funnel')

    def test_two_numerics_enables_scatter(self):
        column_types = {'revenue': 'numeric', 'calls': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=50)
        self.assertIn('scatter', eligible)

    def test_pie_excluded_for_high_row_count(self):
        column_types = {'agent': 'categorical', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=20)
        self.assertNotIn('pie', eligible)
        self.assertNotIn('donut', eligible)

    def test_radar_excluded_for_high_row_count(self):
        column_types = {'dim': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=15)
        self.assertNotIn('radar', eligible)

    def test_radar_included_for_low_row_count(self):
        column_types = {'dim': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('radar', eligible)

    def test_multi_numeric_enables_stacked_and_composed(self):
        column_types = {'month': 'temporal', 'rev': 'numeric', 'cost': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=10)
        self.assertIn('stacked_area', eligible)
        self.assertIn('composed', eligible)
        self.assertIn('line', eligible)

    def test_ordered_categorical_satisfies_ordinal(self):
        """ordered_categorical columns should satisfy min_ordinal for line/area."""
        column_types = {'stage': 'ordered_categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('line', eligible)
        self.assertIn('area', eligible)

    def test_empty_columns_returns_empty(self):
        eligible = get_eligible_charts({}, row_count=0)
        self.assertEqual(eligible, [])

    def test_horizontal_bar_preferred_for_high_cardinality(self):
        column_types = {'city': 'categorical', 'sales': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=15)
        bar_idx = eligible.index('bar')
        hbar_idx = eligible.index('horizontal_bar')
        self.assertLess(hbar_idx, bar_idx)

    def test_horizontal_bar_not_preferred_for_low_cardinality(self):
        column_types = {'status': 'categorical', 'count': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=3)
        bar_idx = eligible.index('bar')
        hbar_idx = eligible.index('horizontal_bar')
        self.assertLess(bar_idx, hbar_idx)


class ClassifyColumnsEdgeCaseTests(unittest.TestCase):

    def test_boolean_values_are_not_numeric(self):
        rows = [{'active': True}, {'active': False}]
        result = classify_columns(['active'], rows)
        self.assertEqual(result['active'], 'categorical')

    def test_string_numbers_are_numeric(self):
        rows = [{'price': '10.5'}, {'price': '20'}]
        result = classify_columns(['price'], rows)
        self.assertEqual(result['price'], 'numeric')

    def test_mixed_numeric_and_string_is_categorical(self):
        rows = [{'val': 10}, {'val': 'abc'}]
        result = classify_columns(['val'], rows)
        self.assertEqual(result['val'], 'categorical')

    def test_year_month_format_is_temporal(self):
        rows = [{'period': '2026-01'}, {'period': '2026-02'}]
        result = classify_columns(['period'], rows)
        self.assertEqual(result['period'], 'temporal')

    def test_dimension_without_ordering_stays_categorical(self):
        rows = [{'agent': 'Alice'}]
        dimensions = [{'name': 'agent', 'description': 'Agent name'}]
        result = classify_columns(['agent'], rows, dimensions=dimensions)
        self.assertEqual(result['agent'], 'categorical')

    def test_all_null_column_is_categorical(self):
        rows = [{'x': None}, {'x': None}]
        result = classify_columns(['x'], rows)
        self.assertEqual(result['x'], 'categorical')


class GetEligibleChartsEdgeCaseTests(unittest.TestCase):

    def test_single_numeric_column_only(self):
        """Only numeric columns — no categorical/ordinal means very limited charts."""
        column_types = {'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=10)
        # No charts require only numeric without categorical/ordinal
        # scatter needs 2 numeric
        self.assertNotIn('bar', eligible)
        self.assertNotIn('scatter', eligible)

    def test_treemap_excluded_for_low_row_count(self):
        column_types = {'cat': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=2)
        self.assertNotIn('treemap', eligible)
        self.assertNotIn('radar', eligible)

    def test_all_chart_types_in_registry_are_strings(self):
        """Sanity check that registry keys are all strings."""
        from app.services.chat_engine.chart_classifier import CHART_TYPE_REGISTRY
        for key in CHART_TYPE_REGISTRY:
            self.assertIsInstance(key, str)

    def test_temporal_satisfies_categorical_requirement(self):
        """Temporal columns should satisfy min_categorical — pie should be eligible."""
        column_types = {'month': 'temporal', 'revenue': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=6)
        self.assertIn('pie', eligible)
        self.assertIn('bar', eligible)


class ClassifyColumnsRobustnessTests(unittest.TestCase):
    """Guard against malformed input that shouldn't crash the classifier."""

    def test_dimensions_with_non_dict_items_ignored(self):
        rows = [{'stage': 'new'}]
        dimensions = [{'name': 'stage', 'ordering': ['new']}, 'not-a-dict', None, 42]
        result = classify_columns(['stage'], rows, dimensions=dimensions)
        self.assertEqual(result['stage'], 'ordered_categorical')

    def test_dimensions_with_empty_ordering_stays_categorical(self):
        rows = [{'agent': 'Alice'}]
        dimensions = [{'name': 'agent', 'ordering': []}]
        result = classify_columns(['agent'], rows, dimensions=dimensions)
        self.assertEqual(result['agent'], 'categorical')

    def test_non_dict_rows_skipped(self):
        rows = [{'x': 10}, 'bad-row', None, {'x': 20}]
        result = classify_columns(['x'], rows)
        self.assertEqual(result['x'], 'numeric')

    def test_inf_and_nan_strings_are_numeric(self):
        """float('inf') and float('nan') are valid Python floats."""
        rows = [{'val': 'inf'}, {'val': '-inf'}, {'val': 'nan'}]
        result = classify_columns(['val'], rows)
        # These parse as float, so classified as numeric
        self.assertEqual(result['val'], 'numeric')

    def test_scientific_notation_is_numeric(self):
        rows = [{'val': '1e5'}, {'val': '2.5e-3'}]
        result = classify_columns(['val'], rows)
        self.assertEqual(result['val'], 'numeric')


class GetEligibleChartsRobustnessTests(unittest.TestCase):

    def test_unrecognized_column_type_does_not_crash(self):
        """column_types with unknown type string should not KeyError."""
        column_types = {'x': 'unknown_type', 'y': 'numeric'}
        # Should not raise — unknown type just doesn't count toward any category
        eligible = get_eligible_charts(column_types, row_count=5)
        self.assertIsInstance(eligible, list)

    def test_row_count_at_exact_boundary(self):
        """row_count == max_rows should be included, row_count == max_rows+1 excluded."""
        column_types = {'cat': 'categorical', 'val': 'numeric'}
        # pie max_rows = 12
        eligible_at_12 = get_eligible_charts(column_types, row_count=12)
        eligible_at_13 = get_eligible_charts(column_types, row_count=13)
        self.assertIn('pie', eligible_at_12)
        self.assertNotIn('pie', eligible_at_13)

    def test_row_count_zero(self):
        column_types = {'cat': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=0)
        # treemap min_rows=3, radar min_rows=3 — both excluded
        self.assertNotIn('treemap', eligible)
        self.assertNotIn('radar', eligible)
        # bar has no min_rows — included
        self.assertIn('bar', eligible)

    def test_negative_row_count(self):
        """Defensive: negative row count shouldn't crash."""
        column_types = {'cat': 'categorical', 'val': 'numeric'}
        eligible = get_eligible_charts(column_types, row_count=-1)
        self.assertIsInstance(eligible, list)


class SnapshotIntegrationTests(unittest.TestCase):

    def test_snapshot_includes_column_types_and_eligible_charts(self):
        result = {
            'status': 'ok',
            'question': 'Revenue by agent',
            'row_count': 5,
            'data': [
                {'agent': 'Alice', 'revenue': 100},
                {'agent': 'Bob', 'revenue': 200},
            ],
        }
        snapshot = build_analysis_snapshot(result)
        self.assertIn('column_types', snapshot)
        self.assertEqual(snapshot['column_types']['agent'], 'categorical')
        self.assertEqual(snapshot['column_types']['revenue'], 'numeric')
        self.assertIn('eligible_charts', snapshot)
        self.assertIn('bar', snapshot['eligible_charts'])

    def test_snapshot_with_dimensions_enables_funnel(self):
        result = {
            'status': 'ok',
            'question': 'Leads by stage',
            'row_count': 5,
            'data': [
                {'stage': 'new', 'count': 100},
                {'stage': 'closed', 'count': 20},
            ],
        }
        dimensions = [{'name': 'stage', 'ordering': ['new', 'contacted', 'closed']}]
        snapshot = build_analysis_snapshot(result, dimensions=dimensions)
        self.assertEqual(snapshot['column_types']['stage'], 'ordered_categorical')
        self.assertIn('funnel', snapshot['eligible_charts'])
