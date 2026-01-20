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
	cleanup := func(s *Session) {
		s.Close() //nolint:errcheck
	}
	runtime.AddCleanup(session, cleanup, session)
	turn, err := session.Prompt(ctx, content)
	if err != nil {
		return nil, err
	}
	turn.ref = session
	runtime.KeepAlive(session)
	return turn, nil
}
