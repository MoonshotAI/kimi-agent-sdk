package kimi

import (
	"context"
	"errors"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

// SingleTurn wraps a Turn and its associated Session for single-use scenarios.
// When Close or Cancel is called, it cancels the turn and closes the session.
type SingleTurn struct {
	*Turn
	session *Session
}

// Cancel cancels the turn and closes the session.
// It is equivalent to Close.
func (st *SingleTurn) Cancel() error {
	err1 := st.Turn.Cancel()
	err2 := st.session.Close()
	return errors.Join(err1, err2)
}

// Close cancels the turn and closes the session.
func (st *SingleTurn) Close() error {
	return st.Cancel()
}

// Prompt is a convenient function for single-turn prompts.
// Use SingleTurn.Close() (or Cancel()) to release resources when done.
func Prompt(ctx context.Context, content wire.Content, options ...Option) (*SingleTurn, error) {
	session, err := NewSession(options...)
	if err != nil {
		return nil, err
	}
	turn, err := session.Prompt(ctx, content)
	if err != nil {
		session.Close() //nolint:errcheck
		return nil, err
	}
	return &SingleTurn{Turn: turn, session: session}, nil
}
