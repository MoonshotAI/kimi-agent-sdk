"""Tests for TokenStats — session-level token usage accumulation."""

from __future__ import annotations

import pytest
from kimi_cli.wire.types import TokenUsage

from kimi_agent_sdk._session import TokenStats

# ─── TokenStats standalone tests ─────────────────────────────────────────────


def test_initial_zero() -> None:
    """TokenStats starts at zero."""
    stats = TokenStats()
    assert stats.input_other == 0
    assert stats.output == 0
    assert stats.input_cache_read == 0
    assert stats.input_cache_creation == 0
    assert stats.input == 0
    assert stats.total == 0


def test_add_accumulates() -> None:
    """add() accumulates TokenUsage."""
    stats = TokenStats()
    usage = TokenUsage(
        input_other=100,
        output=50,
        input_cache_read=10,
        input_cache_creation=5,
    )

    stats.add(usage)

    assert stats.input_other == 100
    assert stats.output == 50
    assert stats.input_cache_read == 10
    assert stats.input_cache_creation == 5
    assert stats.input == 115  # 100 + 10 + 5
    assert stats.total == 165  # 115 + 50


def test_add_multiple_times() -> None:
    """add() can be called multiple times to accumulate."""
    stats = TokenStats()

    usage1 = TokenUsage(input_other=100, output=50)
    usage2 = TokenUsage(
        input_other=200,
        output=100,
        input_cache_read=50,
    )

    stats.add(usage1)
    stats.add(usage2)

    assert stats.input_other == 300
    assert stats.output == 150
    assert stats.input_cache_read == 50
    assert stats.total == 500  # 300 + 150 + 50


def test_add_none_is_noop() -> None:
    """add(None) is a no-op."""
    stats = TokenStats()
    stats.add(TokenUsage(input_other=100, output=0))

    stats.add(None)

    assert stats.input_other == 100
    assert stats.total == 100


def test_properties_readonly() -> None:
    """TokenStats properties are read-only."""
    stats = TokenStats()

    # Can read
    _ = stats.input_other
    _ = stats.output
    _ = stats.input_cache_read
    _ = stats.input_cache_creation
    _ = stats.input
    _ = stats.total

    # Cannot set (AttributeError)
    with pytest.raises(AttributeError):
        stats.input_other = 100  # type: ignore[misc]


def test_input_property() -> None:
    """input property sums all input tokens."""
    stats = TokenStats()
    stats.add(
        TokenUsage(
            input_other=100,
            output=0,
            input_cache_read=20,
            input_cache_creation=5,
        )
    )

    assert stats.input == 125


def test_total_property() -> None:
    """total property sums input and output tokens."""
    stats = TokenStats()
    stats.add(
        TokenUsage(
            input_other=100,
            output=50,
            input_cache_read=20,
        )
    )

    assert stats.input == 120
    assert stats.total == 170


def test_add_token_usage_with_all_fields() -> None:
    """TokenUsage with all fields populated works correctly."""
    stats = TokenStats()
    usage = TokenUsage(
        input_other=1000,
        output=500,
        input_cache_read=200,
        input_cache_creation=50,
    )

    stats.add(usage)

    assert stats.input_other == 1000
    assert stats.output == 500
    assert stats.input_cache_read == 200
    assert stats.input_cache_creation == 50
    assert stats.input == 1250  # 1000 + 200 + 50
    assert stats.total == 1750  # 1250 + 500
