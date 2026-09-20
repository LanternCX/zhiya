// Package modelproxy communicates with the configured model provider.
package modelproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
)

const maxRetries = 5

type Client struct {
	settings config.Model
	http     *http.Client
}

type Failure struct {
	Message string
	Phase   string
	Cause   error
	Values  []any
}

func New(settings config.Model) *Client {
	return &Client{settings: settings, http: &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *Client) Stream(ctx context.Context, payload map[string]any, agent string, logger *slog.Logger, write func(string) bool, onDone func()) (bool, *Failure) {
	payload["model"] = c.settings.ID
	payload["stream"] = true
	payload["max_tokens"] = 8192
	raw, _ := json.Marshal(payload)
	idempotencyKey := identifier.New()
	for attempt := 0; attempt <= maxRetries; attempt++ {
		upstream, err := http.NewRequestWithContext(ctx, http.MethodPost, c.settings.Endpoint, bytes.NewReader(raw))
		if err != nil {
			return false, failure("暂时无法连接模型服务", "request", err, "attempt", attempt+1)
		}
		upstream.Header.Set("Content-Type", "application/json")
		upstream.Header.Set("Authorization", "Bearer "+c.settings.APIKey)
		upstream.Header.Set("Idempotency-Key", idempotencyKey)
		if agent != "" {
			upstream.Header.Set("X-Zhiya-Agent", agent)
		}
		response, requestErr := c.http.Do(upstream)
		if requestErr != nil {
			if ctx.Err() != nil {
				return false, nil
			}
			if attempt < maxRetries {
				logger.WarnContext(ctx, "model request retrying", logFields(agent, "phase", "request", "error", requestErr, "attempt", attempt+1, "max_retries", maxRetries)...)
				if !write(retryComment(attempt)) || !wait(ctx, retryDelay(nil, attempt)) {
					return false, nil
				}
				continue
			}
			return false, failure("暂时无法连接模型服务，请重试", "request", requestErr, "attempt", attempt+1)
		}
		if response.StatusCode != http.StatusOK {
			retryable := retryableStatus(response.StatusCode)
			delay := retryDelay(response.Header, attempt)
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
			if retryable && attempt < maxRetries {
				logger.WarnContext(ctx, "model request retrying", logFields(agent, "phase", "response", "upstream_status", response.StatusCode, "attempt", attempt+1, "max_retries", maxRetries)...)
				if !write(retryComment(attempt)) || !wait(ctx, delay) {
					return false, nil
				}
				continue
			}
			return false, failure("模型服务暂时不可用，请稍后重试", "response", fmt.Errorf("model service returned status %d", response.StatusCode), "upstream_status", response.StatusCode, "attempt", attempt+1)
		}
		reader := bufio.NewReader(response.Body)
		received, completed := false, false
		for {
			line, readErr := reader.ReadString('\n')
			if len(line) > 0 {
				received = true
				if strings.TrimSpace(line) == "data: [DONE]" {
					completed = true
					if onDone != nil {
						onDone()
					}
				}
				if !write(line) {
					_ = response.Body.Close()
					return false, nil
				}
			}
			if readErr == nil {
				continue
			}
			_ = response.Body.Close()
			if completed {
				return true, nil
			}
			if !received && ctx.Err() == nil && attempt < maxRetries {
				logger.WarnContext(ctx, "model request retrying", logFields(agent, "phase", "read", "error", readErr, "attempt", attempt+1, "max_retries", maxRetries)...)
				if !write(retryComment(attempt)) || !wait(ctx, retryDelay(nil, attempt)) {
					return false, nil
				}
				break
			}
			if ctx.Err() == nil {
				return false, failure("模型连接中断，请重试", "read", readErr, "attempt", attempt+1)
			}
			return false, nil
		}
	}
	return false, nil
}

func failure(message, phase string, cause error, values ...any) *Failure {
	return &Failure{Message: message, Phase: phase, Cause: cause, Values: values}
}
func retryComment(attempt int) string {
	return fmt.Sprintf(": zhiya-retry {\"attempt\":%d,\"maxRetries\":%d}\n\n", attempt+1, maxRetries)
}
func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusConflict || status == http.StatusTooManyRequests || status >= 500
}
func retryDelay(headers http.Header, retry int) time.Duration {
	const maximum = 60 * time.Second
	if headers != nil {
		if raw := headers.Get("Retry-After"); raw != "" {
			if seconds, err := strconv.ParseFloat(raw, 64); err == nil {
				return min(time.Duration(seconds*float64(time.Second)), maximum)
			}
			if deadline, err := http.ParseTime(raw); err == nil {
				return min(max(time.Until(deadline), 0), maximum)
			}
		}
	}
	base := min(500*time.Millisecond*time.Duration(1<<retry), 8*time.Second)
	return time.Duration(float64(base) * (0.75 + rand.Float64()*0.25))
}
func wait(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func logFields(agent string, values ...any) []any {
	if agent == "" {
		return values
	}
	return append([]any{"agent", agent}, values...)
}
