package kimi

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"

	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire/transport"
)

var (
	ErrTurnNotFound = errors.New("turn not found")
)

func turnBegin(
	ctx context.Context,
	id uint64,
	tp transport.Transport,
	err *atomic.Pointer[error],
	result *atomic.Pointer[wire.PromptResult],
	msgs <-chan wire.Message,
	usrc chan<- wire.RequestResponse,
	exit func(error) error,
) *Turn {
	parent, cancel := context.WithCancel(ctx)
	current, stop := context.WithCancel(context.Background())
	result.CompareAndSwap(nil, &wire.PromptResult{Status: wire.PromptResultStatusPending})
	steps := make(chan *Step)
	turn := &Turn{
		id:      id,
		tp:      tp,
		err:     err,
		result:  result,
		current: current,
		stop:    stop,
		cancel:  cancel,
		exit:    exit,
		usrc:    usrc,
		Steps:   steps,
	}
	turn.usage.Store(&Usage{})
	go turn.traverse(msgs, steps)
	go turn.watch(parent)
	return turn
}

type Turn struct {
	id     uint64
	tp     transport.Transport
	err    *atomic.Pointer[error]
	result *atomic.Pointer[wire.PromptResult]

	current context.Context
	stop    context.CancelFunc
	cancel  context.CancelFunc
	exit    func(error) error

	Steps <-chan *Step
	usage atomic.Pointer[Usage]

	usrc chan<- wire.RequestResponse
}

func (t *Turn) watch(parent context.Context) {
	defer t.stop()
	select {
	case <-t.current.Done():
		return
	case <-parent.Done():
	}
	t.tp.Cancel(&wire.CancelParams{})
}

func (t *Turn) traverse(incoming <-chan wire.Message, steps chan<- *Step) {
	defer t.Cancel()
	defer close(t.usrc)
	defer close(steps)
	var outgoing chan wire.Message
	defer func() {
		if outgoing != nil {
			close(outgoing)
		}
	}()
	select {
	case msg, ok := <-incoming:
		if !ok {
			return
		}
		if _, is := msg.(wire.TurnBegin); !is {
			t.err.Store(&ErrTurnNotFound)
			return
		}
	case <-t.current.Done():
		return
	}
	for msg := range incoming {
		switch x := msg.(type) {
		case wire.Request:
			if outgoing != nil {
				select {
				case outgoing <- x:
				case <-t.current.Done():
					return
				}
			}
		case wire.Event:
			switch x.EventType() {
			case wire.EventTypeTurnBegin:
				panic("wire.TurnBegin event should not be received")
			case wire.EventTypeStepBegin:
				if outgoing != nil {
					close(outgoing)
				}
				outgoing = make(chan wire.Message)
				select {
				case steps <- &Step{n: x.(wire.StepBegin).N, Messages: outgoing}:
				case <-t.current.Done():
					return
				}
			case wire.EventTypeStatusUpdate:
				update := x.(wire.StatusUpdate)
			CAS:
				for {
					oldUsage := t.usage.Load()
					newUsage := &Usage{Tokens: oldUsage.Tokens}
					if update.ContextUsage.Valid {
						newUsage.Context = update.ContextUsage.Value
					}
					if update.TokenUsage.Valid {
						tokens := update.TokenUsage.Value
						newUsage.Tokens.InputOther += tokens.InputOther
						newUsage.Tokens.Output += tokens.Output
						newUsage.Tokens.InputCacheRead += tokens.InputCacheRead
						newUsage.Tokens.InputCacheCreation += tokens.InputCacheCreation
					}
					if t.usage.CompareAndSwap(oldUsage, newUsage) {
						break CAS
					}
				}
			default:
				if outgoing != nil {
					select {
					case outgoing <- x:
					case <-t.current.Done():
						return
					}
				}
			}
		default:
			panic(fmt.Sprintf("unexpected message type: %T", x))
		}
	}
}

func (t *Turn) ID() uint64 {
	return t.id
}

func (t *Turn) Err() error {
	if err := t.err.Load(); err != nil && *err != nil {
		return *err
	}
	return nil
}

func (t *Turn) Result() wire.PromptResult {
	return *t.result.Load()
}

func (t *Turn) Usage() *Usage {
	return t.usage.Load()
}

func (t *Turn) Cancel() error {
	t.cancel()
	<-t.current.Done()
	return t.exit(nil)
}

type Step struct {
	n        int
	Messages <-chan wire.Message
}

type Usage struct {
	Context float64
	Tokens  wire.TokenUsage
}
