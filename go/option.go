package kimi

import (
	"encoding/json"
)

type Option func(*option)

type option struct {
	exec string
	args []string
	envs []string
}

func WithExecutable(executable string) Option {
	return func(opt *option) {
		opt.exec = executable
	}
}

func WithBaseURL(baseURL string) Option {
	return func(opt *option) {
		opt.envs = append(opt.envs, "KIMI_BASE_URL="+baseURL)
	}
}

func WithAPIKey(apiKey string) Option {
	return func(opt *option) {
		opt.envs = append(opt.envs, "KIMI_API_KEY="+apiKey)
	}
}

func WithConfig(config *Config) Option {
	return func(opt *option) {
		// SAFETY: we guaranteed that the config is valid to be marshalled to JSON
		cfg, _ := json.Marshal(config)
		opt.args = append(opt.args, "--config", string(cfg))
	}
}

func WithConfigFile(file string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--config-file", file)
	}
}

func WithModel(model string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--model", model)
	}
}

func WithWorkDir(dir string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--work-dir", dir)
	}
}

func WithSession(session string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--session", session)
	}
}

func WithMCPConfigFile(file string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--mcp-config-file", file)
	}
}

func WithMCPConfig(config *MCPConfig) Option {
	return func(opt *option) {
		cfg, _ := json.Marshal(config)
		opt.args = append(opt.args, "--mcp-config", string(cfg))
	}
}

func WithAutoApprove() Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--auto-approve")
	}
}

func WithThinking(thinking bool) Option {
	return func(opt *option) {
		if thinking {
			opt.args = append(opt.args, "--thinking")
		} else {
			opt.args = append(opt.args, "--no-thinking")
		}
	}
}

func WithSkillsDir(dir string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, "--skills-dir", dir)
	}
}

// WithArgs appends custom command line arguments.
func WithArgs(args ...string) Option {
	return func(opt *option) {
		opt.args = append(opt.args, args...)
	}
}
