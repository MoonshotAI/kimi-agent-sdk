package kimi

import (
	"context"
	"runtime"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func Prompt(ctx context.Context, content wire.Content, options ...Option) (*Turn, error) {
	session, err := NewSession(options...)
	if err != nil {
		return nil, err
	}
	cleanup := func(turn *Turn) {
		turn.Cancel() //nolint:errcheck
	}
	turn, err := session.Prompt(ctx, content)
	if err != nil {
		return nil, err
	}
	runtime.AddCleanup(session, cleanup, turn)
	return turn, nil
}
